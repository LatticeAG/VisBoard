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
import { boards } from "./boards.js";
import { workspaces } from "./workspaces.js";

type JsonRecord = Record<string, unknown>;

export const automationRules = pgTable(
  "automation_rules",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    boardId: text("board_id").references(() => boards.id),
    version: integer("version").notNull(),
    enabled: boolean("enabled").notNull(),
    definition: jsonb("definition").$type<JsonRecord>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("automation_rules_workspace_id_idx").on(table.workspaceId)],
);

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: text("id").primaryKey(),
    ruleId: text("rule_id")
      .notNull()
      .references(() => automationRules.id),
    eventId: text("event_id").notNull(),
    state: text("state").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    effectGeneration: integer("effect_generation").notNull().default(0),
    context: jsonb("context").$type<JsonRecord>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("automation_runs_dedupe_key_unique").on(table.dedupeKey),
    index("automation_runs_rule_id_idx").on(table.ruleId),
  ],
);

export const automationActionRuns = pgTable(
  "automation_action_runs",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => automationRuns.id),
    actionId: text("action_id").notNull(),
    state: text("state").notNull(),
    detail: jsonb("detail").$type<JsonRecord>().notNull().default({}),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
  },
  (table) => [index("automation_action_runs_run_id_idx").on(table.runId)],
);

export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    provider: text("provider").notNull(),
    status: text("status").notNull(),
    secretCiphertext: text("secret_ciphertext").notNull().default(""),
    secretIv: text("secret_iv").notNull().default(""),
    secretTag: text("secret_tag").notNull().default(""),
    definition: jsonb("definition").$type<JsonRecord>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("integration_connections_workspace_id_idx").on(table.workspaceId)],
);

export const syncLinks = pgTable(
  "sync_links",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => integrationConnections.id),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id),
    localResourceId: text("local_resource_id").notNull(),
    externalId: text("external_id").notNull(),
    direction: text("direction").notNull(),
    fieldMap: jsonb("field_map").$type<JsonRecord>().notNull().default({}),
    state: text("state").notNull(),
    lockVersion: integer("lock_version").notNull().default(0),
    details: jsonb("details").$type<JsonRecord>().notNull().default({}),
  },
  (table) => [
    index("sync_links_connection_id_idx").on(table.connectionId),
    index("sync_links_board_id_idx").on(table.boardId),
  ],
);

export const syncConflicts = pgTable(
  "sync_conflicts",
  {
    id: text("id").primaryKey(),
    linkId: text("link_id")
      .notNull()
      .references(() => syncLinks.id),
    payload: jsonb("payload").$type<JsonRecord>().notNull(),
    state: text("state").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sync_conflicts_link_id_idx").on(table.linkId)],
);

export const exportJobs = pgTable(
  "export_jobs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    status: text("status").notNull(),
    storagePath: text("storage_path"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("export_jobs_workspace_id_idx").on(table.workspaceId)],
);

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseBody: jsonb("response_body").$type<JsonRecord>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idempotency_records_workspace_id_key_unique").on(table.workspaceId, table.key),
  ],
);
