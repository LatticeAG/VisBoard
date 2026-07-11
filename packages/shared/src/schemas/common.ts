import { z } from "zod";

export const slugSchema = z
  .string()
  .min(3)
  .max(48)
  .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens");

export const timestampSchema = z.string().datetime({ offset: true });

export const principalTypeSchema = z.enum(["user", "agent"]);

export const actorTypeSchema = z.enum(["user", "agent", "system"]);

export const workspaceRoleSchema = z.enum(["owner", "admin", "member", "guest"]);

export const projectMemberRoleSchema = z.enum(["editor", "viewer"]);

export const paginationSchema = z.object({
  next_cursor: z.string().nullable(),
  has_more: z.boolean(),
});

export const paginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    pagination: paginationSchema,
  });

export const frontmatterSchema = z.record(z.unknown()).default({});

export type Slug = z.infer<typeof slugSchema>;
export type PrincipalType = z.infer<typeof principalTypeSchema>;
export type ActorType = z.infer<typeof actorTypeSchema>;
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;
export type ProjectMemberRole = z.infer<typeof projectMemberRoleSchema>;
export type Frontmatter = z.infer<typeof frontmatterSchema>;
