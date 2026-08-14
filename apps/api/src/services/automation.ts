import { createHmac } from "node:crypto";
import { type Database, automationActionRuns, automationRules, automationRuns } from "@visboard/db";
import { createId } from "@visboard/shared";
import type {
  AutomationAction,
  AutomationActionRun,
  AutomationActionState,
  AutomationActionType,
  AutomationCondition,
  AutomationRule,
  AutomationRun,
  CreateAutomationRule,
  SemanticEvent,
} from "@visboard/shared";
import { automationRuleSchema, semanticEventSchema } from "@visboard/shared";
import { eq, inArray } from "drizzle-orm";
import { isPersistableDb } from "../db.js";

type JsonRecord = Record<string, unknown>;
type Store = Database["db"];

type StoredActionRun = AutomationActionRun & {
  row_id: string;
  approved_by: string | null;
  approved_at: string | null;
};

type RunContext = {
  event: SemanticEvent;
  rule_version: number;
  board_id: string | null;
  idempotency_key: string;
  dedupe_key: string;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function valueAt(source: unknown, path: string): unknown {
  const [root, ...parts] = path.split(".");
  let value: unknown;
  if (root === "event") value = source;
  else if (root === "payload" && isRecord(source)) value = source.payload;
  else return undefined;

  for (const part of parts) {
    if (!isRecord(value)) return undefined;
    value = value[part];
  }
  return value;
}

function conditionMatches(event: SemanticEvent, condition: AutomationCondition): boolean {
  const actual = valueAt(event, condition.path);
  switch (condition.operator) {
    case "exists":
      return actual !== undefined && actual !== null;
    case "equals":
      return stableStringify(actual) === stableStringify(condition.value);
    case "not_equals":
      return stableStringify(actual) !== stableStringify(condition.value);
    case "in":
      return Array.isArray(condition.value)
        ? condition.value.some((value) => stableStringify(actual) === stableStringify(value))
        : false;
    case "contains":
      if (typeof actual === "string" && typeof condition.value === "string") {
        return actual.includes(condition.value);
      }
      return Array.isArray(actual)
        ? actual.some((value) => stableStringify(value) === stableStringify(condition.value))
        : false;
  }
}

function causationDepth(event: SemanticEvent): number {
  const payload = event.payload;
  const raw = payload.causation_depth ?? payload._causation_depth;
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : 0;
}

function renderIdempotencyTemplate(
  template: string,
  event: SemanticEvent,
  rule: AutomationRule,
): string {
  const values: Record<string, string> = {
    "event.id": event.id,
    "event.type": event.type,
    "event.board_id": event.board_id ?? "",
    "event.revision_id": event.revision_id ?? "",
    "rule.id": rule.id,
    "rule.version": String(rule.version),
  };

  return template.replace(/\{([^}]+)\}|\b(?:event|rule)\.[a-z_]+\b/g, (match, braced) => {
    const key = braced ?? match;
    return values[key] ?? "";
  });
}

function runState(actions: readonly AutomationActionRun[]): AutomationRun["state"] {
  if (actions.some((action) => action.state === "awaiting_approval")) {
    return "awaiting_approval";
  }
  if (actions.some((action) => action.state === "running")) return "running";
  if (actions.some((action) => action.state === "pending")) return "pending";
  if (actions.some((action) => action.state === "failed")) return "failed";
  if (actions.some((action) => action.state === "blocked")) return "blocked";
  if (actions.every((action) => action.state === "skipped")) return "skipped";
  return "succeeded";
}

function isTerminal(state: AutomationActionState): boolean {
  return ["succeeded", "failed", "blocked", "skipped"].includes(state);
}

function validateActionGraph(actions: readonly AutomationAction[]): void {
  const byId = new Map<string, AutomationAction>();
  for (const action of actions) {
    if (byId.has(action.id)) {
      throw new Error(`Automation action id '${action.id}' is duplicated`);
    }
    byId.set(action.id, action);
  }
  for (const action of actions) {
    for (const dependency of action.depends_on) {
      if (!byId.has(dependency)) {
        throw new Error(
          `Automation action '${action.id}' depends on unknown action '${dependency}'`,
        );
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error("Automation action dependencies contain a cycle");
    visiting.add(id);
    const action = byId.get(id);
    for (const dependency of action?.depends_on ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const action of actions) visit(action.id);
}

function publicRun(run: AutomationRun): AutomationRun {
  return clone({
    ...run,
    actions: run.actions.map((action) => ({
      action_id: action.action_id,
      state: action.state,
      attempts: action.attempts,
      error: action.error ?? null,
      result: action.result ?? null,
      updated_at: action.updated_at,
    })),
  });
}

function asStoredActions(actions: AutomationActionRun[]): StoredActionRun[] {
  return actions.map((action) => {
    const stored = action as StoredActionRun;
    return {
      ...action,
      row_id: stored.row_id ?? createId("aact"),
      approved_by: stored.approved_by ?? null,
      approved_at: stored.approved_at ?? null,
    };
  });
}

export interface AutomationExecutionContext {
  rule: AutomationRule;
  run: AutomationRun;
  action: AutomationAction;
  event: SemanticEvent;
  idempotencyKey: string;
  causationDepth: number;
}

export type AutomationActionExecutor = (
  context: AutomationExecutionContext,
) => Promise<Record<string, unknown> | undefined>;

export interface AutomationEngineOptions {
  executors?: Partial<Record<AutomationActionType, AutomationActionExecutor>>;
  /** Reads the current board fence before each external effect. */
  getEffectGeneration?: (boardId: string) => Promise<number | undefined>;
  now?: () => Date;
  db?: Store;
}

/**
 * Runs declarative automation rules against committed semantic events.
 * Construct without db for in-memory unit tests. Pass db to persist rules,
 * runs, and action runs.
 */
export class AutomationEngine {
  private readonly rules = new Map<string, AutomationRule>();
  private readonly runs = new Map<string, AutomationRun>();
  private readonly runsByDedupe = new Map<string, string>();
  private readonly cooldowns = new Map<string, number>();
  private readonly eventsByRun = new Map<string, SemanticEvent>();
  private readonly dedupeByRun = new Map<string, string>();
  private readonly executors: Partial<Record<AutomationActionType, AutomationActionExecutor>>;
  private readonly now: () => Date;
  readonly db: Store | undefined;
  private persistChain: Promise<void> = Promise.resolve();

  constructor(private readonly options: AutomationEngineOptions = {}) {
    this.executors = { ...options.executors };
    this.now = options.now ?? (() => new Date());
    this.db = options.db;
  }

  hydrateRule(rule: AutomationRule): void {
    this.rules.set(rule.id, clone(rule));
  }

  registerExecutor(type: AutomationActionType, executor: AutomationActionExecutor): void {
    this.executors[type] = executor;
  }

  async flush(): Promise<void> {
    await this.persistChain;
  }

  async flushPersist(): Promise<void> {
    await this.flush();
  }

  createRule(input: CreateAutomationRule): AutomationRule {
    const now = this.now().toISOString();
    const rule = automationRuleSchema.parse({
      ...input,
      id: input.id ?? createId("arule"),
      version: 1,
      created_at: now,
      updated_at: now,
    });
    validateActionGraph(rule.actions);
    this.rules.set(rule.id, rule);
    this.enqueuePersist(() => this.saveRule(rule));
    return clone(rule);
  }

  updateRule(
    id: string,
    update: Partial<Omit<AutomationRule, "id" | "created_at" | "version">>,
  ): AutomationRule | null {
    const current = this.rules.get(id);
    if (!current) return null;
    const next = automationRuleSchema.parse({
      ...current,
      ...update,
      id,
      version: current.version + 1,
      created_at: current.created_at,
      updated_at: this.now().toISOString(),
    });
    validateActionGraph(next.actions);
    this.rules.set(id, next);
    this.enqueuePersist(() => this.saveRule(next));
    return clone(next);
  }

  getRule(id: string): AutomationRule | null {
    const rule = this.rules.get(id);
    return rule ? clone(rule) : null;
  }

  listRules(workspaceId?: string): AutomationRule[] {
    return [...this.rules.values()]
      .filter((rule) => !workspaceId || rule.workspace_id === workspaceId)
      .map(clone);
  }

  getRun(id: string): AutomationRun | null {
    const run = this.runs.get(id);
    return run ? publicRun(run) : null;
  }

  listRuns(ruleId?: string): AutomationRun[] {
    return [...this.runs.values()]
      .filter((run) => !ruleId || run.rule_id === ruleId)
      .map(publicRun);
  }

  async processEvent(rawEvent: SemanticEvent): Promise<AutomationRun[]> {
    const event = semanticEventSchema.parse(rawEvent);
    const created: AutomationRun[] = [];
    const nowMs = this.now().getTime();

    for (const rule of this.rules.values()) {
      if (!this.matches(rule, event)) continue;

      const cooldownKey = `${rule.id}:${event.board_id ?? ""}`;
      const previous = this.cooldowns.get(cooldownKey);
      if (previous !== undefined && nowMs - previous < rule.cooldown_ms) continue;

      const idempotencyKey = renderIdempotencyTemplate(rule.idempotency_key_template, event, rule);
      const dedupeKey = `${rule.id}:${rule.version}:${idempotencyKey}`;
      const existingId = this.runsByDedupe.get(dedupeKey);
      if (existingId) {
        const existing = this.runs.get(existingId);
        if (existing) created.push(publicRun(existing));
        continue;
      }
      const persisted = await this.findRunByDedupe(dedupeKey);
      if (persisted) {
        created.push(publicRun(persisted));
        continue;
      }

      const timestamp = this.now().toISOString();
      const run: AutomationRun = {
        id: createId("arunjob"),
        rule_id: rule.id,
        rule_version: rule.version,
        event_id: event.id,
        board_id: event.board_id ?? null,
        effect_generation: event.effect_generation,
        idempotency_key: idempotencyKey,
        state: "pending",
        actions: asStoredActions(
          rule.actions.map((action) => ({
            action_id: action.id,
            state: "pending",
            attempts: 0,
            error: null,
            result: null,
            updated_at: timestamp,
          })),
        ),
        created_at: timestamp,
        updated_at: timestamp,
      };
      this.runs.set(run.id, run);
      this.eventsByRun.set(run.id, clone(event));
      this.runsByDedupe.set(dedupeKey, run.id);
      this.dedupeByRun.set(run.id, dedupeKey);
      this.cooldowns.set(cooldownKey, nowMs);
      await this.saveRun(run, event, dedupeKey);
      await this.execute(run.id, rule, event);
      const completed = this.runs.get(run.id);
      if (completed) {
        await this.saveRun(completed, event, dedupeKey);
        created.push(publicRun(completed));
      }
    }

    return created;
  }

  async approveAction(
    runId: string,
    actionId: string,
    event?: SemanticEvent,
    approvedBy?: string,
  ): Promise<AutomationRun | null> {
    const run = this.runs.get(runId);
    const rule = run ? this.rules.get(run.rule_id) : undefined;
    if (!run || !rule) return null;
    const sourceEvent = event ? semanticEventSchema.parse(event) : this.eventsByRun.get(runId);
    if (!sourceEvent) return publicRun(run);
    const actionRun = asStoredActions(run.actions).find((action) => action.action_id === actionId);
    if (!actionRun || actionRun.state !== "awaiting_approval") return publicRun(run);
    actionRun.approved_by = approvedBy ?? null;
    actionRun.approved_at = this.now().toISOString();
    actionRun.state = "pending";
    actionRun.updated_at = this.now().toISOString();
    run.actions = run.actions.map((action) =>
      action.action_id === actionId ? actionRun : (action as StoredActionRun),
    );
    run.state = "pending";
    run.updated_at = this.now().toISOString();
    this.runs.set(run.id, run);
    await this.execute(run.id, rule, sourceEvent);
    const completed = this.runs.get(run.id);
    if (!completed) throw new Error(`Automation run '${run.id}' missing after approval`);
    const dedupeKey = this.dedupeByRun.get(run.id);
    if (dedupeKey) await this.saveRun(completed, sourceEvent, dedupeKey);
    return publicRun(completed);
  }

  async retryAction(
    runId: string,
    actionId: string,
    event?: SemanticEvent,
  ): Promise<AutomationRun | null> {
    const run = this.runs.get(runId);
    const rule = run ? this.rules.get(run.rule_id) : undefined;
    if (!run || !rule) return null;
    const sourceEvent = event ? semanticEventSchema.parse(event) : this.eventsByRun.get(runId);
    if (!sourceEvent) return publicRun(run);
    const actionRun = run.actions.find((action) => action.action_id === actionId);
    if (!actionRun || !["failed", "blocked"].includes(actionRun.state)) return publicRun(run);
    actionRun.state = "pending";
    actionRun.error = null;
    actionRun.updated_at = this.now().toISOString();
    run.state = "pending";
    run.updated_at = this.now().toISOString();
    this.runs.set(run.id, run);
    await this.execute(run.id, rule, sourceEvent);
    const completed = this.runs.get(run.id);
    if (!completed) throw new Error(`Automation run '${run.id}' missing after retry`);
    const dedupeKey = this.dedupeByRun.get(run.id);
    if (dedupeKey) await this.saveRun(completed, sourceEvent, dedupeKey);
    return publicRun(completed);
  }

  async recoverPendingRuns(): Promise<void> {
    const db = this.db;
    if (!db) return;
    const rows = await db
      .select()
      .from(automationRuns)
      .where(inArray(automationRuns.state, ["pending", "running"]));
    for (const row of rows) {
      if (row.state === "awaiting_approval") continue;
      const context = row.context as RunContext;
      const actionRows = await db
        .select()
        .from(automationActionRuns)
        .where(eq(automationActionRuns.runId, row.id));
      for (const action of actionRows) {
        if (
          action.state === "awaiting_approval" ||
          isTerminal(action.state as AutomationActionState)
        ) {
          continue;
        }
        const detail = isRecord(action.detail) ? action.detail : {};
        await db
          .update(automationActionRuns)
          .set({
            state: "pending",
            detail: { ...detail, attempts: 0 },
          })
          .where(eq(automationActionRuns.id, action.id));
      }
      await db
        .update(automationRuns)
        .set({ state: "pending", updatedAt: this.now() })
        .where(eq(automationRuns.id, row.id));
      if (!context?.event) continue;
      this.hydrateStoredRun(row, actionRows, context, true);
      const rule = this.rules.get(row.ruleId);
      if (!rule) continue;
      await this.execute(row.id, rule, context.event);
      const completed = this.runs.get(row.id);
      if (completed) await this.saveRun(completed, context.event, row.dedupeKey);
    }
  }

  private matches(rule: AutomationRule, event: SemanticEvent): boolean {
    if (!rule.enabled) return false;
    if (rule.board_id && rule.board_id !== event.board_id) return false;
    if (!rule.trigger.event_types.includes(event.type)) return false;
    if (event.source === "automation" && !rule.trigger.allow_self_trigger) return false;
    if (causationDepth(event) >= rule.trigger.maximum_causation_depth) return false;
    return rule.trigger.conditions.every((condition) => conditionMatches(event, condition));
  }

  private async execute(runId: string, rule: AutomationRule, event: SemanticEvent): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) return;
    run.actions = asStoredActions(run.actions);

    for (const action of rule.actions) {
      const actionRun = run.actions.find((entry) => entry.action_id === action.id) as
        | StoredActionRun
        | undefined;
      if (!actionRun || actionRun.state !== "pending") continue;

      const dependencies = action.depends_on
        .map((id) => run.actions.find((entry) => entry.action_id === id))
        .filter((entry): entry is AutomationActionRun => Boolean(entry));
      if (
        action.dependency_mode === "after_success" &&
        dependencies.some((entry) => entry.state !== "succeeded")
      ) {
        if (dependencies.some((entry) => isTerminal(entry.state))) {
          actionRun.state = "skipped";
          actionRun.error = "A required predecessor did not succeed";
          actionRun.updated_at = this.now().toISOString();
        }
        continue;
      }
      if (
        action.dependency_mode === "after_completion" &&
        dependencies.some((entry) => !isTerminal(entry.state))
      ) {
        continue;
      }

      if (action.requires_approval && !actionRun.approved_at) {
        actionRun.state = "awaiting_approval";
        actionRun.updated_at = this.now().toISOString();
        continue;
      }

      if (
        event.board_id &&
        event.effect_generation !== undefined &&
        this.options.getEffectGeneration
      ) {
        const currentGeneration = await this.options.getEffectGeneration(event.board_id);
        if (currentGeneration !== undefined && currentGeneration !== event.effect_generation) {
          actionRun.state = "blocked";
          actionRun.error = "Board effect generation has changed";
          actionRun.updated_at = this.now().toISOString();
          continue;
        }
      }

      const executor = this.executors[action.type];
      if (!executor) {
        actionRun.state = "failed";
        actionRun.error = `No executor is registered for '${action.type}'`;
        actionRun.updated_at = this.now().toISOString();
        continue;
      }
      if (actionRun.attempts >= action.max_attempts) {
        actionRun.state = "failed";
        actionRun.error = "Maximum delivery attempts exceeded";
        actionRun.updated_at = this.now().toISOString();
        continue;
      }

      actionRun.state = "running";
      actionRun.attempts += 1;
      actionRun.updated_at = this.now().toISOString();
      try {
        const result = await executor({
          rule: clone(rule),
          run: publicRun(run),
          action: clone(action),
          event: clone(event),
          idempotencyKey: `${run.id}:${action.id}:${actionRun.attempts}`,
          causationDepth: causationDepth(event) + 1,
        });
        actionRun.state = "succeeded";
        actionRun.result = result ?? {};
        actionRun.error = null;
      } catch (error) {
        actionRun.state = "failed";
        actionRun.error = error instanceof Error ? error.message : String(error);
      }
      actionRun.updated_at = this.now().toISOString();
    }

    run.state = runState(run.actions);
    run.updated_at = this.now().toISOString();
    this.runs.set(run.id, run);
  }

  private enqueuePersist(work: () => Promise<void>): void {
    if (!this.db || !isPersistableDb(this.db)) return;
    this.persistChain = this.persistChain.then(work).catch((err) => {
      console.error("automation persist failed", err);
    });
  }

  private async saveRule(rule: AutomationRule): Promise<void> {
    const db = this.db;
    if (!db) return;
    const row = {
      id: rule.id,
      workspaceId: rule.workspace_id,
      boardId: rule.board_id ?? null,
      version: rule.version,
      enabled: rule.enabled,
      definition: rule as unknown as JsonRecord,
      createdAt: new Date(rule.created_at ?? Date.now()),
      updatedAt: new Date(rule.updated_at ?? Date.now()),
    };
    await db
      .insert(automationRules)
      .values(row)
      .onConflictDoUpdate({
        target: automationRules.id,
        set: {
          boardId: row.boardId,
          version: row.version,
          enabled: row.enabled,
          definition: row.definition,
          updatedAt: row.updatedAt,
        },
      });
  }

  private async saveRun(
    run: AutomationRun,
    event: SemanticEvent,
    dedupeKey: string,
  ): Promise<void> {
    const db = this.db;
    if (!db) return;
    const context: RunContext = {
      event,
      rule_version: run.rule_version,
      board_id: run.board_id ?? null,
      idempotency_key: run.idempotency_key,
      dedupe_key: dedupeKey,
    };
    const row = {
      id: run.id,
      ruleId: run.rule_id,
      eventId: run.event_id,
      state: run.state,
      dedupeKey,
      effectGeneration: run.effect_generation ?? 0,
      context: context as unknown as JsonRecord,
      createdAt: new Date(run.created_at),
      updatedAt: new Date(run.updated_at),
    };
    await db
      .insert(automationRuns)
      .values(row)
      .onConflictDoUpdate({
        target: automationRuns.id,
        set: {
          state: row.state,
          effectGeneration: row.effectGeneration,
          context: row.context,
          updatedAt: row.updatedAt,
        },
      });
    for (const action of asStoredActions(run.actions)) {
      const detail: JsonRecord = {
        attempts: action.attempts,
        error: action.error ?? null,
        result: action.result ?? null,
        updated_at: action.updated_at,
      };
      await db
        .insert(automationActionRuns)
        .values({
          id: action.row_id,
          runId: run.id,
          actionId: action.action_id,
          state: action.state,
          detail,
          approvedBy: action.approved_by,
          approvedAt: action.approved_at ? new Date(action.approved_at) : null,
        })
        .onConflictDoUpdate({
          target: automationActionRuns.id,
          set: {
            state: action.state,
            detail,
            approvedBy: action.approved_by,
            approvedAt: action.approved_at ? new Date(action.approved_at) : null,
          },
        });
    }
  }

  private async findRunByDedupe(dedupeKey: string): Promise<AutomationRun | null> {
    const db = this.db;
    if (!db) return null;
    try {
      const [row] = await db
        .select()
        .from(automationRuns)
        .where(eq(automationRuns.dedupeKey, dedupeKey))
        .limit(1);
      if (!row) return null;
      const actions = await db
        .select()
        .from(automationActionRuns)
        .where(eq(automationActionRuns.runId, row.id));
      const context = row.context as RunContext;
      this.hydrateStoredRun(row, actions, context, false);
      return this.runs.get(row.id) ?? null;
    } catch {
      return null;
    }
  }

  hydrateStoredRun(
    row: typeof automationRuns.$inferSelect,
    actionRows: (typeof automationActionRuns.$inferSelect)[],
    context: RunContext,
    resetNonTerminal: boolean,
  ): void {
    const actions: StoredActionRun[] = actionRows.map((action) => {
      const detail = isRecord(action.detail) ? action.detail : {};
      let state = action.state as AutomationActionState;
      let attempts = typeof detail.attempts === "number" ? detail.attempts : 0;
      if (resetNonTerminal && !isTerminal(state) && state !== "awaiting_approval") {
        state = "pending";
        attempts = 0;
      }
      return {
        row_id: action.id,
        action_id: action.actionId,
        state,
        attempts,
        error: typeof detail.error === "string" ? detail.error : null,
        result: isRecord(detail.result) ? detail.result : null,
        updated_at:
          typeof detail.updated_at === "string" ? detail.updated_at : row.updatedAt.toISOString(),
        approved_by: action.approvedBy,
        approved_at: action.approvedAt?.toISOString() ?? null,
      };
    });
    const run: AutomationRun = {
      id: row.id,
      rule_id: row.ruleId,
      rule_version: context.rule_version ?? 1,
      event_id: row.eventId,
      board_id: context.board_id ?? null,
      effect_generation: row.effectGeneration,
      idempotency_key: context.idempotency_key ?? row.dedupeKey,
      state: resetNonTerminal ? "pending" : (row.state as AutomationRun["state"]),
      actions,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
    this.runs.set(run.id, run);
    this.runsByDedupe.set(row.dedupeKey, run.id);
    this.dedupeByRun.set(run.id, row.dedupeKey);
    if (context.event) this.eventsByRun.set(run.id, clone(context.event));
  }
}

export async function loadAutomationEngineFromDb(
  db: Store,
  options: AutomationEngineOptions = {},
): Promise<AutomationEngine> {
  const engine = new AutomationEngine({ ...options, db });
  try {
    const rows = await db.select().from(automationRules);
    for (const row of rows) {
      const parsed = automationRuleSchema.safeParse({
        ...(isRecord(row.definition) ? row.definition : {}),
        id: row.id,
        workspace_id: row.workspaceId,
        board_id: row.boardId,
        version: row.version,
        enabled: row.enabled,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
      });
      if (parsed.success) engine.hydrateRule(parsed.data);
    }
    const runRows = await db.select().from(automationRuns);
    for (const row of runRows) {
      const actions = await db
        .select()
        .from(automationActionRuns)
        .where(eq(automationActionRuns.runId, row.id));
      engine.hydrateStoredRun(row, actions, row.context as RunContext, false);
    }
  } catch {
    // mock databases may not expose ops tables
  }
  return engine;
}

export async function recoverAutomationRuns(db: Store, engine?: AutomationEngine): Promise<void> {
  const worker = engine ?? (await loadAutomationEngineFromDb(db));
  try {
    await worker.recoverPendingRuns();
  } catch {
    // ignore mock/missing tables
  }
}

export interface SignedWebhookExecutorOptions {
  fetch?: typeof fetch;
  /** Exact hosts or `.example.com` suffixes permitted for webhook delivery. */
  allowedHosts: readonly string[];
  resolveSecret?: (reference: string) => Promise<string | undefined>;
  allowHttp?: boolean;
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(host)) return true;
  if (/^10(?:\.\d{1,3}){3}$/.test(host)) return true;
  if (/^192\.168(?:\.\d{1,3}){2}$/.test(host)) return true;
  const match = host.match(/^172\.(\d{1,3})(?:\.\d{1,3}){2}$/);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function hostAllowed(hostname: string, allowedHosts: readonly string[]): boolean {
  return allowedHosts.some((allowed) => {
    const normalized = allowed.toLowerCase();
    return normalized.startsWith(".")
      ? hostname.toLowerCase().endsWith(normalized)
      : hostname.toLowerCase() === normalized;
  });
}

/**
 * Default generic webhook action. It uses an allow-list, rejects obvious
 * private destinations, signs the exact JSON body, and never follows redirects.
 */
export function createSignedWebhookExecutor(
  options: SignedWebhookExecutorOptions,
): AutomationActionExecutor {
  const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
  return async ({ action, event, idempotencyKey, rule }) => {
    const config = action.config;
    const urlValue = config.url;
    if (typeof urlValue !== "string") throw new Error("Webhook action requires a URL");
    const url = new URL(urlValue);
    if (url.protocol !== "https:" && !(options.allowHttp && url.protocol === "http:")) {
      throw new Error("Webhook URLs must use HTTPS");
    }
    if (isPrivateOrLocalHost(url.hostname) || !hostAllowed(url.hostname, options.allowedHosts)) {
      throw new Error("Webhook destination is not allowed");
    }

    const payload = {
      event: {
        id: event.id,
        type: event.type,
        board_id: event.board_id ?? null,
        revision_id: event.revision_id ?? null,
        payload: event.payload,
        created_at: event.created_at,
      },
      rule: { id: rule.id, version: rule.version },
    };
    const body = JSON.stringify(payload);
    const secretReference = config.secret_reference;
    const secret =
      typeof secretReference === "string"
        ? await options.resolveSecret?.(secretReference)
        : undefined;
    if (!secret) throw new Error("Webhook signing secret is unavailable");
    const signature = createHmac("sha256", secret).update(body).digest("hex");

    const response = await fetchFn(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(action.timeout_ms),
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "VisBoard-Automation/3",
        "Idempotency-Key": idempotencyKey,
        "X-VisBoard-Signature-256": `sha256=${signature}`,
      },
      body,
    });
    if (!response.ok) {
      throw new Error(`Webhook responded with HTTP ${response.status}`);
    }
    return { status: response.status, destination: url.origin };
  };
}
