import { z } from "zod";
import { ID_PATTERNS } from "../ids.js";
import { slugSchema, timestampSchema } from "./common.js";
import { workspaceIdSchema } from "./workspace.js";

export const projectStatusSchema = z.enum(["draft", "active", "archived"]);

export const projectIdSchema = z.string().regex(ID_PATTERNS.project);

export const projectSchema = z.object({
  id: projectIdSchema,
  workspace_id: workspaceIdSchema,
  slug: slugSchema,
  name: z.string().min(1).max(256),
  description: z.string().default(""),
  status: projectStatusSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
  deleted_at: timestampSchema.nullable().optional(),
});

export const createProjectSchema = z.object({
  name: z.string().min(1).max(256),
  slug: slugSchema.optional(),
  description: z.string().optional(),
  status: projectStatusSchema.optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(256).optional(),
  description: z.string().optional(),
  status: projectStatusSchema.optional(),
});

export type ProjectStatus = z.infer<typeof projectStatusSchema>;
export type Project = z.infer<typeof projectSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
