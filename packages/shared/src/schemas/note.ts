import { z } from "zod";
import { ID_PATTERNS } from "../ids.js";
import { actorTypeSchema, frontmatterSchema, slugSchema, timestampSchema } from "./common.js";
import { projectIdSchema } from "./project.js";

export const noteIdSchema = z.string().regex(ID_PATTERNS.note);
export const noteVersionIdSchema = z.string().regex(ID_PATTERNS.noteVersion);

export const noteSchema = z.object({
  id: noteIdSchema,
  project_id: projectIdSchema,
  slug: slugSchema,
  title: z.string().min(1).max(512),
  body: z.string().default(""),
  frontmatter: frontmatterSchema,
  is_system: z.boolean().default(false),
  system_key: z.string().nullable().optional(),
  version: z.number().int().positive(),
  created_by_type: actorTypeSchema,
  created_by_id: z.string(),
  updated_by_type: actorTypeSchema,
  updated_by_id: z.string(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  deleted_at: timestampSchema.nullable().optional(),
});

export const noteVersionSchema = z.object({
  id: noteVersionIdSchema,
  note_id: noteIdSchema,
  version: z.number().int().positive(),
  title: z.string(),
  body: z.string(),
  frontmatter: frontmatterSchema,
  created_by_type: actorTypeSchema,
  created_by_id: z.string(),
  created_at: timestampSchema,
});

export const createNoteSchema = z.object({
  title: z.string().min(1).max(512),
  slug: slugSchema.optional(),
  body: z.string().optional(),
  frontmatter: frontmatterSchema.optional(),
});

export const updateNoteSchema = z.object({
  title: z.string().min(1).max(512).optional(),
  body: z.string().optional(),
  frontmatter: frontmatterSchema.optional(),
});

export type Note = z.infer<typeof noteSchema>;
export type NoteVersion = z.infer<typeof noteVersionSchema>;
export type CreateNoteInput = z.infer<typeof createNoteSchema>;
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;
