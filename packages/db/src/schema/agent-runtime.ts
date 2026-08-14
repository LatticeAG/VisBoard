import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { boards } from "./boards.js";

type JsonRecord = Record<string, unknown>;

export const agentWorkspaces = pgTable(
  "agent_workspaces",
  {
    id: text("id").primaryKey(),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    profile: text("profile").notNull(),
    state: text("state").notNull(),
    source: text("source"),
    branch: text("branch"),
    rootLabel: text("root_label").notNull(),
    latestSnapshotId: text("latest_snapshot_id"),
    latestSnapshot: jsonb("latest_snapshot").$type<JsonRecord>(),
    quotaBytes: integer("quota_bytes"),
    scratchpadContent: text("scratchpad_content").notNull().default(""),
    scratchpadVersion: integer("scratchpad_version").notNull().default(1),
    scratchpadUpdatedAt: timestamp("scratchpad_updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("agent_workspaces_board_id_idx").on(table.boardId),
    check(
      "agent_workspaces_state_check",
      sql`${table.state} IN ('provisioning','ready','suspended','destroyed')`,
    ),
    check(
      "agent_workspaces_profile_check",
      sql`${table.profile} IN ('external','container','git_worktree','remote_runner')`,
    ),
  ],
);

export const agentWorkspaceFiles = pgTable(
  "agent_workspace_files",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => agentWorkspaces.id),
    path: text("path").notNull(),
    content: text("content").notNull(),
    encoding: text("encoding").notNull().default("utf-8"),
    version: integer("version").notNull(),
    sha256: text("sha256").notNull(),
    generated: boolean("generated").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("agent_workspace_files_workspace_id_path_unique").on(table.workspaceId, table.path),
  ],
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    agentWorkspaceId: text("agent_workspace_id"),
    mode: text("mode").notNull(),
    state: text("state").notNull(),
    goal: text("goal").notNull(),
    baseRevisionId: text("base_revision_id"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    summary: text("summary"),
  },
  (table) => [
    index("agent_runs_board_id_idx").on(table.boardId),
    check(
      "agent_runs_mode_check",
      sql`${table.mode} IN ('observe','propose','contribute','operate')`,
    ),
    check(
      "agent_runs_state_check",
      sql`${table.state} IN ('running','waiting_for_human','completed','failed','cancelled')`,
    ),
  ],
);

export const agentLeases = pgTable(
  "agent_leases",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id),
    capabilities: text("capabilities").array().notNull().default([]),
    allowedPaths: text("allowed_paths").array().notNull().default([]),
    state: text("state").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("agent_leases_run_id_idx").on(table.runId),
    check("agent_leases_state_check", sql`${table.state} IN ('active','revoked','expired')`),
  ],
);

export const handoffs = pgTable(
  "handoffs",
  {
    id: text("id").primaryKey(),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id),
    originatingRunId: text("originating_run_id").notNull(),
    agentWorkspaceId: text("agent_workspace_id"),
    revisionId: text("revision_id"),
    state: text("state").notNull(),
    packet: jsonb("packet").$type<JsonRecord>().notNull(),
    packetHash: text("packet_hash"),
    beliefTraceHash: text("belief_trace_hash"),
    claimedById: text("claimed_by_id"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    resumedAt: timestamp("resumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("handoffs_board_id_state_idx").on(table.boardId, table.state),
    check(
      "handoffs_state_check",
      sql`${table.state} IN ('draft','awaiting_review','in_review','approved','rejected','changes_requested','cancelled','expired','resumed')`,
    ),
  ],
);

export const handoffDecisions = pgTable(
  "handoff_decisions",
  {
    id: text("id").primaryKey(),
    handoffId: text("handoff_id")
      .notNull()
      .references(() => handoffs.id),
    reviewerId: text("reviewer_id").notNull(),
    outcome: text("outcome").notNull(),
    rationale: text("rationale"),
    conditions: jsonb("conditions").$type<JsonRecord>().notNull().default({}),
    packetHash: text("packet_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("handoff_decisions_handoff_id_idx").on(table.handoffId)],
);
