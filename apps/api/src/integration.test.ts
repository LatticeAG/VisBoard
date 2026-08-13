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
    projectIds: [],
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

describe("checklist item responses", () => {
  beforeEach(() => {
    resetEnvForTests();
    resetRateLimitsForTests();
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
        projects: [
          {
            id: "prj_demo",
            workspaceId: "ws_test123",
            slug: "demo",
            name: "Demo",
            description: "",
            status: "active",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        checklists: [
          {
            id: "chk_test",
            projectId: "prj_demo",
            title: "Launch",
            sourceNoteId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        personal_access_tokens: [
          {
            id: "pat_test",
            userId: "user_test123",
            name: "Test",
            tokenHash: hashToken(
              "vb_pat_testtoken123456789012345678901",
              "test-pepper-change-me-in-production-min-32",
            ),
            tokenPrefix: "vb_pat_",
            scopes: ["admin"],
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

  it("POST checklist item returns created item not full checklist", async () => {
    const token = "vb_pat_testtoken123456789012345678901";
    const app = createApp();
    const res = await app.request(
      "/v1/workspaces/smoke/projects/demo/checklists/chk_test/items",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: "Ship API" }),
      },
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.text).toBe("Ship API");
    expect(body.checklist_id).toBe("chk_test");
    expect(body).not.toHaveProperty("items");
    expect(body).not.toHaveProperty("title");
  });
});

describe("note slug lookup", () => {
  beforeEach(() => {
    resetEnvForTests();
    resetRateLimitsForTests();
    clearAgentsMdSyncTimers();
    const env = resetEnvForTests();
    const token = "vb_pat_testtoken123456789012345678901";
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
        projects: [
          {
            id: "prj_demo",
            workspaceId: "ws_test123",
            slug: "demo",
            name: "Demo",
            description: "",
            status: "active",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        notes: [
          {
            id: "nt_abc123",
            projectId: "prj_demo",
            slug: "purpose",
            title: "Purpose",
            body: "# Purpose",
            frontmatter: {},
            isSystem: false,
            systemKey: null,
            version: 1,
            createdByType: "user",
            createdById: "user_test123",
            updatedByType: "user",
            updatedById: "user_test123",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        personal_access_tokens: [
          {
            id: "pat_test",
            userId: "user_test123",
            name: "Test",
            tokenHash: hashToken(token, env.VISBOARD_TOKEN_PEPPER),
            tokenPrefix: "vb_pat_",
            scopes: ["admin"],
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

  it("GET note by slug returns the note", async () => {
    const token = "vb_pat_testtoken123456789012345678901";
    const app = createApp();
    const res = await app.request(
      "/v1/workspaces/smoke/projects/demo/notes/purpose",
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slug).toBe("purpose");
    expect(body.title).toBe("Purpose");
  });
});

describe("agent project scoping", () => {
  it("blocks agent from project not in project_ids", async () => {
    const { assertAgentProjectAccess } = await import("./lib/helpers.js");
    const { ApiError } = await import("./lib/errors.js");

    const auth: AuthPrincipal = {
      type: "agent",
      id: "agent_test",
      scopes: ["read"],
      workspaceIds: ["ws_test123"],
      projectIds: ["prj_demo"],
    };

    expect(() => assertAgentProjectAccess(auth, "prj_secret")).toThrow(ApiError);
    expect(() =>
      assertAgentProjectAccess(auth, "prj_demo"),
    ).not.toThrow();
  });
});

describe("bootstrap token", () => {
  beforeEach(() => {
    resetEnvForTests({ VISBOARD_BOOTSTRAP_TOKEN: "secret-bootstrap-token" });
    resetRateLimitsForTests();
    clearAgentsMdSyncTimers();
  });

  afterEach(() => {
    resetDb();
  });

  it("allows bootstrap with matching token when workspaces exist", async () => {
    const mock = createInMemoryDb({
      workspaces: [
        {
          id: "ws_existing",
          slug: "existing",
          name: "Existing",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });
    setDbForTests(mock);
    const { bootstrap } = await import("./services/workspace.ts");
    const { ApiError } = await import("./lib/errors.js");

    await expect(
      bootstrap(mock.db, {
        name: "Second Workspace",
        slug: "second",
        bootstrapToken: "wrong-token",
      }),
    ).rejects.toSatisfy((e: unknown) => (e as ApiError).status === 403);

    try {
      await bootstrap(mock.db, {
        name: "Second Workspace",
        slug: "second",
        bootstrapToken: "secret-bootstrap-token",
      });
    } catch (e) {
      expect((e as ApiError).status).not.toBe(403);
    }
  });
});

function authFixture() {
  const env = resetEnvForTests();
  const token = "vb_pat_testtoken123456789012345678901";
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
    projects: [
      {
        id: "prj_demo",
        workspaceId: "ws_test123",
        slug: "demo",
        name: "Demo",
        description: "",
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    personal_access_tokens: [
      {
        id: "pat_test",
        userId: "user_test123",
        name: "Test",
        tokenHash: hashToken(token, env.VISBOARD_TOKEN_PEPPER),
        tokenPrefix: "vb_pat_",
        scopes: ["admin"],
        createdAt: new Date(),
      },
    ],
  });
  return { token, mock };
}

describe("list endpoints data wrapper", () => {
  beforeEach(() => {
    resetRateLimitsForTests();
    clearAgentsMdSyncTimers();
    clearExportsForTests();
    const { mock } = authFixture();
    setDbForTests(mock);
  });

  afterEach(() => {
    resetDb();
    clearAgentsMdSyncTimers();
  });

  it("GET workspaces returns { data } wrapper", async () => {
    const { token } = authFixture();
    const app = createApp();
    const res = await app.request("/v1/workspaces", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("data");
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("GET projects returns { data } wrapper", async () => {
    const { token } = authFixture();
    const app = createApp();
    const res = await app.request("/v1/workspaces/smoke/projects", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("data");
    expect(Array.isArray(body.data)).toBe(true);
  });
});

describe("export zip", () => {
  beforeEach(() => {
    resetRateLimitsForTests();
    clearAgentsMdSyncTimers();
    clearExportsForTests();
    const { mock } = authFixture();
    setDbForTests(mock);
  });

  afterEach(() => {
    resetDb();
    clearExportsForTests();
    clearAgentsMdSyncTimers();
  });

  it("export download returns application/zip", async () => {
    const { token } = authFixture();
    const app = createApp();

    const start = await app.request("/v1/workspaces/smoke/export", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(start.status).toBe(202);
    const { export_id } = await start.json();

    let download: Response | null = null;
    for (let i = 0; i < 20; i++) {
      const res = await app.request(`/v1/workspaces/smoke/exports/${export_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 200) {
        download = res;
        break;
      }
      await new Promise((r) => setTimeout(r, 25));
    }

    expect(download).not.toBeNull();
    expect(download!.headers.get("content-type")).toContain("application/zip");
  });
});

describe("SSE event stream", () => {
  beforeEach(() => {
    resetRateLimitsForTests();
    clearAgentsMdSyncTimers();
    const { mock } = authFixture();
    setDbForTests(mock);
  });

  afterEach(() => {
    resetDb();
    clearAgentsMdSyncTimers();
  });

  it("GET events/stream returns text/event-stream", async () => {
    const { token } = authFixture();
    const app = createApp();
    const res = await app.request(
      "/v1/workspaces/smoke/projects/demo/events/stream",
      { headers: { Authorization: `Bearer ${token}` } },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
  });
});

describe("V3 board foundation", () => {
  let token: string;
  let mock: ReturnType<typeof createInMemoryDb>;

  beforeEach(() => {
    resetEnvForTests();
    resetRateLimitsForTests();
    clearAgentsMdSyncTimers();
    const fixture = authFixture();
    token = fixture.token;
    mock = fixture.mock;
    setDbForTests(mock);
  });

  afterEach(() => {
    resetDb();
    clearAgentsMdSyncTimers();
  });

  it("discovers the shared rich block registry", async () => {
    const app = createApp();
    const response = await app.request("/v2/block-types", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data["core.kanban"]).toBeDefined();
    expect(body.data["core.mermaid"].renderer).toBe("mermaid");
    expect(body.data["core.dashboard"]).toBeDefined();
  });

  it("creates a board, captures revisions, diffs them, and restores a new epoch", async () => {
    const app = createApp();
    const create = await app.request("/v2/workspaces/ws_test123/boards", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Architecture",
        slug: "architecture",
        description: "V3 foundation work",
      }),
    });

    expect(create.status).toBe(201);
    const board = await create.json();
    expect(board.id).toMatch(/^brd_/);
    expect(board.document.id).toMatch(/^bdoc_/);
    expect(board.revision.trigger).toBe("board_created");

    const command = await app.request(
      `/v2/workspaces/ws_test123/boards/${board.id}/commands`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          command_id: "create-mermaid",
          kind: "block.create",
          payload: {
            type: "core.mermaid",
            content: { source: "graph TD\\nPlan --> Ship" },
          },
          expected: { revision_id: board.revision.id },
        }),
      },
    );

    expect(command.status).toBe(200);
    const commandBody = await command.json();
    expect(commandBody.status).toBe("applied");
    expect(commandBody.block.type).toBe("core.mermaid");
    expect(commandBody.revision.id).not.toBe(board.revision.id);

    const state = await app.request(
      `/v2/workspaces/ws_test123/boards/${board.id}/state`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(state.status).toBe(200);
    const stateBody = await state.json();
    expect(stateBody.blocks).toHaveLength(1);
    expect(stateBody.blocks[0].content.source).toContain("Plan --> Ship");

    const diff = await app.request(
      `/v2/workspaces/ws_test123/boards/${board.id}/diff?from=${board.revision.id}&to=${commandBody.revision.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(diff.status).toBe(200);
    const diffBody = await diff.json();
    expect(diffBody.summary.added).toBe(1);

    const restore = await app.request(
      `/v2/workspaces/ws_test123/boards/${board.id}/restore`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          revision_id: board.revision.id,
          reason: "Return to a clean planning checkpoint",
        }),
      },
    );
    expect(restore.status).toBe(200);
    const restoreBody = await restore.json();
    expect(restoreBody.trigger).toBe("restore");
    expect(restoreBody.document_id).not.toBe(board.document.id);

    const restoredState = await app.request(
      `/v2/workspaces/ws_test123/boards/${board.id}/state`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const restoredStateBody = await restoredState.json();
    expect(restoredStateBody.blocks).toHaveLength(0);
    expect(restoredStateBody.board.effect_generation).toBe(1);
  });

  it("installs a published template as mapped rich blocks", async () => {
    const app = createApp();
    const boardResponse = await app.request("/v2/workspaces/ws_test123/boards", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Research board", slug: "research-board" }),
    });
    const board = await boardResponse.json();

    const templateResponse = await app.request("/v2/templates", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Research packet",
        slug: "research-packet",
        published: true,
        manifest: {
          blocks: [
            {
              key: "question",
              type: "core.document",
              content: { body: "# {{topic}}" },
            },
            {
              key: "diagram",
              type: "core.mermaid",
              content: { source: "graph TD\\nQuestion --> Evidence" },
            },
            {
              key: "metrics",
              type: "core.dashboard",
              attributes: { datasource: "research" },
            },
          ],
          parameters: [
            { key: "topic", label: "Topic", type: "string", required: true },
          ],
        },
      }),
    });
    expect(templateResponse.status).toBe(201);
    const template = await templateResponse.json();

    const install = await app.request(
      `/v2/workspaces/ws_test123/boards/${board.id}/template-installations`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          template_version_id: template.version.id,
          variables: { topic: "Observability" },
        }),
      },
    );

    expect(install.status).toBe(201);
    const installBody = await install.json();
    expect(installBody.installation.state).toBe("installed");
    expect(installBody.blocks).toHaveLength(3);
    expect(installBody.blocks[0].content.body).toBe("# Observability");
    expect(mock.store.template_block_mappings).toHaveLength(3);
  });

  it("discovers the shipped workflow blueprints with an installable version", async () => {
    const app = createApp();
    const listed = await app.request("/v2/templates", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(listed.status).toBe(200);
    const listBody = await listed.json();
    expect(listBody.data.map((template: { slug: string }) => template.slug)).toEqual(
      expect.arrayContaining([
        "sprint-planning",
        "incident-response",
        "pr-review",
        "research",
      ]),
    );

    const research = listBody.data.find(
      (template: { slug: string }) => template.slug === "research",
    );
    const detail = await app.request(`/v2/templates/${research.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(detail.status).toBe(200);
    const detailBody = await detail.json();
    expect(detailBody.versions[0].state).toBe("published");
    expect(detailBody.versions[0].manifest.blocks).toHaveLength(5);
  });

  it("rejects a protected command issued against a stale revision", async () => {
    const app = createApp();
    const created = await app.request("/v2/workspaces/ws_test123/boards", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Conflict board", slug: "conflict-board" }),
    });
    const board = await created.json();

    const stale = await app.request(
      `/v2/workspaces/ws_test123/boards/${board.id}/commands`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          command_id: "stale-command",
          kind: "block.create",
          payload: { type: "core.code", content: { source: "const x = 1" } },
          expected: { revision_id: "rev_01ARZ3NDEKTSV4RRFFQ69G5FAV" },
        }),
      },
    );

    expect(stale.status).toBe(412);
    const staleBody = await stale.json();
    expect(staleBody.title).toBe("Precondition Failed");
  });
});
