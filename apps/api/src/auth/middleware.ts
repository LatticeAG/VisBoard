import { agents, personalAccessTokens, workspaceMembers } from "@visboard/db";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { Context, Next } from "hono";
import { getDb } from "../db.js";
import { getEnv } from "../env.js";
import { unauthorized } from "../lib/errors.js";
import { hashToken } from "./tokens.js";

export type AuthPrincipal = {
  type: "user" | "agent";
  id: string;
  scopes: string[];
  workspaceIds: string[];
  projectIds: string[];
};

declare module "hono" {
  interface ContextVariableMap {
    auth: AuthPrincipal;
    tokenId: string;
  }
}

const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
const lastSeenWrites = new Map<string, number>();
const LAST_SEEN_THROTTLE_MS = 60_000;
const RATE_LIMIT_PRUNE_EVERY = 1000;
let rateLimitCheckCount = 0;

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
        or(isNull(personalAccessTokens.expiresAt), gt(personalAccessTokens.expiresAt, now)),
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
      projectIds: [],
    });
    c.set("tokenId", pat.id);
    await checkRateLimit(c);
    return next();
  }

  const [agent] = await db
    .select()
    .from(agents)
    .where(
      and(eq(agents.tokenHash, tokenHash), eq(agents.status, "active"), isNull(agents.revokedAt)),
    )
    .limit(1);

  if (agent) {
    const lastWrite = lastSeenWrites.get(agent.id) ?? 0;
    if (now.getTime() - lastWrite >= LAST_SEEN_THROTTLE_MS) {
      lastSeenWrites.set(agent.id, now.getTime());
      await db.update(agents).set({ lastSeenAt: now }).where(eq(agents.id, agent.id));
    }

    c.set("auth", {
      type: "agent",
      id: agent.id,
      scopes: agent.scopes,
      workspaceIds: [agent.workspaceId],
      projectIds: agent.projectIds ?? [],
    });
    c.set("tokenId", agent.id);
    await checkRateLimit(c);
    return next();
  }

  throw unauthorized();
}

function pruneStaleRateLimitBuckets(now: number): void {
  for (const [key, bucket] of rateLimitBuckets) {
    if (now >= bucket.resetAt) {
      rateLimitBuckets.delete(key);
    }
  }
}

async function checkRateLimit(c: Context) {
  const env = getEnv();
  const tokenId = c.get("tokenId");
  const rpm = env.VISBOARD_RATE_LIMIT_RPM;
  const now = Date.now();
  const windowMs = 60_000;

  rateLimitCheckCount += 1;
  if (rateLimitCheckCount % RATE_LIMIT_PRUNE_EVERY === 0) {
    pruneStaleRateLimitBuckets(now);
  }

  let bucket = rateLimitBuckets.get(tokenId);
  if (bucket && now >= bucket.resetAt) {
    rateLimitBuckets.delete(tokenId);
    bucket = undefined;
  }
  if (!bucket) {
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

export function getRateLimitBucketCount(): number {
  return rateLimitBuckets.size;
}

export function getRateLimitBucketCountForTests(): number {
  return rateLimitBuckets.size;
}

export function pruneRateLimitBucketsForTests(now = Date.now()): void {
  pruneStaleRateLimitBuckets(now);
}

export function getRateLimitBucketForTests(
  tokenId: string,
): { count: number; resetAt: number } | undefined {
  return rateLimitBuckets.get(tokenId);
}

export function seedRateLimitBucketForTests(
  tokenId: string,
  bucket: { count: number; resetAt: number },
): void {
  rateLimitBuckets.set(tokenId, bucket);
}

export function resetRateLimitsForTests(): void {
  rateLimitBuckets.clear();
  lastSeenWrites.clear();
  rateLimitCheckCount = 0;
}
