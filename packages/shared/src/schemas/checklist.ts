import { z } from "zod";
import { ID_PATTERNS } from "../ids.js";
import { principalTypeSchema, timestampSchema } from "./common.js";
import { noteIdSchema } from "./note.js";
import { projectIdSchema } from "./project.js";

export const checklistIdSchema = z.string().regex(ID_PATTERNS.checklist);
export const checklistItemIdSchema = z.string().regex(ID_PATTERNS.item);

export const checklistItemSchema = z.object({
  id: checklistItemIdSchema,
  checklist_id: checklistIdSchema,
  text: z.string().min(1),
  done: z.boolean().default(false),
  sort_order: z.number().int().nonnegative(),
  assignee_type: principalTypeSchema.nullable().optional(),
  assignee_id: z.string().nullable().optional(),
  due_at: timestampSchema.nullable().optional(),
  blocked_by: z.array(checklistItemIdSchema).default([]),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const checklistSchema = z.object({
  id: checklistIdSchema,
  project_id: projectIdSchema,
  title: z.string().min(1).max(512),
  source_note_id: noteIdSchema.nullable().optional(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  deleted_at: timestampSchema.nullable().optional(),
});

export const checklistWithItemsSchema = checklistSchema.extend({
  items: z.array(checklistItemSchema).default([]),
});

export const createChecklistSchema = z.object({
  title: z.string().min(1).max(512),
  source_note_id: noteIdSchema.optional(),
});

export const updateChecklistSchema = z.object({
  title: z.string().min(1).max(512).optional(),
});

export const createChecklistItemSchema = z.object({
  text: z.string().min(1),
  sort_order: z.number().int().nonnegative().optional(),
});

export const updateChecklistItemSchema = z.object({
  text: z.string().min(1).optional(),
  done: z.boolean().optional(),
  assignee_type: principalTypeSchema.nullable().optional(),
  assignee_id: z.string().nullable().optional(),
  due_at: timestampSchema.nullable().optional(),
  blocked_by: z.array(checklistItemIdSchema).optional(),
});

export type Checklist = z.infer<typeof checklistSchema>;
export type ChecklistItem = z.infer<typeof checklistItemSchema>;
export type ChecklistWithItems = z.infer<typeof checklistWithItemsSchema>;
export type CreateChecklistInput = z.infer<typeof createChecklistSchema>;
export type UpdateChecklistInput = z.infer<typeof updateChecklistSchema>;
export type CreateChecklistItemInput = z.infer<typeof createChecklistItemSchema>;
export type UpdateChecklistItemInput = z.infer<typeof updateChecklistItemSchema>;
