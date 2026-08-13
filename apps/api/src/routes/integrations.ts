import {
  createIntegrationConnectionSchema,
  createSyncLinkSchema,
} from "@visboard/shared";
import { Hono, type Context } from "hono";
import { authMiddleware, requireScope } from "../auth/middleware.js";
import { getDb } from "../db.js";
import { assertWorkspaceAccess } from "../lib/helpers.js";
import { badRequest, forbidden, notFound, unauthorized } from "../lib/errors.js";
import {
  executeBoardCommand,
  getBoard,
  getBoardState,
} from "../services/board.js";
import { SyncEngine } from "../services/sync.js";
import { getWorkspaceById } from "../services/workspace.js";
import { getAutomationEngine } from "./automations.js";

type JsonRecord = Record<string, unknown>;

const connectionSecrets = new Map<string, string>();
const resourceStates = new Map<string, JsonRecord>();
const boardWorkspaceIds = new Map<string, string>();

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value
    : undefined;
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function mergePatch(target: JsonRecord, patch: JsonRecord): JsonRecord {
  const next = clone(target);
  for (const [key, value] of Object.entries(patch)) {
    if (isRecord(value) && isRecord(next[key])) {
      next[key] = mergePatch(next[key] as JsonRecord, value);
    } else {
      next[key] = clone(value);
    }
  }
  return next;
}

function setPath(target: JsonRecord, path: string, value: unknown): void {
  const parts = path.split(".");
  const last = parts.pop();
  if (!last) return;
  let cursor = target;
  for (const part of parts) {
    const current = cursor[part];
    if (!isRecord(current)) {
      const next: JsonRecord = {};
      cursor[part] = next;
      cursor = next;
    } else {
      cursor = current;
    }
  }
  cursor[last] = clone(value);
}

function blockProjection(block: JsonRecord): JsonRecord {
  const attributes = clone(asRecord(block.attributes));
  const content = clone(asRecord(block.content));
  return { ...attributes, ...content, attributes, content };
}

function blockCommandPayload(block: JsonRecord, patch: JsonRecord): JsonRecord {
  const attributes = clone(asRecord(block.attributes));
  const content = clone(asRecord(block.content));
  for (const [key, value] of Object.entries(patch)) {
    if (key === "attributes" && isRecord(value)) {
      Object.assign(attributes, mergePatch(attributes, value));
    } else if (key === "content" && isRecord(value)) {
      Object.assign(content, mergePatch(content, value));
    } else if (key.startsWith("attributes.")) {
      setPath(attributes, key.slice("attributes.".length), value);
    } else if (key.startsWith("content.")) {
      setPath(content, key.slice("content.".length), value);
    } else {
      // Direct mappings are block attributes by default. This keeps a simple
      // `state -> state` GitHub/Linear mapping ergonomic while callers that
      // need an explicit partition can use `attributes.state` or `content.x`.
      attributes[key] = clone(value);
    }
  }
  return { attributes, content };
}

async function boardResource(link: { board_id: string; resource_id: string }) {
  const workspaceId = boardWorkspaceIds.get(link.board_id);
  if (!workspaceId) return null;
  const { db } = getDb();
  const state = await getBoardState(db, workspaceId, link.board_id);
  const block = state.blocks
    .map(asRecord)
    .find((candidate) => candidate.id === link.resource_id);
  return { workspaceId, db, state, block };
}

function createReferenceSyncEngine(): SyncEngine {
  return new SyncEngine({
    resolveSecret: async (connection) => connectionSecrets.get(connection.id),
    gateway: {
      // A configured link uses the board command path when its resource is a
      // live block. The tiny in-memory projection remains a safe fallback for
      // external resources that have not been materialized as a board block.
      readLocal: async (link) => {
        try {
          const resource = await boardResource(link);
          if (resource?.block) return blockProjection(resource.block);
        } catch {
          // The link can be configured before a resource is materialized.
        }
        return clone(resourceStates.get(link.resource_id) ?? link.baseline);
      },
      applyInbound: async (link, patch, change) => {
        try {
          const resource = await boardResource(link);
          if (resource?.block) {
            const currentRevision = resource.state.head_revision;
            const result = await executeBoardCommand(
              resource.db,
              resource.workspaceId,
              link.board_id,
              {
                type: "agent",
                id: `connector_${link.connection_id}`,
                scopes: ["admin"],
                workspaceIds: [resource.workspaceId],
                projectIds: [],
              },
              {
                command_id: `sync-${link.id}-${change.delivery_id}`.slice(0, 128),
                kind: "block.update",
                target: { block_id: link.resource_id },
                payload: blockCommandPayload(resource.block, patch),
                expected: {
                  revision_id: currentRevision?.id,
                  document_id: String(resource.state.document.id),
                },
                causation_id: change.delivery_id,
              },
            );
            resourceStates.set(link.resource_id, blockProjection({
              ...resource.block,
              ...blockCommandPayload(resource.block, patch),
            }));
            await getAutomationEngine().processEvent({
              id: `sync:${link.id}:${change.delivery_id}`,
              type: "sync.inbound.applied",
              workspace_id: resource.workspaceId,
              board_id: link.board_id,
              revision_id: result.revision.id,
              source: "sync",
              effect_generation: resource.state.board.effect_generation,
              payload: { link_id: link.id, resource_id: link.resource_id, patch },
              created_at: result.revision.created_at,
            });
            return;
          }
        } catch {
          // Preserve deterministic connector behavior for a not-yet-created
          // block; a worker can retry/reconcile after materialization.
        }
        const current = resourceStates.get(link.resource_id) ?? link.baseline;
        resourceStates.set(link.resource_id, mergePatch(current, patch));
      },
      getEffectGeneration: async (boardId) => {
        const workspaceId = boardWorkspaceIds.get(boardId);
        if (!workspaceId) return undefined;
        try {
          const { db } = getDb();
          return (await getBoard(db, workspaceId, boardId)).effect_generation;
        } catch {
          return undefined;
        }
      },
    },
  });
}

let syncEngine = createReferenceSyncEngine();

export function getIntegrationSyncEngine(): SyncEngine {
  return syncEngine;
}

export function getSyncedResourceState(resourceId: string): JsonRecord | null {
  const value = resourceStates.get(resourceId);
  return value ? clone(value) : null;
}

export function resetIntegrationRoutesForTests(): void {
  connectionSecrets.clear();
  resourceStates.clear();
  boardWorkspaceIds.clear();
  syncEngine = createReferenceSyncEngine();
}

async function requireWorkspace(c: Context) {
  const auth = c.get("auth");
  const workspaceId = c.req.param("workspace");
  if (!workspaceId) throw badRequest("Missing workspace path parameter");
  const { db } = getDb();
  const workspace = await getWorkspaceById(db, workspaceId);
  if (!workspace) throw notFound(`Workspace '${workspaceId}' not found`);
  assertWorkspaceAccess(auth, workspace.id);
  return { auth, db, workspaceId };
}

async function requireBoard(c: Context) {
  const workspace = await requireWorkspace(c);
  const boardId = c.req.param("board");
  if (!boardId) throw badRequest("Missing board path parameter");
  await getBoard(workspace.db, workspace.workspaceId, boardId);
  return { ...workspace, boardId };
}

function parseBody(value: JsonRecord, workspaceId: string) {
  const parsed = createIntegrationConnectionSchema.safeParse({
    id: asString(value.id),
    provider: value.provider,
    display_name: value.display_name,
    workspace_id: workspaceId,
    organization_id: asString(value.organization_id) ?? null,
    capabilities: stringArray(value.capabilities) ?? [],
    status: value.status,
    secret_reference: asString(value.secret_reference) ?? null,
  });
  if (!parsed.success) throw badRequest(parsed.error.message);
  return parsed.data;
}

/**
 * Route factory for connection configuration, link setup, and provider-facing
 * webhook ingress. It deliberately does not mount itself so the API can place
 * it at the V2 root without coupling callers to an app singleton.
 */
export const integrationRoutes = new Hono();

// The provider ingress is intentionally outside the authenticated sub-app.
integrationRoutes.post("/integrations/webhooks/:connection", async (c) => {
  const connectionId = c.req.param("connection");
  if (!connectionId) throw badRequest("Missing connection path parameter");
  const rawBody = new Uint8Array(await c.req.arrayBuffer());
  const result = await syncEngine.ingestWebhook(
    connectionId,
    c.req.raw.headers,
    rawBody,
  );
  if (!result.accepted) {
    // Do not reveal whether a connection exists or which signature check failed.
    throw unauthorized("Invalid webhook delivery");
  }
  return c.json(result, 202);
});

const authenticatedIntegrationRoutes = new Hono();
authenticatedIntegrationRoutes.use("*", authMiddleware);

authenticatedIntegrationRoutes.get(
  "/workspaces/:workspace/integration-connections",
  requireScope("read", "admin"),
  async (c) => {
    const { workspaceId } = await requireWorkspace(c);
    return c.json({
      data: syncEngine
        .listConnections()
        .filter((connection) => connection.workspace_id === workspaceId),
    });
  },
);

authenticatedIntegrationRoutes.post(
  "/workspaces/:workspace/integration-connections",
  requireScope("admin"),
  async (c) => {
    const { workspaceId } = await requireWorkspace(c);
    const body = asRecord(await c.req.json());
    const connection = syncEngine.createConnection(parseBody(body, workspaceId));
    const webhookSecret = asString(body.webhook_secret);
    if (webhookSecret) connectionSecrets.set(connection.id, webhookSecret);
    return c.json(connection, 201);
  },
);

authenticatedIntegrationRoutes.get(
  "/workspaces/:workspace/boards/:board/sync-links",
  requireScope("read", "admin"),
  async (c) => {
    const { boardId } = await requireBoard(c);
    return c.json({ data: syncEngine.listLinks(boardId) });
  },
);

authenticatedIntegrationRoutes.post(
  "/workspaces/:workspace/boards/:board/sync-links",
  requireScope("admin"),
  async (c) => {
    const { workspaceId, boardId } = await requireBoard(c);
    const body = asRecord(await c.req.json());
    const parsed = createSyncLinkSchema.safeParse({
      id: asString(body.id),
      connection_id: body.connection_id,
      board_id: boardId,
      resource_id: body.resource_id,
      external_id: body.external_id,
      external_kind: body.external_kind,
      direction: body.direction,
      field_mappings: body.field_mappings,
      baseline: body.baseline,
      remote_version: asString(body.remote_version) ?? null,
      state: body.state,
    });
    if (!parsed.success) throw badRequest(parsed.error.message);
    const connection = syncEngine.getConnection(parsed.data.connection_id);
    if (!connection) throw notFound(`Integration connection '${parsed.data.connection_id}' not found`);
    if (connection.workspace_id !== workspaceId) {
      throw forbidden("Integration connection belongs to a different workspace");
    }
    const link = syncEngine.createLink(parsed.data);
    boardWorkspaceIds.set(boardId, workspaceId);
    resourceStates.set(link.resource_id, clone(link.baseline));
    return c.json(link, 201);
  },
);

integrationRoutes.route("/", authenticatedIntegrationRoutes);
