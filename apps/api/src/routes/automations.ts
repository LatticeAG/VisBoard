import type { Database } from "@visboard/db";
import { createAutomationRuleSchema } from "@visboard/shared";
import { type Context, Hono } from "hono";
import { authMiddleware, requireScope } from "../auth/middleware.js";
import { getDb, isPersistableDb } from "../db.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { assertWorkspaceAccess } from "../lib/helpers.js";
import { readJsonBody } from "../lib/json.js";
import { AutomationEngine, createDefaultExecutors } from "../services/automation.js";
import { getBoard } from "../services/board.js";
import { getWorkspaceById } from "../services/workspace.js";

type JsonRecord = Record<string, unknown>;
type Store = Database["db"];

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

let memoryEngine = new AutomationEngine({ executors: createDefaultExecutors() });
const persistableEngines = new WeakMap<object, AutomationEngine>();

export function getAutomationEngine(db?: Store): AutomationEngine {
  if (db && isPersistableDb(db)) {
    let engine = persistableEngines.get(db);
    if (!engine) {
      engine = new AutomationEngine({ db, executors: createDefaultExecutors() });
      persistableEngines.set(db, engine);
    }
    return engine;
  }
  return memoryEngine;
}

export function setAutomationEngine(engine: AutomationEngine): void {
  memoryEngine = engine;
  if (engine.db && isPersistableDb(engine.db)) {
    persistableEngines.set(engine.db, engine);
  }
}

/** Used by board/event wiring and route tests to create a clean reference worker. */
export function resetAutomationRoutesForTests(): void {
  memoryEngine = new AutomationEngine({ executors: createDefaultExecutors() });
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

async function assertRuleAccess(c: Context, runId: string) {
  const auth = c.get("auth");
  const { db } = getDb();
  const engine = getAutomationEngine(db);
  const run = engine.getRun(runId);
  if (!run) throw notFound(`Automation run '${runId}' not found`);
  const rule = engine.getRule(run.rule_id);
  if (!rule) throw notFound(`Automation rule '${run.rule_id}' not found`);
  if (!auth.workspaceIds.includes(rule.workspace_id)) {
    throw forbidden("You do not have access to this automation run");
  }
  return { run, rule, engine };
}

async function parseRuleForWorkspace(c: Context, workspaceId: string, body: JsonRecord) {
  const boardId = asString(body.board_id);
  if (boardId) {
    const { db } = getDb();
    await getBoard(db, workspaceId, boardId);
  }
  const parsed = createAutomationRuleSchema.safeParse({
    id: asString(body.id),
    workspace_id: workspaceId,
    board_id: boardId ?? null,
    name: body.name,
    enabled: body.enabled,
    trigger: body.trigger,
    idempotency_key_template: body.idempotency_key_template,
    cooldown_ms: body.cooldown_ms,
    actions: body.actions,
    created_by: c.get("auth").id,
    template_origin: asString(body.template_origin) ?? null,
  });
  if (!parsed.success) throw badRequest(parsed.error.message);
  return parsed.data;
}

/**
 * V2 automation administration. Board event dispatch calls
 * getAutomationEngine(db).processEvent after it commits its durable semantic event.
 */
export const automationRoutes = new Hono();
automationRoutes.use("*", authMiddleware);

automationRoutes.get(
  "/workspaces/:workspace/automation-rules",
  requireScope("read", "admin"),
  async (c) => {
    const { db, workspaceId } = await requireWorkspace(c);
    return c.json({ data: getAutomationEngine(db).listRules(workspaceId) });
  },
);

automationRoutes.post(
  "/workspaces/:workspace/automation-rules",
  requireScope("admin"),
  async (c) => {
    const { db, workspaceId } = await requireWorkspace(c);
    const engine = getAutomationEngine(db);
    const rule = engine.createRule(
      await parseRuleForWorkspace(c, workspaceId, asRecord(await readJsonBody(c))),
    );
    await engine.flush();
    return c.json(rule, 201);
  },
);

automationRoutes.patch(
  "/workspaces/:workspace/automation-rules/:rule",
  requireScope("admin"),
  async (c) => {
    const { db, workspaceId } = await requireWorkspace(c);
    const engine = getAutomationEngine(db);
    const ruleId = c.req.param("rule");
    if (!ruleId) throw badRequest("Missing rule path parameter");
    const current = engine.getRule(ruleId);
    if (!current || current.workspace_id !== workspaceId) {
      throw notFound(`Automation rule '${ruleId}' not found`);
    }
    const body = asRecord(await readJsonBody(c));
    const updated = engine.updateRule(ruleId, {
      ...(body.name === undefined ? {} : { name: body.name as string }),
      ...(body.enabled === undefined ? {} : { enabled: body.enabled as boolean }),
      ...(body.trigger === undefined ? {} : { trigger: body.trigger as typeof current.trigger }),
      ...(body.actions === undefined ? {} : { actions: body.actions as typeof current.actions }),
      ...(body.cooldown_ms === undefined ? {} : { cooldown_ms: body.cooldown_ms as number }),
      ...(body.idempotency_key_template === undefined
        ? {}
        : { idempotency_key_template: body.idempotency_key_template as string }),
    });
    if (!updated) throw notFound(`Automation rule '${ruleId}' not found`);
    await engine.flush();
    return c.json(updated);
  },
);

automationRoutes.get(
  "/workspaces/:workspace/automation-runs",
  requireScope("read", "admin"),
  async (c) => {
    const { db, workspaceId } = await requireWorkspace(c);
    const engine = getAutomationEngine(db);
    const ruleId = c.req.query("rule");
    const runs = engine.listRuns(ruleId).filter((run) => {
      const rule = engine.getRule(run.rule_id);
      return rule?.workspace_id === workspaceId;
    });
    return c.json({ data: runs });
  },
);

automationRoutes.get("/automation-runs/:run", requireScope("read", "admin"), async (c) => {
  const runId = c.req.param("run");
  if (!runId) throw badRequest("Missing run path parameter");
  const { run } = await assertRuleAccess(c, runId);
  return c.json(run);
});

automationRoutes.post(
  "/automation-runs/:run/actions/:action/approve",
  requireScope("admin"),
  async (c) => {
    const runId = c.req.param("run");
    const actionId = c.req.param("action");
    if (!runId || !actionId) throw badRequest("Missing run or action path parameter");
    const { engine } = await assertRuleAccess(c, runId);
    const updated = await engine.approveAction(runId, actionId, undefined, c.get("auth").id);
    if (!updated) throw notFound(`Automation run '${runId}' not found`);
    return c.json(updated);
  },
);

automationRoutes.post(
  "/automation-runs/:run/actions/:action/retry",
  requireScope("admin"),
  async (c) => {
    const runId = c.req.param("run");
    const actionId = c.req.param("action");
    if (!runId || !actionId) throw badRequest("Missing run or action path parameter");
    const { engine } = await assertRuleAccess(c, runId);
    const updated = await engine.retryAction(runId, actionId);
    if (!updated) throw notFound(`Automation run '${runId}' not found`);
    return c.json(updated);
  },
);
