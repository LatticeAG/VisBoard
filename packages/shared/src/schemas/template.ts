import { z } from "zod";
import { ID_PATTERNS } from "../ids.js";
import {
  blockAttributesSchema,
  blockContentSchema,
  blockTypeSchema,
  boardBlockIdSchema,
} from "./block.js";
import { boardIdSchema } from "./board.js";
import { timestampSchema } from "./common.js";
import { workspaceIdSchema } from "./workspace.js";

export const templateIdSchema = z.string().regex(ID_PATTERNS.template);
export const templateVersionIdSchema = z.string().regex(ID_PATTERNS.templateVersion);
export const templateInstallationIdSchema = z.string().regex(ID_PATTERNS.templateInstallation);
export const templateBlockMappingIdSchema = z.string().regex(ID_PATTERNS.templateBlockMapping);

export const templateScopeSchema = z.enum(["system", "organization", "team", "private"]);
export const templatePublicationStateSchema = z.enum(["draft", "published", "retired"]);

export const templateParameterSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  label: z.string().min(1).max(256),
  type: z.enum(["string", "number", "boolean", "select"]),
  required: z.boolean().default(false),
  default: z.unknown().optional(),
  options: z.array(z.string().min(1).max(256)).optional(),
});

export const templateNodeSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_-]{0,127}$/),
  type: blockTypeSchema,
  schema_version: z.number().int().positive().default(1),
  parent_key: z
    .string()
    .regex(/^[a-z][a-z0-9_-]{0,127}$/)
    .nullable()
    .optional(),
  slot: z.string().max(128).nullable().optional(),
  rank: z.string().min(1).max(256).optional(),
  attributes: blockAttributesSchema.optional(),
  content: blockContentSchema.optional(),
});

export const templateManifestSchema = z.object({
  schema_version: z.literal(1).default(1),
  description: z.string().max(20_000).optional(),
  parameters: z.array(templateParameterSchema).default([]),
  blocks: z.array(templateNodeSchema).min(1),
  policies: z.record(z.unknown()).default({}),
  agent_setup: z.record(z.unknown()).default({}),
  automation: z.array(z.record(z.unknown())).default([]),
  sync_hints: z.record(z.unknown()).default({}),
});

export const boardTemplateSchema = z.object({
  id: templateIdSchema,
  workspace_id: workspaceIdSchema.nullable(),
  slug: z.string().regex(/^[a-z0-9-]{3,80}$/),
  name: z.string().min(1).max(256),
  description: z.string().max(20_000).default(""),
  scope: templateScopeSchema,
  created_by_id: z.string().min(1),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const templateVersionSchema = z.object({
  id: templateVersionIdSchema,
  template_id: templateIdSchema,
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  state: templatePublicationStateSchema,
  manifest: templateManifestSchema,
  checksum: z.string().min(16).max(128),
  created_by_id: z.string().min(1),
  created_at: timestampSchema,
});

export const templateInstallationSchema = z.object({
  id: templateInstallationIdSchema,
  board_id: boardIdSchema,
  template_version_id: templateVersionIdSchema,
  variables: z.record(z.unknown()).default({}),
  state: z.enum(["installed", "drifted", "superseded"]),
  installed_by_id: z.string().min(1),
  installed_at: timestampSchema,
});

export const templateBlockMappingSchema = z.object({
  id: templateBlockMappingIdSchema,
  installation_id: templateInstallationIdSchema,
  template_node_key: z.string().min(1).max(128),
  block_id: boardBlockIdSchema,
  created_at: timestampSchema,
});

export const createTemplateSchema = z.object({
  workspace_id: workspaceIdSchema.optional(),
  name: z.string().min(1).max(256),
  slug: z
    .string()
    .regex(/^[a-z0-9-]{3,80}$/)
    .optional(),
  description: z.string().max(20_000).optional(),
  scope: templateScopeSchema.optional(),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .default("1.0.0"),
  manifest: templateManifestSchema,
  published: z.boolean().default(false),
});

export const createTemplateVersionSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  manifest: templateManifestSchema,
  published: z.boolean().default(false),
});

export const installTemplateSchema = z.object({
  template_version_id: templateVersionIdSchema,
  variables: z.record(z.unknown()).default({}),
});

export type TemplateManifest = z.infer<typeof templateManifestSchema>;
export type BoardTemplate = z.infer<typeof boardTemplateSchema>;
export type TemplateVersion = z.infer<typeof templateVersionSchema>;
export type TemplateInstallation = z.infer<typeof templateInstallationSchema>;
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type CreateTemplateVersionInput = z.infer<typeof createTemplateVersionSchema>;
export type InstallTemplateInput = z.infer<typeof installTemplateSchema>;

function builtInManifest(
  description: string,
  blocks: z.input<typeof templateNodeSchema>[],
): TemplateManifest {
  return {
    schema_version: 1,
    description,
    parameters: [],
    blocks: blocks.map((block) => templateNodeSchema.parse(block)),
    policies: {},
    agent_setup: {},
    automation: [],
    sync_hints: {},
  };
}

/** Built-in blueprints are data, not remote controllers of installed boards. */
export const BUILT_IN_TEMPLATES = [
  {
    slug: "sprint-planning",
    name: "Sprint planning",
    description: "Outcome, planning Kanban, milestones, decisions, and agent work.",
    manifest: builtInManifest("A focused sprint planning workflow.", [
      { key: "outcome", type: "core.document", content: { body: "# Sprint outcome\n" } },
      { key: "board", type: "core.kanban", attributes: { title: "Sprint board" } },
      {
        key: "backlog",
        type: "core.kanban_column",
        parent_key: "board",
        attributes: { state_key: "backlog", title: "Backlog" },
      },
      {
        key: "ready",
        type: "core.kanban_column",
        parent_key: "board",
        attributes: { state_key: "ready", title: "Ready" },
      },
      {
        key: "in-progress",
        type: "core.kanban_column",
        parent_key: "board",
        attributes: { state_key: "in_progress", title: "In progress" },
      },
      {
        key: "review",
        type: "core.kanban_column",
        parent_key: "board",
        attributes: { state_key: "review", title: "Review" },
      },
      {
        key: "done",
        type: "core.kanban_column",
        parent_key: "board",
        attributes: { state_key: "done", title: "Done" },
      },
      { key: "milestones", type: "core.gantt", attributes: { title: "Milestones" } },
      { key: "decisions", type: "core.decision", content: { body: "# Decisions\n" } },
      { key: "agent-work", type: "core.agent_workspace", attributes: {} },
    ]),
  },
  {
    slug: "incident-response",
    name: "Incident response",
    description: "Facts, timeline, mitigation board, evidence, and postmortem checkpoint.",
    manifest: builtInManifest("An incident response working protocol.", [
      { key: "facts", type: "core.document", content: { body: "# Incident facts\n" } },
      { key: "timeline", type: "core.timeline", attributes: {} },
      { key: "mitigation", type: "core.kanban", attributes: { title: "Mitigation" } },
      { key: "evidence", type: "core.evidence", content: { body: "# Evidence\n" } },
      { key: "dashboard", type: "core.dashboard", attributes: {} },
      { key: "postmortem", type: "core.handoff", attributes: {} },
    ]),
  },
  {
    slug: "pr-review",
    name: "PR review",
    description: "Review evidence, code anchor, risk matrix, and approval handoff.",
    manifest: builtInManifest("A reviewable pull request workflow.", [
      { key: "summary", type: "core.document", content: { body: "# Pull request review\n" } },
      {
        key: "code",
        type: "core.code",
        attributes: { language: "typescript" },
        content: { source: "" },
      },
      { key: "checks", type: "core.checklist", attributes: { title: "Review checklist" } },
      { key: "risks", type: "core.decision", content: { body: "# Risks\n" } },
      { key: "handoff", type: "core.handoff", attributes: {} },
    ]),
  },
  {
    slug: "research",
    name: "Research",
    description: "Question, evidence ledger, diagram, synthesis, and decision packet.",
    manifest: builtInManifest("A provenance-aware research workflow.", [
      { key: "question", type: "core.document", content: { body: "# Research question\n" } },
      { key: "evidence", type: "core.evidence", content: { body: "# Evidence ledger\n" } },
      {
        key: "hypotheses",
        type: "core.mermaid",
        content: { source: "graph TD\n  Question --> Evidence" },
      },
      { key: "synthesis", type: "core.document", content: { body: "# Synthesis\n" } },
      { key: "decision", type: "core.decision", content: { body: "# Decision\n" } },
    ]),
  },
] as const;
