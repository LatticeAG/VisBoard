import { isNull } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projects } from "./projects.js";

export const notes = pgTable(
  "notes",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    frontmatter: jsonb("frontmatter").notNull().default({}),
    isSystem: boolean("is_system").notNull().default(false),
    systemKey: text("system_key"),
    version: integer("version").notNull().default(1),
    createdByType: text("created_by_type").notNull(),
    createdById: text("created_by_id").notNull(),
    updatedByType: text("updated_by_type").notNull(),
    updatedById: text("updated_by_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("notes_project_id_idx").on(table.projectId),
    uniqueIndex("notes_project_id_slug_active_unique")
      .on(table.projectId, table.slug)
      .where(isNull(table.deletedAt)),
  ],
);

export const noteVersions = pgTable(
  "note_versions",
  {
    id: text("id").primaryKey(),
    noteId: text("note_id")
      .notNull()
      .references(() => notes.id),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    frontmatter: jsonb("frontmatter").notNull(),
    createdByType: text("created_by_type").notNull(),
    createdById: text("created_by_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("note_versions_note_id_version_unique").on(table.noteId, table.version)],
);
