import { boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { notes } from "./notes";
import { projects } from "./projects";

export const checklists = pgTable("checklists", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  title: text("title").notNull(),
  sourceNoteId: text("source_note_id").references(() => notes.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const checklistItems = pgTable("checklist_items", {
  id: text("id").primaryKey(),
  checklistId: text("checklist_id")
    .notNull()
    .references(() => checklists.id),
  text: text("text").notNull(),
  done: boolean("done").notNull().default(false),
  sortOrder: integer("sort_order").notNull(),
  assigneeType: text("assignee_type"),
  assigneeId: text("assignee_id"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  blockedBy: text("blocked_by").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
