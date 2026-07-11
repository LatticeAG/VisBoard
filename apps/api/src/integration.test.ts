import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetEnvForTests } from "./env.ts";
import { setDbForTests, resetDb } from "./db.ts";
import { createApp } from "./app.ts";
import { resetRateLimitsForTests } from "./auth/middleware.ts";
import { clearAgentsMdSyncTimers } from "./services/agents-md-sync.ts";
import { clearExportsForTests } from "./services/export.ts";
import { createProject } from "./services/project.ts";
import { hashToken } from "./auth/tokens.ts";
import type { AuthPrincipal } from "./auth/middleware.ts";
import { createEmptyStore, createInMemoryDb } from "./test/mock-db.ts";

describe("bootstrap flow", () => {
  beforeEach(() => {
    resetEnvForTests();
    resetRateLimitsForTests();
    clearAgentsMdSyncTimers();
    clearExportsForTests();
    setDbForTests(createInMemoryDb(createEmptyStore()));
  });

  afterEach(() => {
    resetDb();
  });

  it("creates workspace, user, and admin PAT on bootstrap", async () => {
    const app = createApp();
    const res = await app.request("/v1/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Smoke Test", slug: "smoke" }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.workspace.slug).toBe("smoke");
    expect(body.workspace.name).toBe("Smoke Test");
    expect(body.user.display_name).toBe("Admin");
    expect(body.token).toMatch(/^vb_pat_/);
  });

  it("rejects bootstrap when workspaces already exist", async () => {
    setDbForTests(
      createInMemoryDb({
        workspaces: [
          {
            id: "ws_existing",
            slug: "existing",
            name: "Existing",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      }),
    );

    const app = createApp();
    const res = await app.request("/v1/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Another", slug: "another" }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.type).toBe("https://visboard.dev/errors/forbidden");
  });
});

describe("project create flow", () => {
  const auth: AuthPrincipal = {
    type: "user",
    id: "user_test123",
    scopes: ["admin"],
    workspaceIds: ["ws_test123"],
  };

  beforeEach(() => {
    resetEnvForTests();
    clearAgentsMdSyncTimers();
    setDbForTests(
      createInMemoryDb({
        workspaces: [
          {
            id: "ws_test123",
            slug: "smoke",
            name: "Smoke Test",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        users: [
          {
            id: "user_test123",
            displayName: "Admin",
            createdAt: new Date(),
          },
        ],
        workspace_members: [
          {
            workspaceId: "ws_test123",
            userId: "user_test123",
            role: "owner",
            createdAt: new Date(),
          },
        ],
      }),
    );
  });

  afterEach(() => {
    resetDb();
    clearAgentsMdSyncTimers();
  });

  it("creates a project in an existing workspace", async () => {
    const { db } = createInMemoryDb({
      workspaces: [
        {
          id: "ws_test123",
          slug: "smoke",
          name: "Smoke Test",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });
    setDbForTests({ db, client: { end: async () => {} } });

    const project = await createProject(db, "smoke", auth, {
      name: "Demo",
      slug: "demo",
      description: "Demo project",
    });

    expect(project.slug).toBe("demo");
    expect(project.name).toBe("Demo");
    expect(project.status).toBe("draft");
  });

  it("creates project via authenticated HTTP request", async () => {
    const env = resetEnvForTests();
    const token = "vb_pat_testtoken123456789012345678901";
    const tokenHash = hashToken(token, env.VISBOARD_TOKEN_PEPPER);

    const mock = createInMemoryDb({
      workspaces: [
        {
          id: "ws_test123",
          slug: "smoke",
          name: "Smoke Test",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      users: [
        {
          id: "user_test123",
          displayName: "Admin",
          createdAt: new Date(),
        },
      ],
      workspace_members: [
        {
          workspaceId: "ws_test123",
          userId: "user_test123",
          role: "owner",
          createdAt: new Date(),
        },
      ],
      personal_access_tokens: [
        {
          id: "pat_test",
          userId: "user_test123",
          name: "Test",
          tokenHash,
          tokenPrefix: token.slice(0, 8),
          scopes: ["admin"],
          createdAt: new Date(),
        },
      ],
    });
    setDbForTests(mock);

    const app = createApp();
    const res = await app.request("/v1/workspaces/smoke/projects", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Pipeline",
        slug: "pipeline",
        description: "Main pipeline",
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.slug).toBe("pipeline");
    expect(body.name).toBe("Pipeline");
    expect(mock.store.projects).toHaveLength(1);
  });
});

describe("token hashing", () => {
  it("hashes tokens with pepper", async () => {
    const { hashToken, generatePatToken } = await import("./auth/tokens.ts");
    const token = generatePatToken();
    const hash1 = hashToken(token, "pepper-one-min-32-chars-long!!");
    const hash2 = hashToken(token, "pepper-one-min-32-chars-long!!");
    const hash3 = hashToken(token, "different-pepper-min-32-chars!!");

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(token).toMatch(/^vb_pat_/);
  });
});
