import { z } from "zod";
import { ID_PATTERNS } from "../ids.js";
import { slugSchema, timestampSchema } from "./common.js";

export const workspaceIdSchema = z.string().regex(ID_PATTERNS.workspace);

export const workspaceSchema = z.object({
  id: workspaceIdSchema,
  slug: slugSchema,
  name: z.string().min(1).max(256),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  deleted_at: timestampSchema.nullable().optional(),
});

export const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(256),
  slug: slugSchema.optional(),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(256).optional(),
});

export type Workspace = z.infer<typeof workspaceSchema>;
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;
