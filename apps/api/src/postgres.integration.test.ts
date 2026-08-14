import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createDbFromEnv,
  integrationConnections,
  personalAccessTokens,
  runMigrations,
} from "@visboard/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { resetRateLimitsForTests } from "./auth/middleware.ts";
import { resetDb, setDbForTests } from "./db.ts";
import { resetEnvForTests } from "./env.ts";
import { resetAgentWorkflowRuntimeForTests } from "./routes/agent-workflows.ts";
import { setAutomationEngine } from "./routes/automations.ts";
import { loadAutomationEngineFromDb } from "./services/automation.ts";
import { clearExportsForTests, getExport, startExport } from "./services/export.ts";

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("postgres integration", () => {
  const pepper = "pg-int-pepper-change-me-in-tests-32xx";
  let app: ReturnType<typeof createApp>;
  let dbHandle: ReturnType<typeof createDbFromEnv>;
  let dataDir: string;

  function applyEnv(): void {
    if (!databaseUrl) return;
    resetEnvForTests({
      DATABASE_URL: databaseUrl,
      VISBOARD_TOKEN_PEPPER: pepper,
      VISBOARD_BOOTSTRAP_TOKEN: "pg-bootstrap-secret",
      VISBOARD_DATA_DIR: dataDir ?? "./data",
      NODE_ENV: "test",
    });
  }

  beforeAll(async () => {
    if (!databaseUrl) return;
    dataDir = await mkdtemp(path.join(tmpdir(), "visboard-pg-"));
    applyEnv();
    await runMigrations(databaseUrl);
    dbHandle = createDbFromEnv(databaseUrl);
    setDbForTests(dbHandle);
    app = createApp();
  });

  beforeEach(() => {
    applyEnv();
    if (dbHandle) setDbForTests(dbHandle);
    resetRateLimitsForTests();
    resetAgentWorkflowRuntimeForTests();
  });

  afterAll(async () => {
    resetDb();
    await dbHandle?.client.end({ timeout: 5 });
  });

  async function bootstrapWorkspace(name: string, slug: string, tokenHeader?: string) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (tokenHeader) headers["X-Bootstrap-Token"] = tokenHeader;
    const res = await app.request("/v1/bootstrap", {
      method: "POST",
      headers,
      body: JSON.stringify({ name, slug }),
    });
    const body = await res.json();
    return { res, body };
  }

  it("bootstraps and authenticates with HMAC hashes", async () => {
    const slug = `pghmac${Date.now().toString(36)}`;
    const { res, body } = await bootstrapWorkspace("HMAC WS", slug, "pg-bootstrap-secret");
    expect(res.status).toBe(201);
    expect(body.token).toMatch(/^vb_pat_/);

    const list = await app.request("/v1/workspaces", {
      headers: { Authorization: `Bearer ${body.token}` },
    });
    expect(list.status).toBe(200);
    const listed = await list.json();
    expect(listed.data.some((row: { slug: string }) => row.slug === slug)).toBe(true);
  });

  it("rejects old SHA-256(token+pepper) hashes even when not revoked", async () => {
    const slug = `pgold${Date.now().toString(36)}`;
    const { body } = await bootstrapWorkspace("Old Hash WS", slug, "pg-bootstrap-secret");
    const raw = `vb_pat_oldhashlegacytoken${Date.now().toString(36)}`;
    const oldHash = createHash("sha256")
      .update(raw + pepper)
      .digest("hex");
    await dbHandle.db.insert(personalAccessTokens).values({
      id: `pat_old_${Date.now()}`,
      userId: body.user.id,
      name: "legacy",
      tokenHash: oldHash,
      tokenPrefix: raw.slice(0, 8),
      scopes: ["admin"],
    });
    const res = await app.request("/v1/workspaces", {
      headers: { Authorization: `Bearer ${raw}` },
    });
    expect(res.status).toBe(401);
  });

  it("rejects duplicate token_hash inserts", async () => {
    const slug = `pguniq${Date.now().toString(36)}`;
    const { body } = await bootstrapWorkspace("Unique Hash WS", slug, "pg-bootstrap-secret");
    const hash = createHash("sha256").update(`dup-${Date.now()}-${slug}`).digest("hex");
    await dbHandle.db.insert(personalAccessTokens).values({
      id: `pat_dup_a_${Date.now()}`,
      userId: body.user.id,
      name: "a",
      tokenHash: hash,
      tokenPrefix: "vb_pat_x",
      scopes: ["admin"],
    });
    await expect(
      dbHandle.db.insert(personalAccessTokens).values({
        id: `pat_dup_b_${Date.now()}`,
        userId: body.user.id,
        name: "b",
        tokenHash: hash,
        tokenPrefix: "vb_pat_y",
        scopes: ["admin"],
      }),
    ).rejects.toThrow();
  });

  it("isolates listWorkspaces and templates across two workspaces", async () => {
    const slugA = `pga${Date.now().toString(36)}`;
    const slugB = `pgb${Date.now().toString(36)}`;
    const a = await bootstrapWorkspace("Iso A", slugA, "pg-bootstrap-secret");
    const b = await bootstrapWorkspace("Iso B", slugB, "pg-bootstrap-secret");
    expect(a.res.status).toBe(201);
    expect(b.res.status).toBe(201);

    const listA = await (
      await app.request("/v1/workspaces", {
        headers: { Authorization: `Bearer ${a.body.token}` },
      })
    ).json();
    const listB = await (
      await app.request("/v1/workspaces", {
        headers: { Authorization: `Bearer ${b.body.token}` },
      })
    ).json();
    const slugsA = listA.data.map((row: { slug: string }) => row.slug);
    const slugsB = listB.data.map((row: { slug: string }) => row.slug);
    expect(slugsA).toContain(slugA);
    expect(slugsA).not.toContain(slugB);
    expect(slugsB).toContain(slugB);
    expect(slugsB).not.toContain(slugA);

    const created = await app.request("/v2/templates", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${a.body.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspace_id: a.body.workspace.id,
        name: "Private Template",
        slug: `tpl-${slugA}`,
        published: true,
        manifest: {
          blocks: [{ key: "doc", type: "core.document", content: { body: "tenant a only" } }],
        },
      }),
    });
    expect(created.status).toBe(201);
    const listedB = await app.request("/v2/templates", {
      headers: { Authorization: `Bearer ${b.body.token}` },
    });
    expect(listedB.status).toBe(200);
    const templates = await listedB.json();
    const names = (templates.data ?? templates).map(
      (row: { slug?: string; name?: string }) => row.slug ?? row.name,
    );
    expect(names).not.toContain(`tpl-${slugA}`);
  });

  it("rejects ELF upload disguised as text/plain and stores sha256 on success", async () => {
    const slug = `pgfile${Date.now().toString(36)}`;
    const { body } = await bootstrapWorkspace("File WS", slug, "pg-bootstrap-secret");
    const auth = { Authorization: `Bearer ${body.token}` };
    const project = await app.request(`/v1/workspaces/${slug}/projects`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Demo", slug: "demo" }),
    });
    expect(project.status).toBe(201);

    const elf = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
    const elfForm = new FormData();
    elfForm.append("file", new Blob([elf], { type: "text/plain" }), "foo.txt");
    const elfRes = await app.request(`/v1/workspaces/${slug}/projects/demo/files`, {
      method: "POST",
      headers: auth,
      body: elfForm,
    });
    expect(elfRes.status).toBe(400);

    const okBytes = new TextEncoder().encode('{"ok":true}');
    const okForm = new FormData();
    okForm.append("file", new Blob([okBytes], { type: "application/json" }), "ok.json");
    const okRes = await app.request(`/v1/workspaces/${slug}/projects/demo/files`, {
      method: "POST",
      headers: auth,
      body: okForm,
    });
    expect(okRes.status).toBe(201);
    const uploaded = await okRes.json();
    const digest = createHash("sha256").update(okBytes).digest("hex");
    expect(uploaded.sha256).toBe(digest);
  });

  it("returns 412 on note If-Match mismatch and 400 for invalid JSON bootstrap", async () => {
    const slug = `pgnote${Date.now().toString(36)}`;
    const { body } = await bootstrapWorkspace("Note WS", slug, "pg-bootstrap-secret");
    const auth = { Authorization: `Bearer ${body.token}` };
    const project = await app.request(`/v1/workspaces/${slug}/projects`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Demo", slug: "demo" }),
    });
    expect(project.status).toBe(201);
    const noteRes = await app.request(`/v1/workspaces/${slug}/projects/demo/notes`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Purpose", slug: "purpose", body: "hello" }),
    });
    expect(noteRes.status).toBe(201);
    const note = await noteRes.json();
    const stale = await app.request(`/v1/workspaces/${slug}/projects/demo/notes/${note.id}`, {
      method: "PATCH",
      headers: { ...auth, "Content-Type": "application/json", "If-Match": 'W/"99"' },
      body: JSON.stringify({ body: "nope" }),
    });
    expect(stale.status).toBe(412);

    const bad = await app.request("/v1/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    expect(bad.status).toBe(400);
    expect(bad.headers.get("content-type")).toContain("application/problem+json");
  });

  it("persists agent runs and handoffs across transport instances", async () => {
    const { PostgresAgentTransport } = await import("./services/agent-transport-pg.ts");
    const { setAgentWorkflowTransport } = await import("./routes/agent-workflows.ts");
    setAgentWorkflowTransport(new PostgresAgentTransport(dbHandle));

    const slug = `pgrun${Date.now().toString(36)}`;
    const { body } = await bootstrapWorkspace("Run WS", slug, "pg-bootstrap-secret");
    const auth = {
      Authorization: `Bearer ${body.token}`,
      "Content-Type": "application/json",
    };
    const boardRes = await app.request(`/v2/workspaces/${body.workspace.id}/boards`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "Runtime", slug: "runtime" }),
    });
    expect(boardRes.status).toBe(201);
    const board = await boardRes.json();

    const agentRes = await app.request(`/v1/workspaces/${slug}/agents`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "Bot", scopes: ["read", "write:notes", "write:files"] }),
    });
    expect(agentRes.status).toBe(201);
    const agent = await agentRes.json();

    const start = await app.request(
      `/v2/workspaces/${body.workspace.id}/boards/${board.id}/agent-runs`,
      {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          agent_id: agent.id,
          mode: "operate",
          goal: "Persist this run",
        }),
      },
    );
    expect(start.status).toBe(201);
    const started = await start.json();

    const other = new PostgresAgentTransport(dbHandle);
    const loaded = await other.getRun({ board_id: board.id, run_id: started.run.id });
    expect(loaded.id).toBe(started.run.id);
    expect(loaded.goal).toBe("Persist this run");

    const draftRes = await app.request(
      `/v2/workspaces/${body.workspace.id}/boards/${board.id}/handoffs`,
      {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          access: { run_id: started.run.id, lease_id: started.lease.id },
          packet: {
            goal: "Need a decision",
            requested_decision: {
              kind: "review",
              question: "Ship it?",
              choices: [{ id: "approve", label: "Approve" }],
            },
            belief_trace: {
              schema_version: 1,
              board_revision_id: board.revision.id,
              run_id: started.run.id,
              captured_at: "2026-08-14T04:00:00.000Z",
              summary: "Ready",
              beliefs: [
                {
                  id: "b1",
                  statement: "The run survived a process boundary",
                  evidence_refs: [],
                  block_ids: [],
                  source: "agent",
                },
              ],
              assumptions: [],
              overweighted: [],
              ignored: [],
              confidence: 0.9,
            },
          },
        }),
      },
    );
    expect(draftRes.status).toBe(201);
    const draft = await draftRes.json();
    const loadedDraft = await other.getHandoff({ board_id: board.id, handoff_id: draft.id });
    expect(loadedDraft.id).toBe(draft.id);
    expect(loadedDraft.state).toBe("draft");
  });

  it("requires a belief trace to submit and returns the same hash after a new transport", async () => {
    const { PostgresAgentTransport } = await import("./services/agent-transport-pg.ts");
    const { setAgentWorkflowTransport } = await import("./routes/agent-workflows.ts");
    setAgentWorkflowTransport(new PostgresAgentTransport(dbHandle));

    const slug = `pgbel${Date.now().toString(36)}`;
    const { body } = await bootstrapWorkspace("Belief WS", slug, "pg-bootstrap-secret");
    const auth = {
      Authorization: `Bearer ${body.token}`,
      "Content-Type": "application/json",
    };
    const boardRes = await app.request(`/v2/workspaces/${body.workspace.id}/boards`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "Belief", slug: "belief" }),
    });
    const board = await boardRes.json();
    const agentRes = await app.request(`/v1/workspaces/${slug}/agents`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "Bot", scopes: ["read", "write:notes"] }),
    });
    const agent = await agentRes.json();
    const start = await app.request(
      `/v2/workspaces/${body.workspace.id}/boards/${board.id}/agent-runs`,
      {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ agent_id: agent.id, mode: "operate", goal: "Trace" }),
      },
    );
    const started = await start.json();

    const missing = await app.request(
      `/v2/workspaces/${body.workspace.id}/boards/${board.id}/handoffs`,
      {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          access: { run_id: started.run.id, lease_id: started.lease.id },
          packet: {
            goal: "No theory",
            requested_decision: {
              kind: "review",
              question: "Ship it?",
              choices: [{ id: "approve", label: "Approve" }],
            },
          },
        }),
      },
    );
    expect(missing.status).toBe(201);
    const draft = await missing.json();
    const submitMissing = await app.request(
      `/v2/workspaces/${body.workspace.id}/boards/${board.id}/handoffs/${draft.id}/submit`,
      {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ access: { run_id: started.run.id, lease_id: started.lease.id } }),
      },
    );
    expect(submitMissing.status).toBe(400);
    const problem = await submitMissing.json();
    expect(problem.detail).toBe("belief_trace is required to submit a handoff");

    const traced = await app.request(
      `/v2/workspaces/${body.workspace.id}/boards/${board.id}/handoffs`,
      {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          access: { run_id: started.run.id, lease_id: started.lease.id },
          packet: {
            goal: "With theory",
            requested_decision: {
              kind: "review",
              question: "Ship it?",
              choices: [{ id: "approve", label: "Approve" }],
            },
            belief_trace: {
              schema_version: 1,
              board_revision_id: board.revision.id,
              run_id: started.run.id,
              captured_at: "2026-08-14T04:00:00.000Z",
              summary: "Has a theory",
              beliefs: [
                {
                  id: "b1",
                  statement: "Hashing is stable",
                  evidence_refs: [],
                  block_ids: [],
                  source: "agent",
                },
              ],
              assumptions: [],
              overweighted: [],
              ignored: [],
              confidence: 0.6,
            },
          },
        }),
      },
    );
    const withTrace = await traced.json();
    const submitted = await app.request(
      `/v2/workspaces/${body.workspace.id}/boards/${board.id}/handoffs/${withTrace.id}/submit`,
      {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ access: { run_id: started.run.id, lease_id: started.lease.id } }),
      },
    );
    expect(submitted.status).toBe(200);
    const sealed = await submitted.json();

    const belief = await app.request(
      `/v2/workspaces/${body.workspace.id}/boards/${board.id}/handoffs/${withTrace.id}/belief-trace`,
      { headers: { Authorization: `Bearer ${body.token}` } },
    );
    expect(belief.status).toBe(200);
    const payload = await belief.json();
    expect(payload.belief_trace_hash).toBe(sealed.belief_trace_hash);
    expect(payload.packet_hash).toBe(sealed.packet_hash);

    const other = new PostgresAgentTransport(dbHandle);
    const again = await other.getHandoff({ board_id: board.id, handoff_id: withTrace.id });
    expect(again.belief_trace_hash).toBe(sealed.belief_trace_hash);
  });

  it("keeps automation rules after a new engine is loaded from postgres", async () => {
    const slug = `pgrule${Date.now().toString(36)}`;
    const { body } = await bootstrapWorkspace("Rule WS", slug, "pg-bootstrap-secret");
    const auth = {
      Authorization: `Bearer ${body.token}`,
      "Content-Type": "application/json",
    };
    const created = await app.request(`/v2/workspaces/${body.workspace.id}/automation-rules`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Persist notify",
        enabled: true,
        trigger: { event_types: ["note.created"] },
        actions: [{ id: "notify", type: "notify" }],
      }),
    });
    expect(created.status).toBe(201);
    const rule = await created.json();

    const reloaded = await loadAutomationEngineFromDb(dbHandle.db);
    setAutomationEngine(reloaded);
    expect(reloaded.getRule(rule.id)?.name).toBe("Persist notify");

    const listed = await app.request(`/v2/workspaces/${body.workspace.id}/automation-rules`, {
      headers: { Authorization: `Bearer ${body.token}` },
    });
    expect(listed.status).toBe(200);
    const payload = await listed.json();
    expect(payload.data.some((row: { id: string }) => row.id === rule.id)).toBe(true);
  });

  it("reads an export zip from disk after the in-memory cache is cleared", async () => {
    const slug = `pgexp${Date.now().toString(36)}`;
    const { body } = await bootstrapWorkspace("Export WS", slug, "pg-bootstrap-secret");
    const started = await startExport(dbHandle.db, body.workspace.id);
    let ready = false;
    for (let i = 0; i < 50; i++) {
      const cached = await getExport(dbHandle.db, body.workspace.id, started.export_id);
      if (cached?.status === "ready" && cached.data) {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(ready).toBe(true);
    clearExportsForTests();
    const job = await getExport(dbHandle.db, body.workspace.id, started.export_id);
    expect(job?.status).toBe("ready");
    expect(job?.data?.byteLength).toBeGreaterThan(20);
  });

  it("stores connector secrets as ciphertext, not plaintext", async () => {
    const slug = `pgsec${Date.now().toString(36)}`;
    const { body } = await bootstrapWorkspace("Secret WS", slug, "pg-bootstrap-secret");
    const plaintext = "super-secret-webhook-value";
    const created = await app.request(
      `/v2/workspaces/${body.workspace.id}/integration-connections`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${body.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: "github",
          display_name: "GitHub",
          webhook_secret: plaintext,
        }),
      },
    );
    expect(created.status).toBe(201);
    const connection = await created.json();
    const [row] = await dbHandle.db
      .select()
      .from(integrationConnections)
      .where(eq(integrationConnections.id, connection.id))
      .limit(1);
    expect(row).toBeTruthy();
    expect(row?.secretCiphertext).toBeTruthy();
    expect(row?.secretCiphertext).not.toBe(plaintext);
    expect(JSON.stringify(row?.definition)).not.toContain(plaintext);
  });
});
