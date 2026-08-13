import { createHmac } from "node:crypto";
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
import {
  automationRuleSchema,
  semanticEventSchema,
} from "@visboard/shared";

type JsonRecord = Record<string, unknown>;

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
        throw new Error(`Automation action '${action.id}' depends on unknown action '${dependency}'`);
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
) => Promise<Record<string, unknown> | void>;

export interface AutomationEngineOptions {
  executors?: Partial<Record<AutomationActionType, AutomationActionExecutor>>;
  /** Reads the current board fence before each external effect. */
  getEffectGeneration?: (boardId: string) => Promise<number | undefined>;
  now?: () => Date;
}

/**
 * Runs declarative automation rules against committed semantic events. The
 * engine is intentionally storage-agnostic; a worker can hydrate/persist its
 * maps around each call without coupling automation to board table names.
 */
export class AutomationEngine {
  private readonly rules = new Map<string, AutomationRule>();
  private readonly runs = new Map<string, AutomationRun>();
  private readonly runsByDedupe = new Map<string, string>();
  private readonly cooldowns = new Map<string, number>();
  private readonly approvedActions = new Set<string>();
  private readonly eventsByRun = new Map<string, SemanticEvent>();
  private readonly executors: Partial<Record<AutomationActionType, AutomationActionExecutor>>;
  private readonly now: () => Date;

  constructor(private readonly options: AutomationEngineOptions = {}) {
    this.executors = { ...options.executors };
    this.now = options.now ?? (() => new Date());
  }

  registerExecutor(type: AutomationActionType, executor: AutomationActionExecutor): void {
    this.executors[type] = executor;
  }

  createRule(input: CreateAutomationRule): AutomationRule {
    const now = this.now().toISOString();
    const rule = automationRuleSchema.parse({
      ...input,
      id: input.id ?? createId("auto"),
      version: 1,
      created_at: now,
      updated_at: now,
    });
    validateActionGraph(rule.actions);
    this.rules.set(rule.id, rule);
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
    return run ? clone(run) : null;
  }

  listRuns(ruleId?: string): AutomationRun[] {
    return [...this.runs.values()]
      .filter((run) => !ruleId || run.rule_id === ruleId)
      .map(clone);
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

      const idempotencyKey = renderIdempotencyTemplate(
        rule.idempotency_key_template,
        event,
        rule,
      );
      const dedupeKey = `${rule.id}:${rule.version}:${idempotencyKey}`;
      const existingId = this.runsByDedupe.get(dedupeKey);
      if (existingId) {
        const existing = this.runs.get(existingId);
        if (existing) created.push(clone(existing));
        continue;
      }

      const timestamp = this.now().toISOString();
      const run: AutomationRun = {
        id: createId("arun"),
        rule_id: rule.id,
        rule_version: rule.version,
        event_id: event.id,
        board_id: event.board_id ?? null,
        effect_generation: event.effect_generation,
        idempotency_key: idempotencyKey,
        state: "pending",
        actions: rule.actions.map((action) => ({
          action_id: action.id,
          state: "pending",
          attempts: 0,
          error: null,
          result: null,
          updated_at: timestamp,
        })),
        created_at: timestamp,
        updated_at: timestamp,
      };
      this.runs.set(run.id, run);
      this.eventsByRun.set(run.id, clone(event));
      this.runsByDedupe.set(dedupeKey, run.id);
      this.cooldowns.set(cooldownKey, nowMs);
      await this.execute(run.id, rule, event);
      const completed = this.runs.get(run.id);
      if (completed) created.push(clone(completed));
    }

    return created;
  }

  async approveAction(
    runId: string,
    actionId: string,
    event?: SemanticEvent,
  ): Promise<AutomationRun | null> {
    const run = this.runs.get(runId);
    const rule = run ? this.rules.get(run.rule_id) : undefined;
    if (!run || !rule) return null;
    const sourceEvent = event ? semanticEventSchema.parse(event) : this.eventsByRun.get(runId);
    if (!sourceEvent) return clone(run);
    const actionRun = run.actions.find((action) => action.action_id === actionId);
    if (!actionRun || actionRun.state !== "awaiting_approval") return clone(run);
    this.approvedActions.add(`${run.id}:${actionId}`);
    actionRun.state = "pending";
    actionRun.updated_at = this.now().toISOString();
    run.state = "pending";
    run.updated_at = this.now().toISOString();
    this.runs.set(run.id, run);
    await this.execute(run.id, rule, sourceEvent);
    return clone(this.runs.get(run.id)!);
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
    if (!sourceEvent) return clone(run);
    const actionRun = run.actions.find((action) => action.action_id === actionId);
    if (!actionRun || !["failed", "blocked"].includes(actionRun.state)) return clone(run);
    actionRun.state = "pending";
    actionRun.error = null;
    actionRun.updated_at = this.now().toISOString();
    run.state = "pending";
    run.updated_at = this.now().toISOString();
    this.runs.set(run.id, run);
    await this.execute(run.id, rule, sourceEvent);
    return clone(this.runs.get(run.id)!);
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

    for (const action of rule.actions) {
      const actionRun = run.actions.find((entry) => entry.action_id === action.id);
      if (!actionRun || actionRun.state !== "pending") continue;

      const dependencies = action.depends_on
        .map((id) => run.actions.find((entry) => entry.action_id === id))
        .filter((entry): entry is AutomationActionRun => Boolean(entry));
      if (action.dependency_mode === "after_success" && dependencies.some((entry) => entry.state !== "succeeded")) {
        if (dependencies.some((entry) => isTerminal(entry.state))) {
          actionRun.state = "skipped";
          actionRun.error = "A required predecessor did not succeed";
          actionRun.updated_at = this.now().toISOString();
        }
        continue;
      }
      if (action.dependency_mode === "after_completion" && dependencies.some((entry) => !isTerminal(entry.state))) {
        continue;
      }

      if (action.requires_approval && !this.approvedActions.has(`${run.id}:${action.id}`)) {
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
          run: clone(run),
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
