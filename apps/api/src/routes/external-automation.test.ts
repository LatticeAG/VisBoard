import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createApp } from "../app.ts";
import { resetEnvForTests } from "../env.ts";
import { resetDb, setDbForTests } from "../db.ts";
import { hashToken } from "../auth/tokens.ts";
import { createInMemoryDb } from "../test/mock-db.ts";
import {
  getIntegrationSyncEngine,
  getSyncedResourceState,
  integrationRoutes,
  resetIntegrationRoutesForTests,
} from "./integrations.ts";
import {
  automationRoutes,
  getAutomationEngine,
  resetAutomationRoutesForTests,
} from "./automations.ts";

const token = "vb_pat_testtoken123456789012345678901";
const workspaceId = "ws_test123";

function setupDb() {
  const env = resetEnvForTests();
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
      users: [{ id: "user_test123", displayName: "Admin", createdAt: new Date() }],
      workspace_members: [
        { workspaceId, userId: "user_test123", role: "owner", createdAt: new Date() },
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
      boards: [
        {
          id: "brd_test123",
          workspaceId,
          slug: "board",
          name: "Board",
          description: "",
          status: "active",
          currentDocumentId: "bdoc_test123",
          headRevisionId: null,
          headSequence: 0,
          effectGeneration: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    }),
  );
}

function appWith(routes: Hono) {
  const app = new Hono();
  app.route("/v2", routes);
  return app;
}

function authHeaders(extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${token}`, ...extra };
}

describe("integration route factory", () => {
  beforeEach(() => {
    setupDb();
    resetIntegrationRoutesForTests();
  });

  afterEach(() => resetDb());

  it("creates scoped connections and only accepts a verified provider webhook", async () => {
    const app = appWith(integrationRoutes);
    const create = await app.request(
      `/v2/workspaces/${workspaceId}/integration-connections`,
      {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          provider: "github",
          display_name: "GitHub Issues",
          webhook_secret: "webhook-secret",
        }),
      },
    );
    expect(create.status).toBe(201);
    const connection = await create.json();
    expect(connection).not.toHaveProperty("webhook_secret");

    const link = await app.request(
      `/v2/workspaces/${workspaceId}/boards/brd_test123/sync-links`,
      {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          connection_id: connection.id,
          resource_id: "blk_state",
          external_id: "acme/repo#1",
          direction: "inbound",
          field_mappings: [
            { local_field: "state", external_field: "state", ownership: "external" },
          ],
          baseline: { state: "open" },
        }),
      },
    );
    expect(link.status).toBe(201);

    const rawBody = new TextEncoder().encode(
      JSON.stringify({
        action: "closed",
        repository: { full_name: "acme/repo" },
        issue: { id: 1, number: 1, state: "closed", labels: [] },
      }),
    );
    const signature = createHmac("sha256", "webhook-secret").update(rawBody).digest("hex");
    const webhook = await app.request(`/v2/integrations/webhooks/${connection.id}`, {
      method: "POST",
      headers: {
        "x-hub-signature-256": `sha256=${signature}`,
        "x-github-event": "issues",
        "x-github-delivery": "delivery-1",
      },
      body: rawBody,
    });
    expect(webhook.status).toBe(202);
    expect(getSyncedResourceState("blk_state")).toEqual({ state: "closed" });
    expect(getIntegrationSyncEngine().listLinks("brd_test123")).toHaveLength(1);
  });

  it("is mounted on the documented V2 connection path", async () => {
    const app = createApp();
    const response = await app.request(
      `/v2/workspaces/${workspaceId}/integration-connections`,
      { headers: authHeaders() },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [] });
  });
});

describe("automation route factory", () => {
  beforeEach(() => {
    setupDb();
    resetAutomationRoutesForTests();
  });

  afterEach(() => resetDb());

  it("creates workspace-scoped rules and exposes approval-gated runs", async () => {
    const app = appWith(automationRoutes);
    const create = await app.request(
      `/v2/workspaces/${workspaceId}/automation-rules`,
      {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          name: "Review completion",
          enabled: true,
          trigger: { event_types: ["kanban.card.transitioned"] },
          actions: [{ id: "notify", type: "notify", requires_approval: true }],
        }),
      },
    );
    expect(create.status).toBe(201);
    const rule = await create.json();

    const [run] = await getAutomationEngine().processEvent({
      id: "evt_automation",
      type: "kanban.card.transitioned",
      workspace_id: workspaceId,
      source: "human",
      payload: {},
      created_at: "2026-07-21T12:00:00.000Z",
    });
    expect(run?.state).toBe("awaiting_approval");

    const list = await app.request(
      `/v2/workspaces/${workspaceId}/automation-rules`,
      { headers: authHeaders() },
    );
    expect((await list.json()).data[0].id).toBe(rule.id);

    const approve = await app.request(
      `/v2/automation-runs/${run!.id}/actions/notify/approve`,
      { method: "POST", headers: authHeaders() },
    );
    expect(approve.status).toBe(200);
    expect((await approve.json()).actions[0].state).toBe("failed");
  });
});
