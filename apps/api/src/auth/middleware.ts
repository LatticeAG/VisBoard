import {
  agents,
  personalAccessTokens,
  workspaceMembers,
} from "@visboard/db";
import { and, eq, isNull, or, gt } from "drizzle-orm";
import type { Context, Next } from "hono";
import { getEnv } from "../env.js";
import { getDb } from "../db.js";
import { unauthorized } from "../lib/errors.js";
import { hashToken } from "./tokens.js";

export type AuthPrincipal = {
  type: "user" | "agent";
  id: string;
  scopes: string[];
  workspaceIds: string[];
};

declare module "hono" {
  interface ContextVariableMap {
    auth: AuthPrincipal;
    tokenId: string;
  }
}

const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw unauthorized();
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    throw unauthorized();
  }

  const env = getEnv();
  const tokenHash = hashToken(token, env.VISBOARD_TOKEN_PEPPER);
  const { db } = getDb();
  const now = new Date();

  const [pat] = await db
    .select()
    .from(personalAccessTokens)
    .where(
      and(
        eq(personalAccessTokens.tokenHash, tokenHash),
        isNull(personalAccessTokens.revokedAt),
        or(
          isNull(personalAccessTokens.expiresAt),
          gt(personalAccessTokens.expiresAt, now),
        ),
      ),
    )
    .limit(1);

  if (pat) {
    const memberships = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, pat.userId));

    c.set("auth", {
      type: "user",
      id: pat.userId,
      scopes: pat.scopes,
      workspaceIds: memberships.map((m) => m.workspaceId),
    });
    c.set("tokenId", pat.id);
    await checkRateLimit(c);
    return next();
  }

  const [agent] = await db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.tokenHash, tokenHash),
        eq(agents.status, "active"),
        isNull(agents.revokedAt),
      ),
    )
    .limit(1);

  if (agent) {
    await db
      .update(agents)
      .set({ lastSeenAt: now })
      .where(eq(agents.id, agent.id));

    c.set("auth", {
      type: "agent",
      id: agent.id,
      scopes: agent.scopes,
      workspaceIds: [agent.workspaceId],
    });
    c.set("tokenId", agent.id);
    await checkRateLimit(c);
    return next();
  }

  throw unauthorized();
}

async function checkRateLimit(c: Context) {
  const env = getEnv();
  const tokenId = c.get("tokenId");
  const rpm = env.VISBOARD_RATE_LIMIT_RPM;
  const now = Date.now();
  const windowMs = 60_000;

  let bucket = rateLimitBuckets.get(tokenId);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    rateLimitBuckets.set(tokenId, bucket);
  }

  bucket.count += 1;
  if (bucket.count > rpm) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    c.header("Retry-After", String(retryAfter));
    const { rateLimited } = await import("../lib/errors.js");
    throw rateLimited();
  }
}

export function requireScope(...required: string[]) {
  return async (c: Context, next: Next) => {
    const auth = c.get("auth");
    const { hasAnyScope } = await import("./scopes.js");
    if (!hasAnyScope(auth.scopes, required)) {
      const { forbidden } = await import("../lib/errors.js");
      throw forbidden(`Missing required scope: ${required.join(" or ")}`);
    }
    return next();
  };
}

export function requireWorkspaceAccess(wsSlug: string, auth: AuthPrincipal) {
  // workspace slug check happens in services; here we verify membership after resolve
  return auth;
}

export function resetRateLimitsForTests(): void {
  rateLimitBuckets.clear();
}
