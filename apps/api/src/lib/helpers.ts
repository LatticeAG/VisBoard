import type { Context } from "hono";
import type { AuthPrincipal } from "../auth/middleware.js";
import { badRequest, forbidden } from "../lib/errors.js";

export function reqParam(c: Context, name: string): string {
  const value = c.req.param(name);
  if (!value) {
    throw badRequest(`Missing path parameter: ${name}`);
  }
  return value;
}

export function assertWorkspaceAccess(
  auth: AuthPrincipal,
  workspaceId: string,
): void {
  if (!auth.workspaceIds.includes(workspaceId)) {
    throw forbidden("You do not have access to this workspace");
  }
}

export function assertAgentProjectAccess(
  auth: AuthPrincipal,
  projectId: string,
  agentProjectIds: string[],
): void {
  if (auth.type !== "agent") return;
  if (agentProjectIds.length === 0) return;
  if (!agentProjectIds.includes(projectId)) {
    throw forbidden("Agent does not have access to this project");
  }
}

export function actorFromAuth(auth: AuthPrincipal): {
  actorType: "user" | "agent" | "system";
  actorId: string;
} {
  return {
    actorType: auth.type,
    actorId: auth.id,
  };
}

export function toIso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

export function noteEtag(version: number): string {
  return `W/"${version}"`;
}

export function parseIfMatch(header: string | undefined): number | null {
  if (!header) return null;
  const match = header.match(/^W\/"(\d+)"$/);
  return match?.[1] ? Number.parseInt(match[1], 10) : null;
}

export function firstParagraph(body: string): string {
  const lines = body.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
  const text = lines.join(" ").trim();
  if (text.length <= 120) return text || "";
  return `${text.slice(0, 117)}...`;
}
