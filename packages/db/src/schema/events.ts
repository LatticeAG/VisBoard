import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { projects } from "./projects.js";

export const events = pgTable(
  "events",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    type: text("type").notNull(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("events_project_id_idx").on(table.projectId),
    index("events_project_id_created_at_idx").on(table.projectId, table.createdAt),
  ],
);
