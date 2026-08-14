import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";
import { resetRateLimitsForTests } from "../auth/middleware.ts";
import { hashToken } from "../auth/tokens.ts";
import { resetDb, setDbForTests } from "../db.ts";
import { resetEnvForTests } from "../env.ts";
import { createInMemoryDb } from "../test/mock-db.ts";
import { resetAgentWorkflowRuntimeForTests } from "./agent-workflows.ts";
import { resetAutomationRoutesForTests } from "./automations.ts";
import { resetIntegrationRoutesForTests } from "./integrations.ts";

const workspaceId = "ws_test123";
const userId = "user_test123";
const token = "vb_pat_testtoken123456789012345678901";

function setup() {
  const env = resetEnvForTests();
  resetRateLimitsForTests();
  resetAgentWorkflowRuntimeForTests();
  resetAutomationRoutesForTests();
  resetIntegrationRoutesForTests();
  setDbForTests(
    createInMemoryDb({
      workspaces: [
        {
          id: workspaceId,
          slug: "smoke",
          name: "Smoke",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      users: [{ id: userId, displayName: "Admin", createdAt: new Date() }],
      workspace_members: [{ workspaceId, userId, role: "owner", createdAt: new Date() }],
      personal_access_tokens: [
        {
          id: "pat_test",
          userId,
          name: "Test",
          tokenHash: hashToken(token, env.VISBOARD_TOKEN_PEPPER),
          tokenPrefix: "vb_pat_",
          scopes: ["admin"],
          createdAt: new Date(),
        },
      ],
    }),
  );
}

function headers(extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${token}`, ...extra };
}

async function createBoard() {
  const app = createApp();
  const response = await app.request(`/v2/workspaces/${workspaceId}/boards`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ name: "Agent workflow", slug: "agent-workflow" }),
  });
  expect(response.status).toBe(201);
  return { app, board: await response.json() };
}

describe("mounted V3 agent workspace and handoff protocol", () => {
  beforeEach(setup);
  afterEach(() => {
    resetAgentWorkflowRuntimeForTests();
    resetDb();
  });

  it("isolates a board-scoped file tree, versions scratchpad writes, and freezes a submitted handoff", async () => {
    const { app, board } = await createBoard();
    const start = await app.request(`/v2/workspaces/${workspaceId}/boards/${board.id}/agent-runs`, {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        agent_id: "agent_builder",
        mode: "operate",
        goal: "Build the board implementation",
        base_revision_id: board.revision.id,
        allowed_paths: ["src"],
      }),
    });
    expect(start.status).toBe(201);
    const run = await start.json();

    const workspaceResponse = await app.request(
      `/v2/workspaces/${workspaceId}/boards/${board.id}/agent-workspaces`,
      {
        method: "POST",
        headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          agent_id: "agent_builder",
          profile: "external",
          access: { run_id: run.run.id, lease_id: run.lease.id },
        }),
      },
    );
    expect(workspaceResponse.status).toBe(201);
    const workspace = await workspaceResponse.json();

    const filePath = `/v2/workspaces/${workspaceId}/boards/${board.id}/agent-workspaces/${workspace.id}/files/src/index.ts`;
    const write = await app.request(filePath, {
      method: "PUT",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        content: "export const shipped = true;\n",
        access: { run_id: run.run.id, lease_id: run.lease.id },
      }),
    });
    if (!write.ok) expect.fail(await write.text());
    expect(write.status).toBe(200);
    const file = await write.json();
    expect(file.path).toBe("src/index.ts");

    const tree = await app.request(
      `/v2/workspaces/${workspaceId}/boards/${board.id}/agent-workspaces/${workspace.id}/tree?run_id=${run.run.id}&lease_id=${run.lease.id}`,
      { headers: headers() },
    );
    expect(tree.status).toBe(200);
    expect((await tree.json()).entries).toMatchObject([{ kind: "directory", path: "src" }]);

    const scratchpadPath = `/v2/workspaces/${workspaceId}/boards/${board.id}/agent-workspaces/${workspace.id}/scratchpad`;
    const scratchpad = await app.request(
      `${scratchpadPath}?run_id=${run.run.id}&lease_id=${run.lease.id}`,
      { headers: headers() },
    );
    const initialScratchpad = await scratchpad.json();
    const updateScratchpad = await app.request(scratchpadPath, {
      method: "PUT",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        content: "Waiting for a human release decision.",
        expected_etag: initialScratchpad.etag,
        access: { run_id: run.run.id, lease_id: run.lease.id },
      }),
    });
    expect(updateScratchpad.status).toBe(200);

    const handoff = await app.request(`/v2/workspaces/${workspaceId}/boards/${board.id}/handoffs`, {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        access: { run_id: run.run.id, lease_id: run.lease.id },
        agent_workspace_id: workspace.id,
        revision_id: board.revision.id,
        packet: {
          goal: "Approve the implementation",
          completed_work: ["Created a scoped file tree"],
          requested_decision: {
            kind: "release_approval",
            question: "May the agent continue to release?",
            choices: [{ id: "approve", label: "Approve" }],
            resume_allowed: true,
          },
          belief_trace: {
            schema_version: 1,
            board_revision_id: board.revision.id,
            run_id: run.run.id,
            captured_at: "2026-08-14T04:00:00.000Z",
            summary: "Scoped file tree is ready for review",
            beliefs: [
              {
                id: "b1",
                statement: "The file tree is isolated to this run",
                evidence_refs: [],
                block_ids: [],
                source: "agent",
              },
            ],
            assumptions: [],
            overweighted: [],
            ignored: [],
            confidence: 0.7,
          },
        },
      }),
    });
    expect(handoff.status).toBe(201);
    const draft = await handoff.json();

    const submitted = await app.request(
      `/v2/workspaces/${workspaceId}/boards/${board.id}/handoffs/${draft.id}/submit`,
      {
        method: "POST",
        headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ access: { run_id: run.run.id, lease_id: run.lease.id } }),
      },
    );
    expect(submitted.status).toBe(200);
    expect((await submitted.json()).packet.workspace_snapshot.file_count).toBe(1);

    const frozenWrite = await app.request(filePath, {
      method: "PUT",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        content: "export const shipped = false;\n",
        expected_etag: file.etag,
        access: { run_id: run.run.id, lease_id: run.lease.id },
      }),
    });
    expect(frozenWrite.status).toBe(409);
  });
});

describe("mounted V3 Markdown and JSON interchange", () => {
  beforeEach(setup);
  afterEach(() => resetDb());

  it("exports rich source faithfully and imports portable Markdown through typed blocks", async () => {
    const { app, board } = await createBoard();
    const command = await app.request(`/v2/workspaces/${workspaceId}/boards/${board.id}/commands`, {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        command_id: "add-diagram",
        kind: "block.create",
        payload: {
          type: "core.mermaid",
          attributes: { title: "Release flow" },
          content: { source: "graph TD\nA-->B" },
        },
        expected: { revision_id: board.revision.id },
      }),
    });
    expect(command.status).toBe(200);

    const exported = await app.request(
      `/v2/workspaces/${workspaceId}/boards/${board.id}/exports?format=markdown`,
      { headers: headers() },
    );
    expect(exported.status).toBe(200);
    const markdown = await exported.json();
    expect(markdown.content).toContain("```mermaid");
    expect(markdown.content).toContain("visboard:block");

    const imported = await app.request(`/v2/workspaces/${workspaceId}/boards/${board.id}/imports`, {
      method: "POST",
      headers: headers({ "Content-Type": "text/markdown" }),
      body: "# Imported runbook\n\nThis content is portable.",
    });
    expect(imported.status).toBe(201);
    const importResult = await imported.json();
    expect(importResult.imported).toHaveLength(1);
    expect(importResult.imported[0].block.type).toBe("core.document");
    expect(importResult.revision.label).toContain("Imported MARKDOWN");
  });
});

describe("mounted V3 connector bridge", () => {
  beforeEach(setup);
  afterEach(() => resetDb());

  it("applies a verified GitHub issue update through the typed board command boundary", async () => {
    const { app, board } = await createBoard();
    const createCard = await app.request(
      `/v2/workspaces/${workspaceId}/boards/${board.id}/commands`,
      {
        method: "POST",
        headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          command_id: "create-sync-card",
          kind: "block.create",
          payload: { type: "core.kanban_card", attributes: { state: "open" } },
          expected: { revision_id: board.revision.id },
        }),
      },
    );
    expect(createCard.status).toBe(200);
    const card = (await createCard.json()).block;

    const connectionResponse = await app.request(
      `/v2/workspaces/${workspaceId}/integration-connections`,
      {
        method: "POST",
        headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          provider: "github",
          display_name: "GitHub Issues",
          webhook_secret: "connector-secret",
        }),
      },
    );
    expect(connectionResponse.status).toBe(201);
    const connection = await connectionResponse.json();

    const linkResponse = await app.request(
      `/v2/workspaces/${workspaceId}/boards/${board.id}/sync-links`,
      {
        method: "POST",
        headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          connection_id: connection.id,
          resource_id: card.id,
          external_id: "acme/visboard#7",
          direction: "inbound",
          field_mappings: [
            { local_field: "state", external_field: "state", ownership: "external" },
          ],
          baseline: { state: "open" },
        }),
      },
    );
    expect(linkResponse.status).toBe(201);

    const rawBody = new TextEncoder().encode(
      JSON.stringify({
        action: "closed",
        repository: { full_name: "acme/visboard" },
        issue: { id: 7, number: 7, state: "closed", labels: [] },
      }),
    );
    const signature = createHmac("sha256", "connector-secret").update(rawBody).digest("hex");
    const webhook = await app.request(`/v2/integrations/webhooks/${connection.id}`, {
      method: "POST",
      headers: {
        "x-hub-signature-256": `sha256=${signature}`,
        "x-github-event": "issues",
        "x-github-delivery": "delivery-board-1",
      },
      body: rawBody,
    });
    expect(webhook.status).toBe(202);

    const state = await app.request(`/v2/workspaces/${workspaceId}/boards/${board.id}/state`, {
      headers: headers(),
    });
    expect(state.status).toBe(200);
    expect((await state.json()).blocks[0].attributes.state).toBe("closed");
  });
});

describe("mounted V3 board automation dispatch", () => {
  beforeEach(setup);
  afterEach(() => resetDb());

  it("feeds committed semantic board commands into workspace automation rules", async () => {
    const { app, board } = await createBoard();
    const rule = await app.request(`/v2/workspaces/${workspaceId}/automation-rules`, {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        board_id: board.id,
        name: "Record added blocks",
        enabled: true,
        trigger: { event_types: ["block.created"] },
        actions: [{ id: "notify", type: "notify" }],
      }),
    });
    expect(rule.status).toBe(201);

    const command = await app.request(`/v2/workspaces/${workspaceId}/boards/${board.id}/commands`, {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        command_id: "automated-block",
        kind: "block.create",
        payload: { type: "core.document", content: { body: "# Signal" } },
        expected: { revision_id: board.revision.id },
      }),
    });
    expect(command.status).toBe(200);

    const runs = await app.request(`/v2/workspaces/${workspaceId}/automation-runs`, {
      headers: headers(),
    });
    expect(runs.status).toBe(200);
    const body = await runs.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ board_id: board.id, state: "failed" });
  });
});
