import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";
import { resetDb, setDbForTests } from "../db.ts";
import { resetEnvForTests } from "../env.ts";
import { createInMemoryDb } from "../test/mock-db.ts";
import {
  getRateLimitBucketCountForTests,
  pruneRateLimitBucketsForTests,
  resetRateLimitsForTests,
} from "./middleware.ts";
import { hashToken } from "./tokens.ts";

describe("auth middleware", () => {
  beforeEach(() => {
    resetEnvForTests();
    resetRateLimitsForTests();
  });

  afterEach(() => {
    resetDb();
  });

  it("deletes a reset rate-limit bucket during lookup", async () => {
    const env = resetEnvForTests();
    const token = "vb_pat_ratelimitbuckettesttokenxxxx";
    const db = createInMemoryDb({
      personal_access_tokens: [
        {
          id: "pat_rl",
          userId: "user_rl",
          name: "t",
          tokenHash: hashToken(token, env.VISBOARD_TOKEN_PEPPER),
          tokenPrefix: token.slice(0, 8),
          scopes: ["admin"],
          expiresAt: null,
          revokedAt: null,
          createdAt: new Date(),
        },
      ],
      workspace_members: [{ workspaceId: "ws_rl", userId: "user_rl", role: "owner" }],
    });
    setDbForTests(db);
    const app = createApp();
    const headers = { Authorization: `Bearer ${token}` };
    expect((await app.request("/v1/workspaces", { headers })).status).toBe(200);
    expect(getRateLimitBucketCountForTests()).toBe(1);
    pruneRateLimitBucketsForTests(Date.now() + 120_000);
    expect(getRateLimitBucketCountForTests()).toBe(0);
  });

  it("writes agent lastSeenAt at most once per 60s", async () => {
    const env = resetEnvForTests();
    const token = "vb_agent_lastseenthrottletokenxxxx";
    const db = createInMemoryDb({
      agents: [
        {
          id: "agent_ls",
          workspaceId: "ws_ls",
          name: "Bot",
          description: "",
          capabilities: [],
          scopes: ["read"],
          projectIds: [],
          tokenHash: hashToken(token, env.VISBOARD_TOKEN_PEPPER),
          tokenPrefix: token.slice(0, 8),
          status: "active",
          lastSeenAt: null,
          createdById: "user_ls",
          createdAt: new Date(),
          revokedAt: null,
        },
      ],
    });
    setDbForTests(db);
    const app = createApp();
    const headers = { Authorization: `Bearer ${token}` };
    expect((await app.request("/v1/workspaces", { headers })).status).toBe(200);
    expect((await app.request("/v1/workspaces", { headers })).status).toBe(200);
    expect(db.getUpdateCallCount()).toBe(1);
  });

  it("does not export a no-op requireWorkspaceAccess", async () => {
    const mod = await import("./middleware.ts");
    expect("requireWorkspaceAccess" in mod).toBe(false);
  });
});
