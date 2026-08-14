import {
  AgentConflictError,
  AgentIsolationError,
  AgentLeaseError,
  type AgentMode,
  AgentModeError,
  type AgentRunAccess,
  type AgentTransport,
  type AgentWorkspaceProfile,
  type HandoffDecisionOutcome,
  HandoffStateError,
  InMemoryAgentTransport,
} from "@visboard/agent-sdk";
import { type Context, Hono } from "hono";
import { authMiddleware, requireScope } from "../auth/middleware.js";
import { getDb } from "../db.js";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  notImplemented,
  preconditionFailed,
} from "../lib/errors.js";
import { assertWorkspaceAccess } from "../lib/helpers.js";
import { getBoard } from "../services/board.js";
import { getWorkspaceById } from "../services/workspace.js";

type JsonRecord = Record<string, unknown>;

let transport: AgentTransport = new InMemoryAgentTransport();

/** Reference-runtime reset for isolated API tests and local development. */
export function resetAgentWorkflowRuntimeForTests(): void {
  transport = new InMemoryAgentTransport();
}

export function setAgentWorkflowTransport(next: AgentTransport): void {
  transport = next;
}

export function getAgentWorkflowTransportForTests(): AgentTransport {
  return transport;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw badRequest(`${field} must be a string`);
  return value;
}

function requiredString(value: unknown, field: string): string {
  const result = optionalString(value, field);
  if (!result) throw badRequest(`${field} is required`);
  return result;
}

function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw badRequest(`${field} must be a finite number`);
  }
  return value;
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw badRequest(`${field} must be an array of strings`);
  }
  return value;
}

function readBody(value: unknown): JsonRecord {
  if (!isRecord(value)) throw badRequest("Request body must be a JSON object");
  return value;
}

function accessFrom(value: unknown): AgentRunAccess {
  if (!isRecord(value)) throw badRequest("access with run_id and lease_id is required");
  return {
    run_id: requiredString(value.run_id, "access.run_id"),
    lease_id: requiredString(value.lease_id, "access.lease_id"),
  };
}

function queryAccess(c: Context, body?: JsonRecord): AgentRunAccess {
  if (body && isRecord(body.access)) {
    return accessFrom(body.access);
  }
  const runId = c.req.header("X-Visboard-Run-Id") ?? c.req.query("run_id");
  const leaseId = c.req.header("X-Visboard-Lease-Id") ?? c.req.query("lease_id");
  return {
    run_id: requiredString(runId, "run_id"),
    lease_id: requiredString(leaseId, "lease_id"),
  };
}

function agentMode(value: unknown): AgentMode {
  if (value === "observe" || value === "propose" || value === "contribute" || value === "operate") {
    return value;
  }
  throw badRequest("mode must be observe, propose, contribute, or operate");
}

function workspaceProfile(value: unknown): AgentWorkspaceProfile {
  if (
    value === "external" ||
    value === "container" ||
    value === "git_worktree" ||
    value === "remote_runner"
  ) {
    return value;
  }
  throw badRequest("profile must be external, container, git_worktree, or remote_runner");
}

function handoffOutcome(value: unknown): HandoffDecisionOutcome {
  if (
    value === "approve" ||
    value === "approve_with_conditions" ||
    value === "request_changes" ||
    value === "reject" ||
    value === "delegate" ||
    value === "request_replan"
  ) {
    return value;
  }
  throw badRequest("Invalid handoff decision outcome");
}

async function requireV2Board(c: Context) {
  const auth = c.get("auth");
  const workspaceId = c.req.param("workspace");
  const boardId = c.req.param("board");
  if (!workspaceId || !boardId) {
    throw badRequest("Missing workspace or board path parameter");
  }
  const { db } = getDb();
  const workspace = await getWorkspaceById(db, workspaceId);
  if (!workspace) throw notFound(`Workspace '${workspaceId}' not found`);
  assertWorkspaceAccess(auth, workspace.id);
  await getBoard(db, workspaceId, boardId);
  return { auth, boardId };
}

function assertAgentIdentity(auth: { type: "user" | "agent"; id: string }, agentId: string): void {
  if (auth.type === "agent" && auth.id !== agentId) {
    throw forbidden("An agent credential can only start work for its own agent identity");
  }
}

function requireHumanReviewer(auth: { type: "user" | "agent"; id: string }): void {
  if (auth.type !== "user") {
    throw forbidden("Only a human reviewer can claim or decide a handoff");
  }
}

function filePath(c: Context): string {
  const path = c.req.param("path");
  if (!path) throw badRequest("A workspace file path is required");
  return path;
}

async function runAgentOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof AgentIsolationError || error instanceof AgentModeError) {
      throw forbidden(message);
    }
    if (error instanceof AgentConflictError) {
      throw preconditionFailed(message);
    }
    if (error instanceof HandoffStateError && error.code === "handoff.belief_trace_required") {
      throw badRequest("belief_trace is required to submit a handoff");
    }
    if (error instanceof AgentLeaseError || error instanceof HandoffStateError) {
      throw conflict(message);
    }
    throw error;
  }
}

/**
 * V2 governed agent runtime reference endpoints. The transport enforces
 * board-bound runs, short leases, normalized paths, ETags, and the handoff
 * freeze; these routes only authenticate the caller and bind canonical IDs.
 */
export const agentWorkflowRoutes = new Hono();

agentWorkflowRoutes.use("*", authMiddleware);

agentWorkflowRoutes.get("/:board/context", requireScope("read", "admin"), async (c) => {
  const { boardId } = await requireV2Board(c);
  const purpose = c.req.query("purpose") ?? "planning";
  if (
    ![
      "planning",
      "implementation",
      "review",
      "incident_response",
      "sync_resolution",
      "handoff_follow_up",
    ].includes(purpose)
  ) {
    throw badRequest("Invalid context purpose");
  }
  return c.json(
    await runAgentOperation(() =>
      transport.getContext({
        board_id: boardId,
        purpose: purpose as Parameters<typeof transport.getContext>[0]["purpose"],
        at_revision: c.req.query("at_revision"),
        block_ids: c.req.query("block_ids")?.split(",").filter(Boolean),
        include_agents_md: c.req.query("include_agents_md") !== "false",
      }),
    ),
  );
});

agentWorkflowRoutes.post(
  "/:board/agent-runs",
  requireScope("write:notes", "write:files", "admin"),
  async (c) => {
    const { auth, boardId } = await requireV2Board(c);
    const body = readBody(await c.req.json());
    const agentId = requiredString(body.agent_id, "agent_id");
    assertAgentIdentity(auth, agentId);
    const run = await runAgentOperation(() =>
      transport.startRun({
        board_id: boardId,
        agent_id: agentId,
        mode: agentMode(body.mode ?? "contribute"),
        goal: requiredString(body.goal, "goal"),
        base_revision_id: optionalString(body.base_revision_id, "base_revision_id"),
        agent_workspace_id: optionalString(body.agent_workspace_id, "agent_workspace_id"),
        requested_capabilities: optionalStringArray(
          body.requested_capabilities,
          "requested_capabilities",
        ),
        allowed_paths: optionalStringArray(body.allowed_paths, "allowed_paths"),
        lease_duration_ms: optionalNumber(body.lease_duration_ms, "lease_duration_ms"),
        resumed_from_handoff_id: optionalString(
          body.resumed_from_handoff_id,
          "resumed_from_handoff_id",
        ),
      }),
    );
    return c.json(run, 201);
  },
);

agentWorkflowRoutes.get("/:board/agent-runs/:run", requireScope("read", "admin"), async (c) => {
  const { boardId } = await requireV2Board(c);
  const runId = requiredString(c.req.param("run"), "run");
  return c.json(
    await runAgentOperation(() => transport.getRun({ board_id: boardId, run_id: runId })),
  );
});

agentWorkflowRoutes.post(
  "/:board/agent-runs/:run/heartbeats",
  requireScope("write:notes", "write:files", "admin"),
  async (c) => {
    const { boardId } = await requireV2Board(c);
    const body = readBody(await c.req.json());
    return c.json(
      await runAgentOperation(() =>
        transport.heartbeat({ board_id: boardId, access: accessFrom(body.access) }),
      ),
    );
  },
);

agentWorkflowRoutes.post(
  "/:board/agent-runs/:run/lease-renewals",
  requireScope("write:notes", "write:files", "admin"),
  async (c) => {
    const { boardId } = await requireV2Board(c);
    const body = readBody(await c.req.json());
    return c.json(
      await runAgentOperation(() =>
        transport.renewLease({
          board_id: boardId,
          access: accessFrom(body.access),
          duration_ms: optionalNumber(body.duration_ms, "duration_ms"),
        }),
      ),
    );
  },
);

function runFinishRoute(
  suffix: "complete" | "fail" | "cancel",
  operation: "completeRun" | "failRun" | "cancelRun",
) {
  agentWorkflowRoutes.post(
    `/:board/agent-runs/:run/${suffix}`,
    requireScope("write:notes", "write:files", "admin"),
    async (c) => {
      const { boardId } = await requireV2Board(c);
      const body = readBody(await c.req.json());
      const access = accessFrom(body.access);
      if (operation === "cancelRun") {
        return c.json(
          await runAgentOperation(() => transport.cancelRun({ board_id: boardId, access })),
        );
      }
      const summary = requiredString(body.summary, "summary");
      return c.json(
        await runAgentOperation(() =>
          operation === "completeRun"
            ? transport.completeRun({ board_id: boardId, access, summary })
            : transport.failRun({ board_id: boardId, access, summary }),
        ),
      );
    },
  );
}

runFinishRoute("complete", "completeRun");
runFinishRoute("fail", "failRun");
runFinishRoute("cancel", "cancelRun");

agentWorkflowRoutes.post(
  "/:board/agent-workspaces",
  requireScope("write:files", "admin"),
  async (c) => {
    const { auth, boardId } = await requireV2Board(c);
    const body = readBody(await c.req.json());
    const agentId = requiredString(body.agent_id, "agent_id");
    assertAgentIdentity(auth, agentId);
    return c.json(
      await runAgentOperation(() =>
        transport.createWorkspace({
          board_id: boardId,
          agent_id: agentId,
          access: accessFrom(body.access),
          profile: workspaceProfile(body.profile),
          source: optionalString(body.source, "source"),
          branch: optionalString(body.branch, "branch"),
          root_label: optionalString(body.root_label, "root_label"),
          quota_bytes: optionalNumber(body.quota_bytes, "quota_bytes"),
        }),
      ),
      201,
    );
  },
);

agentWorkflowRoutes.get(
  "/:board/agent-workspaces/:agent_workspace/tree",
  requireScope("read", "admin"),
  async (c) => {
    const { boardId } = await requireV2Board(c);
    const workspaceId = requiredString(c.req.param("agent_workspace"), "agent_workspace");
    const rawLimit = c.req.query("limit");
    const limit = rawLimit === undefined ? undefined : Number(rawLimit);
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) {
      throw badRequest("limit must be a positive integer");
    }
    return c.json(
      await runAgentOperation(() =>
        transport.listFiles({
          board_id: boardId,
          agent_workspace_id: workspaceId,
          access: queryAccess(c),
          path: c.req.query("path"),
          cursor: c.req.query("cursor"),
          limit,
        }),
      ),
    );
  },
);

agentWorkflowRoutes.get(
  "/:board/agent-workspaces/:agent_workspace/scratchpad",
  requireScope("read", "admin"),
  async (c) => {
    const { boardId } = await requireV2Board(c);
    return c.json(
      await runAgentOperation(() =>
        transport.getScratchpad({
          board_id: boardId,
          agent_workspace_id: requiredString(c.req.param("agent_workspace"), "agent_workspace"),
          access: queryAccess(c),
        }),
      ),
    );
  },
);

agentWorkflowRoutes.put(
  "/:board/agent-workspaces/:agent_workspace/scratchpad",
  requireScope("write:notes", "write:files", "admin"),
  async (c) => {
    const { boardId } = await requireV2Board(c);
    const body = readBody(await c.req.json());
    return c.json(
      await runAgentOperation(() =>
        transport.updateScratchpad({
          board_id: boardId,
          agent_workspace_id: requiredString(c.req.param("agent_workspace"), "agent_workspace"),
          access: accessFrom(body.access),
          content: requiredString(body.content, "content"),
          expected_etag: optionalString(body.expected_etag, "expected_etag") ?? null,
        }),
      ),
    );
  },
);

agentWorkflowRoutes.get(
  "/:board/agent-workspaces/:agent_workspace/files/:path{.+}",
  requireScope("read", "admin"),
  async (c) => {
    const { boardId } = await requireV2Board(c);
    return c.json(
      await runAgentOperation(() =>
        transport.readFile({
          board_id: boardId,
          agent_workspace_id: requiredString(c.req.param("agent_workspace"), "agent_workspace"),
          path: filePath(c),
          access: queryAccess(c),
        }),
      ),
    );
  },
);

agentWorkflowRoutes.put(
  "/:board/agent-workspaces/:agent_workspace/files/:path{.+}",
  requireScope("write:files", "admin"),
  async (c) => {
    const { boardId } = await requireV2Board(c);
    const body = readBody(await c.req.json());
    if (body.generated !== undefined && typeof body.generated !== "boolean") {
      throw badRequest("generated must be a boolean");
    }
    return c.json(
      await runAgentOperation(() =>
        transport.writeFile({
          board_id: boardId,
          agent_workspace_id: requiredString(c.req.param("agent_workspace"), "agent_workspace"),
          path: filePath(c),
          access: accessFrom(body.access),
          content: requiredString(body.content, "content"),
          expected_etag: optionalString(body.expected_etag, "expected_etag") ?? null,
          generated: body.generated as boolean | undefined,
        }),
      ),
    );
  },
);

agentWorkflowRoutes.delete(
  "/:board/agent-workspaces/:agent_workspace/files/:path{.+}",
  requireScope("write:files", "admin"),
  async (c) => {
    const { boardId } = await requireV2Board(c);
    const body = readBody(await c.req.json());
    await runAgentOperation(() =>
      transport.deleteFile({
        board_id: boardId,
        agent_workspace_id: requiredString(c.req.param("agent_workspace"), "agent_workspace"),
        path: filePath(c),
        access: accessFrom(body.access),
        expected_etag: requiredString(body.expected_etag, "expected_etag"),
      }),
    );
    return c.body(null, 204);
  },
);

agentWorkflowRoutes.get(
  "/:board/agent-workspaces/:agent_workspace",
  requireScope("read", "admin"),
  async (c) => {
    const { boardId } = await requireV2Board(c);
    return c.json(
      await runAgentOperation(() =>
        transport.getWorkspace({
          board_id: boardId,
          agent_workspace_id: requiredString(c.req.param("agent_workspace"), "agent_workspace"),
          access: queryAccess(c),
        }),
      ),
    );
  },
);

agentWorkflowRoutes.get("/:board/handoffs", requireScope("read", "admin"), async (c) => {
  const { boardId } = await requireV2Board(c);
  const state = c.req.query("state");
  return c.json(
    await runAgentOperation(() =>
      transport.listHandoffs({
        board_id: boardId,
        state: state as Parameters<typeof transport.listHandoffs>[0]["state"],
      }),
    ),
  );
});

agentWorkflowRoutes.post("/:board/handoffs", requireScope("write:notes", "admin"), async (c) => {
  const { boardId } = await requireV2Board(c);
  const body = readBody(await c.req.json());
  if (!isRecord(body.packet)) throw badRequest("packet is required");
  return c.json(
    await runAgentOperation(() =>
      transport.createHandoff({
        board_id: boardId,
        access: accessFrom(body.access),
        agent_workspace_id: optionalString(body.agent_workspace_id, "agent_workspace_id"),
        revision_id: optionalString(body.revision_id, "revision_id"),
        packet: body.packet as Parameters<typeof transport.createHandoff>[0]["packet"],
      }),
    ),
    201,
  );
});

agentWorkflowRoutes.get(
  "/:board/handoffs/:handoff/belief-trace",
  requireScope("read", "admin"),
  async (c) => {
    const { boardId } = await requireV2Board(c);
    const handoffId = requiredString(c.req.param("handoff"), "handoff");
    try {
      const handoff = await transport.getHandoff({
        board_id: boardId,
        handoff_id: handoffId,
      });
      if (!handoff.packet.belief_trace || !handoff.belief_trace_hash || !handoff.packet_hash) {
        throw notFound(`Belief trace for handoff '${handoffId}' was not found`);
      }
      return c.json({
        trace: handoff.packet.belief_trace,
        belief_trace_hash: handoff.belief_trace_hash,
        packet_hash: handoff.packet_hash,
      });
    } catch (error) {
      if (error instanceof AgentIsolationError) {
        throw notFound(`Belief trace for handoff '${handoffId}' was not found`);
      }
      throw error;
    }
  },
);

agentWorkflowRoutes.post(
  "/:board/agent-workspaces/:agent_workspace/terminal-sessions",
  requireScope("write:files", "admin"),
  async () => {
    throw notImplemented("Agent terminal sessions are not implemented in this cycle");
  },
);

agentWorkflowRoutes.get("/:board/handoffs/:handoff", requireScope("read", "admin"), async (c) => {
  const { boardId } = await requireV2Board(c);
  return c.json(
    await runAgentOperation(() =>
      transport.getHandoff({
        board_id: boardId,
        handoff_id: requiredString(c.req.param("handoff"), "handoff"),
      }),
    ),
  );
});

agentWorkflowRoutes.post(
  "/:board/handoffs/:handoff/submit",
  requireScope("write:notes", "admin"),
  async (c) => {
    const { boardId } = await requireV2Board(c);
    const body = readBody(await c.req.json());
    return c.json(
      await runAgentOperation(() =>
        transport.submitHandoff({
          board_id: boardId,
          handoff_id: requiredString(c.req.param("handoff"), "handoff"),
          access: accessFrom(body.access),
        }),
      ),
    );
  },
);

agentWorkflowRoutes.post("/:board/handoffs/:handoff/claim", requireScope("admin"), async (c) => {
  const { auth, boardId } = await requireV2Board(c);
  requireHumanReviewer(auth);
  return c.json(
    await runAgentOperation(() =>
      transport.claimHandoff({
        board_id: boardId,
        handoff_id: requiredString(c.req.param("handoff"), "handoff"),
        reviewer_id: auth.id,
      }),
    ),
  );
});

agentWorkflowRoutes.post(
  "/:board/handoffs/:handoff/decisions",
  requireScope("admin"),
  async (c) => {
    const { auth, boardId } = await requireV2Board(c);
    requireHumanReviewer(auth);
    const body = readBody(await c.req.json());
    if (body.conditions !== undefined && !isRecord(body.conditions)) {
      throw badRequest("conditions must be an object");
    }
    return c.json(
      await runAgentOperation(() =>
        transport.decideHandoff({
          board_id: boardId,
          handoff_id: requiredString(c.req.param("handoff"), "handoff"),
          reviewer_id: auth.id,
          outcome: handoffOutcome(body.outcome),
          rationale: optionalString(body.rationale, "rationale"),
          conditions: body.conditions as Record<string, unknown> | undefined,
        }),
      ),
    );
  },
);

agentWorkflowRoutes.post(
  "/:board/handoffs/:handoff/resume",
  requireScope("write:notes", "write:files", "admin"),
  async (c) => {
    const { auth, boardId } = await requireV2Board(c);
    const body = readBody(await c.req.json());
    const agentId = requiredString(body.agent_id, "agent_id");
    assertAgentIdentity(auth, agentId);
    return c.json(
      await runAgentOperation(() =>
        transport.resumeHandoff({
          board_id: boardId,
          handoff_id: requiredString(c.req.param("handoff"), "handoff"),
          agent_id: agentId,
          mode: body.mode === undefined ? undefined : agentMode(body.mode),
          goal: optionalString(body.goal, "goal"),
          requested_capabilities: optionalStringArray(
            body.requested_capabilities,
            "requested_capabilities",
          ),
          allowed_paths: optionalStringArray(body.allowed_paths, "allowed_paths"),
          lease_duration_ms: optionalNumber(body.lease_duration_ms, "lease_duration_ms"),
        }),
      ),
    );
  },
);
