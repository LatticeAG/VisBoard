import { z } from "zod";
import { ID_PATTERNS } from "../ids.js";
import { timestampSchema } from "./common.js";
import { projectIdSchema } from "./project.js";
import { workspaceIdSchema } from "./workspace.js";

export const agentIdSchema = z.string().regex(ID_PATTERNS.agent);
export const userIdSchema = z.string().regex(ID_PATTERNS.user);

export const agentStatusSchema = z.enum(["active", "revoked"]);

export const userSchema = z.object({
  id: userIdSchema,
  email: z.string().email().nullable().optional(),
  display_name: z.string().min(1).max(256),
  created_at: timestampSchema,
});

export const agentSchema = z.object({
  id: agentIdSchema,
  workspace_id: workspaceIdSchema,
  name: z.string().min(1).max(256),
  description: z.string().default(""),
  capabilities: z.array(z.string()).default([]),
  scopes: z.array(z.string()).min(1),
  project_ids: z.array(projectIdSchema).default([]),
  token_prefix: z.string(),
  status: agentStatusSchema.default("active"),
  last_seen_at: timestampSchema.nullable().optional(),
  created_by_id: userIdSchema,
  created_at: timestampSchema,
  revoked_at: timestampSchema.nullable().optional(),
});

export const createAgentSchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().optional(),
  scopes: z.array(z.string()).min(1),
  project_ids: z.array(projectIdSchema).optional(),
});

export const updateAgentSchema = z.object({
  name: z.string().min(1).max(256).optional(),
  description: z.string().optional(),
  scopes: z.array(z.string()).min(1).optional(),
  project_ids: z.array(projectIdSchema).optional(),
});

export type User = z.infer<typeof userSchema>;
export type Agent = z.infer<typeof agentSchema>;
export type AgentStatus = z.infer<typeof agentStatusSchema>;
export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;
