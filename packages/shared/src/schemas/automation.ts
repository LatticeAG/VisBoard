import { z } from "zod";

/**
 * A V3 automation observes a committed semantic event. It intentionally has
 * no representation for raw CRDT updates or executable user-supplied code.
 */
export const semanticEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  organization_id: z.string().nullable().optional(),
  workspace_id: z.string().nullable().optional(),
  board_id: z.string().nullable().optional(),
  sequence: z.number().int().nonnegative().optional(),
  revision_id: z.string().nullable().optional(),
  actor: z
    .object({
      type: z.enum(["user", "agent", "service", "system"]),
      id: z.string().min(1),
    })
    .optional(),
  source: z.enum(["human", "agent", "sync", "automation", "import", "system"]).default("system"),
  causation_id: z.string().nullable().optional(),
  correlation_id: z.string().nullable().optional(),
  /** Incremented by restore/safe mode to fence stale external effects. */
  effect_generation: z.number().int().nonnegative().optional(),
  payload: z.record(z.unknown()).default({}),
  created_at: z.string(),
});

export const automationConditionSchema = z.object({
  /** A safe, dot-separated path rooted at event or payload. */
  path: z.string().regex(/^(?:event|payload)(?:\.[A-Za-z0-9_-]+)*$/),
  operator: z.enum(["equals", "not_equals", "exists", "in", "contains"]),
  value: z.unknown().optional(),
});

export const automationTriggerSchema = z.object({
  event_types: z.array(z.string().min(1)).min(1),
  board_id: z.string().min(1).optional(),
  conditions: z.array(automationConditionSchema).default([]),
  /** Rules ignore their own work unless an operator makes this explicit. */
  allow_self_trigger: z.boolean().default(false),
  maximum_causation_depth: z.number().int().min(0).max(16).default(4),
});

export const automationActionTypeSchema = z.enum([
  "webhook",
  "notify",
  "create_block",
  "create_handoff",
  "sync",
  "export",
  "agent_run",
]);

export const automationActionSchema = z.object({
  id: z.string().min(1),
  type: automationActionTypeSchema,
  config: z.record(z.unknown()).default({}),
  depends_on: z.array(z.string().min(1)).default([]),
  dependency_mode: z
    .enum(["after_success", "after_completion", "independent"])
    .default("after_success"),
  requires_approval: z.boolean().default(false),
  timeout_ms: z.number().int().min(1_000).max(300_000).default(30_000),
  max_attempts: z.number().int().min(1).max(20).default(3),
});

export const automationRuleSchema = z.object({
  id: z.string().min(1),
  workspace_id: z.string().min(1),
  board_id: z.string().min(1).nullable().optional(),
  name: z.string().min(1).max(160),
  version: z.number().int().positive().default(1),
  enabled: z.boolean().default(false),
  trigger: automationTriggerSchema,
  idempotency_key_template: z.string().min(1).default("event.id:rule.id"),
  cooldown_ms: z.number().int().min(0).max(86_400_000).default(0),
  actions: z.array(automationActionSchema).min(1),
  created_by: z.string().nullable().optional(),
  template_origin: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export const createAutomationRuleSchema = automationRuleSchema
  .omit({ id: true, version: true, created_at: true, updated_at: true })
  .extend({ id: z.string().min(1).optional() });

export const automationActionStateSchema = z.enum([
  "pending",
  "running",
  "awaiting_approval",
  "succeeded",
  "failed",
  "blocked",
  "skipped",
]);

export const automationActionRunSchema = z.object({
  action_id: z.string().min(1),
  state: automationActionStateSchema,
  attempts: z.number().int().nonnegative().default(0),
  error: z.string().nullable().optional(),
  result: z.record(z.unknown()).nullable().optional(),
  updated_at: z.string(),
});

export const automationRunSchema = z.object({
  id: z.string().min(1),
  rule_id: z.string().min(1),
  rule_version: z.number().int().positive(),
  event_id: z.string().min(1),
  board_id: z.string().nullable().optional(),
  effect_generation: z.number().int().nonnegative().optional(),
  idempotency_key: z.string().min(1),
  state: z.enum([
    "pending",
    "running",
    "awaiting_approval",
    "succeeded",
    "failed",
    "blocked",
    "skipped",
  ]),
  actions: z.array(automationActionRunSchema),
  created_at: z.string(),
  updated_at: z.string(),
});

export type SemanticEvent = z.infer<typeof semanticEventSchema>;
export type AutomationCondition = z.infer<typeof automationConditionSchema>;
export type AutomationTrigger = z.infer<typeof automationTriggerSchema>;
export type AutomationActionType = z.infer<typeof automationActionTypeSchema>;
export type AutomationAction = z.infer<typeof automationActionSchema>;
export type AutomationRule = z.infer<typeof automationRuleSchema>;
export type CreateAutomationRule = z.infer<typeof createAutomationRuleSchema>;
export type AutomationActionState = z.infer<typeof automationActionStateSchema>;
export type AutomationActionRun = z.infer<typeof automationActionRunSchema>;
export type AutomationRun = z.infer<typeof automationRunSchema>;
