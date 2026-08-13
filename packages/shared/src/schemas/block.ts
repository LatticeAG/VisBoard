import { z } from "zod";
import { ID_PATTERNS } from "../ids.js";
import {
  boardDocumentIdSchema,
  boardIdSchema,
  boardRevisionIdSchema,
} from "./board.js";
import { timestampSchema } from "./common.js";

export const boardBlockIdSchema = z.string().regex(ID_PATTERNS.boardBlock);

export const blockTypeSchema = z.enum([
  "core.document",
  "core.callout",
  "core.decision",
  "core.evidence",
  "core.checklist",
  "core.task",
  "core.kanban",
  "core.kanban_column",
  "core.kanban_card",
  "core.gantt",
  "core.gantt_task",
  "core.mermaid",
  "core.code",
  "core.file",
  "core.media",
  "core.embed",
  "core.dashboard",
  "core.agent_workspace",
  "core.agent_thread",
  "core.handoff",
  "core.activity",
  "core.timeline",
]);

export const blockVisibilitySchema = z.enum([
  "board",
  "restricted",
  "private",
]);
export const blockLifecycleStateSchema = z.enum(["active", "archived"]);

export const blockAttributesSchema = z.record(z.unknown()).default({});
export const blockContentSchema = z.record(z.unknown()).default({});

export const boardBlockSchema = z.object({
  id: boardBlockIdSchema,
  board_id: boardIdSchema,
  document_id: boardDocumentIdSchema,
  type: blockTypeSchema,
  schema_version: z.number().int().positive(),
  parent_block_id: boardBlockIdSchema.nullable(),
  slot: z.string().max(128).nullable(),
  rank: z.string().min(1).max(256),
  visibility: blockVisibilitySchema,
  attributes: blockAttributesSchema,
  content: blockContentSchema,
  lifecycle_state: blockLifecycleStateSchema,
  template_origin_key: z.string().max(128).nullable(),
  created_by_type: z.enum(["user", "agent", "system"]),
  created_by_id: z.string().min(1),
  updated_by_type: z.enum(["user", "agent", "system"]),
  updated_by_id: z.string().min(1),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  deleted_at: timestampSchema.nullable().optional(),
});

export const createBoardBlockSchema = z.object({
  type: blockTypeSchema,
  schema_version: z.number().int().positive().default(1),
  parent_block_id: boardBlockIdSchema.nullable().optional(),
  slot: z.string().max(128).nullable().optional(),
  rank: z.string().min(1).max(256).optional(),
  visibility: blockVisibilitySchema.optional(),
  attributes: blockAttributesSchema.optional(),
  content: blockContentSchema.optional(),
  template_origin_key: z.string().max(128).nullable().optional(),
});

export const updateBoardBlockSchema = z.object({
  attributes: blockAttributesSchema.optional(),
  content: blockContentSchema.optional(),
  visibility: blockVisibilitySchema.optional(),
  rank: z.string().min(1).max(256).optional(),
  parent_block_id: boardBlockIdSchema.nullable().optional(),
  slot: z.string().max(128).nullable().optional(),
});

export const boardCommandKindSchema = z.enum([
  "block.create",
  "block.update",
  "block.archive",
  "block.move",
  "kanban.card.move",
]);

export const boardCommandSchema = z.object({
  command_id: z.string().min(1).max(128),
  kind: boardCommandKindSchema,
  target: z
    .object({
      block_id: boardBlockIdSchema.optional(),
    })
    .default({}),
  payload: z.record(z.unknown()).default({}),
  expected: z
    .object({
      revision_id: boardRevisionIdSchema.optional(),
      document_id: boardDocumentIdSchema.optional(),
    })
    .default({}),
  reason: z.string().max(2_000).optional(),
  causation_id: z.string().max(128).optional(),
});

export type BlockType = z.infer<typeof blockTypeSchema>;
export type BoardBlock = z.infer<typeof boardBlockSchema>;
export type CreateBoardBlockInput = z.infer<typeof createBoardBlockSchema>;
export type UpdateBoardBlockInput = z.infer<typeof updateBoardBlockSchema>;
export type BoardCommand = z.infer<typeof boardCommandSchema>;

export type BlockDefinition = {
  schema_version: number;
  renderer: string;
  collaborative_fields: readonly string[];
  protected_fields: readonly string[];
  required_capabilities: readonly string[];
  markdown_support: "full" | "lossy" | "metadata";
};

const defaultDefinition = {
  schema_version: 1,
  renderer: "generic",
  collaborative_fields: ["content"] as const,
  protected_fields: ["visibility", "lifecycle_state"] as const,
  required_capabilities: ["content.write"] as const,
  markdown_support: "full" as const,
};

/**
 * The registry is intentionally shared by API, SDK, MCP, and renderers. It
 * tells clients which fields may be collaboratively authored without giving
 * them authority to mutate protected topology or workflow state.
 */
export const BLOCK_TYPE_REGISTRY: Record<BlockType, BlockDefinition> = {
  "core.document": { ...defaultDefinition, renderer: "document" },
  "core.callout": { ...defaultDefinition, renderer: "callout" },
  "core.decision": {
    ...defaultDefinition,
    renderer: "decision",
    protected_fields: ["attributes.status", "attributes.owner"],
  },
  "core.evidence": { ...defaultDefinition, renderer: "evidence" },
  "core.checklist": { ...defaultDefinition, renderer: "checklist" },
  "core.task": {
    ...defaultDefinition,
    renderer: "task",
    protected_fields: ["attributes.assignee", "attributes.completed", "attributes.due_at"],
  },
  "core.kanban": {
    ...defaultDefinition,
    renderer: "kanban",
    protected_fields: ["attributes.lane_policy", "attributes.wip_limit"],
  },
  "core.kanban_column": {
    ...defaultDefinition,
    renderer: "kanban-column",
    collaborative_fields: [],
    protected_fields: ["attributes.state_key", "attributes.transition_policy", "attributes.wip_limit"],
    required_capabilities: ["workflow.transition"],
  },
  "core.kanban_card": {
    ...defaultDefinition,
    renderer: "kanban-card",
    protected_fields: ["attributes.lane_id", "attributes.assignee", "attributes.status"],
  },
  "core.gantt": { ...defaultDefinition, renderer: "gantt" },
  "core.gantt_task": {
    ...defaultDefinition,
    renderer: "gantt-task",
    protected_fields: ["attributes.start_at", "attributes.end_at", "attributes.dependencies"],
  },
  "core.mermaid": { ...defaultDefinition, renderer: "mermaid" },
  "core.code": { ...defaultDefinition, renderer: "code" },
  "core.file": {
    ...defaultDefinition,
    renderer: "file",
    collaborative_fields: ["content.caption", "content.alt_text"],
    protected_fields: ["attributes.artifact_id"],
    markdown_support: "metadata",
  },
  "core.media": { ...defaultDefinition, renderer: "media", markdown_support: "metadata" },
  "core.embed": {
    ...defaultDefinition,
    renderer: "embed",
    protected_fields: ["attributes.url", "attributes.provider"],
    markdown_support: "metadata",
  },
  "core.dashboard": {
    ...defaultDefinition,
    renderer: "dashboard",
    protected_fields: ["attributes.datasource", "attributes.query", "attributes.parameters"],
    markdown_support: "metadata",
  },
  "core.agent_workspace": {
    ...defaultDefinition,
    renderer: "agent-workspace",
    collaborative_fields: [],
    protected_fields: ["attributes.agent_workspace_id"],
    markdown_support: "metadata",
  },
  "core.agent_thread": { ...defaultDefinition, renderer: "agent-thread" },
  "core.handoff": {
    ...defaultDefinition,
    renderer: "handoff",
    collaborative_fields: [],
    protected_fields: ["attributes.handoff_id", "attributes.state"],
  },
  "core.activity": {
    ...defaultDefinition,
    renderer: "activity",
    collaborative_fields: [],
    protected_fields: ["attributes.filter"],
    markdown_support: "metadata",
  },
  "core.timeline": {
    ...defaultDefinition,
    renderer: "timeline",
    collaborative_fields: [],
    protected_fields: ["attributes.filter"],
    markdown_support: "metadata",
  },
};

export function getBlockDefinition(type: BlockType): BlockDefinition {
  return BLOCK_TYPE_REGISTRY[type];
}
