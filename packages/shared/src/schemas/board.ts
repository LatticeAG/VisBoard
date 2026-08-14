import { z } from "zod";
import { ID_PATTERNS } from "../ids.js";
import { slugSchema, timestampSchema } from "./common.js";
import { workspaceIdSchema } from "./workspace.js";

export const boardIdSchema = z.string().regex(ID_PATTERNS.board);
export const boardDocumentIdSchema = z.string().regex(ID_PATTERNS.boardDocument);
export const boardRevisionIdSchema = z.string().regex(ID_PATTERNS.boardRevision);

export const boardStatusSchema = z.enum(["draft", "active", "archived"]);
export const boardDocumentStateSchema = z.enum(["active", "superseded", "read_only"]);
export const boardRevisionTriggerSchema = z.enum([
  "board_created",
  "manual",
  "command",
  "template_installed",
  "restore",
]);

export const boardSchema = z.object({
  id: boardIdSchema,
  workspace_id: workspaceIdSchema,
  legacy_project_id: z.string().nullable().optional(),
  slug: slugSchema,
  name: z.string().min(1).max(256),
  description: z.string().default(""),
  status: boardStatusSchema.default("active"),
  current_document_id: boardDocumentIdSchema.nullable(),
  head_revision_id: boardRevisionIdSchema.nullable(),
  head_sequence: z.number().int().nonnegative(),
  effect_generation: z.number().int().nonnegative(),
  template_installation_id: z.string().nullable().optional(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  deleted_at: timestampSchema.nullable().optional(),
});

export const createBoardSchema = z.object({
  name: z.string().min(1).max(256),
  slug: slugSchema.optional(),
  description: z.string().max(20_000).optional(),
  status: boardStatusSchema.optional(),
  template_version_id: z.string().optional(),
  template_variables: z.record(z.unknown()).optional(),
});

export const updateBoardSchema = z.object({
  name: z.string().min(1).max(256).optional(),
  description: z.string().max(20_000).optional(),
  status: boardStatusSchema.optional(),
  expected_revision_id: boardRevisionIdSchema.optional(),
});

export const boardDocumentSchema = z.object({
  id: boardDocumentIdSchema,
  board_id: boardIdSchema,
  epoch: z.number().int().positive(),
  state: boardDocumentStateSchema,
  schema_version: z.number().int().positive(),
  created_from_revision_id: boardRevisionIdSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

/**
 * Snapshot payloads stay JSON-only so a revision can be reconstructed without
 * consulting mutable board rows. `blocks` is deliberately structurally open:
 * individual blocks are validated by the block registry at write time.
 */
export const boardRevisionStateSchema = z.object({
  version: z.literal(1),
  document: z.record(z.unknown()),
  blocks: z.array(z.record(z.unknown())),
});

export const boardRevisionSchema = z.object({
  id: boardRevisionIdSchema,
  board_id: boardIdSchema,
  document_id: boardDocumentIdSchema,
  revision_number: z.number().int().positive(),
  parent_revision_id: boardRevisionIdSchema.nullable(),
  restored_from_revision_id: boardRevisionIdSchema.nullable(),
  trigger: boardRevisionTriggerSchema,
  label: z.string().max(256).nullable(),
  summary: z.string().max(20_000).nullable(),
  state: boardRevisionStateSchema,
  actor_type: z.enum(["user", "agent", "system"]),
  actor_id: z.string().min(1),
  created_at: timestampSchema,
});

export type Board = z.infer<typeof boardSchema>;
export type CreateBoardInput = z.infer<typeof createBoardSchema>;
export type UpdateBoardInput = z.infer<typeof updateBoardSchema>;
export type BoardDocument = z.infer<typeof boardDocumentSchema>;
export type BoardRevision = z.infer<typeof boardRevisionSchema>;
export type BoardRevisionState = z.infer<typeof boardRevisionStateSchema>;
