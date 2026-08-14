import { isNull } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { projects } from "./projects.js";
import { workspaces } from "./workspaces.js";

type JsonRecord = Record<string, unknown>;

/**
 * V3's server-owned board model. The active collaborative document is named
 * here but intentionally does not use a circular foreign key: a document has
 * to be created before a board can point at it, and restore swaps that pointer
 * atomically at the service boundary.
 */
export const boards = pgTable(
  "boards",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    legacyProjectId: text("legacy_project_id").references(() => projects.id),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").notNull().default("active"),
    currentDocumentId: text("current_document_id"),
    headRevisionId: text("head_revision_id"),
    headSequence: integer("head_sequence").notNull().default(0),
    effectGeneration: integer("effect_generation").notNull().default(0),
    templateInstallationId: text("template_installation_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("boards_workspace_id_idx").on(table.workspaceId),
    uniqueIndex("boards_workspace_id_slug_active_unique")
      .on(table.workspaceId, table.slug)
      .where(isNull(table.deletedAt)),
    uniqueIndex("boards_legacy_project_id_unique").on(table.legacyProjectId),
  ],
);

export const boardDocuments = pgTable(
  "board_documents",
  {
    id: text("id").primaryKey(),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id),
    epoch: integer("epoch").notNull(),
    state: text("state").notNull().default("active"),
    schemaVersion: integer("schema_version").notNull().default(1),
    createdFromRevisionId: text("created_from_revision_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("board_documents_board_id_epoch_unique").on(table.boardId, table.epoch),
    index("board_documents_board_id_state_idx").on(table.boardId, table.state),
  ],
);

export const boardBlocks = pgTable(
  "board_blocks",
  {
    id: text("id").primaryKey(),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id),
    documentId: text("document_id")
      .notNull()
      .references(() => boardDocuments.id),
    type: text("type").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    parentBlockId: text("parent_block_id"),
    slot: text("slot"),
    rank: text("rank").notNull().default("a0"),
    visibility: text("visibility").notNull().default("board"),
    attributes: jsonb("attributes").$type<JsonRecord>().notNull().default({}),
    content: jsonb("content").$type<JsonRecord>().notNull().default({}),
    lifecycleState: text("lifecycle_state").notNull().default("active"),
    templateOriginKey: text("template_origin_key"),
    createdByType: text("created_by_type").notNull(),
    createdById: text("created_by_id").notNull(),
    updatedByType: text("updated_by_type").notNull(),
    updatedById: text("updated_by_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("board_blocks_board_id_idx").on(table.boardId),
    index("board_blocks_document_id_idx").on(table.documentId),
    index("board_blocks_parent_block_id_idx").on(table.parentBlockId),
    uniqueIndex("board_blocks_board_template_origin_key_active_unique")
      .on(table.boardId, table.templateOriginKey)
      .where(isNull(table.deletedAt)),
  ],
);

export const boardRevisions = pgTable(
  "board_revisions",
  {
    id: text("id").primaryKey(),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id),
    documentId: text("document_id")
      .notNull()
      .references(() => boardDocuments.id),
    revisionNumber: integer("revision_number").notNull(),
    parentRevisionId: text("parent_revision_id"),
    restoredFromRevisionId: text("restored_from_revision_id"),
    trigger: text("trigger").notNull(),
    label: text("label"),
    summary: text("summary"),
    state: jsonb("state").$type<JsonRecord>().notNull(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("board_revisions_board_id_revision_number_unique").on(
      table.boardId,
      table.revisionNumber,
    ),
    index("board_revisions_board_id_created_at_idx").on(table.boardId, table.createdAt),
  ],
);

/** Durable semantic feed for board commands; raw collaborative updates belong elsewhere. */
export const boardEvents = pgTable(
  "board_events",
  {
    id: text("id").primaryKey(),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id),
    sequence: integer("sequence").notNull(),
    revisionId: text("revision_id"),
    type: text("type").notNull(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    causationId: text("causation_id"),
    payload: jsonb("payload").$type<JsonRecord>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("board_events_board_id_sequence_unique").on(table.boardId, table.sequence),
    index("board_events_board_id_created_at_idx").on(table.boardId, table.createdAt),
  ],
);

export const boardTemplates = pgTable(
  "board_templates",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").references(() => workspaces.id),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    scope: text("scope").notNull().default("private"),
    createdById: text("created_by_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("board_templates_workspace_id_slug_unique").on(table.workspaceId, table.slug),
    index("board_templates_scope_idx").on(table.scope),
  ],
);

export const templateVersions = pgTable(
  "template_versions",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id")
      .notNull()
      .references(() => boardTemplates.id),
    version: text("version").notNull(),
    state: text("state").notNull().default("draft"),
    manifest: jsonb("manifest").$type<JsonRecord>().notNull(),
    checksum: text("checksum").notNull(),
    createdById: text("created_by_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("template_versions_template_id_version_unique").on(table.templateId, table.version),
  ],
);

export const templateInstallations = pgTable(
  "template_installations",
  {
    id: text("id").primaryKey(),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id),
    templateVersionId: text("template_version_id")
      .notNull()
      .references(() => templateVersions.id),
    variables: jsonb("variables").$type<JsonRecord>().notNull().default({}),
    state: text("state").notNull().default("installed"),
    installedById: text("installed_by_id").notNull(),
    installedAt: timestamp("installed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("template_installations_board_id_idx").on(table.boardId)],
);

export const templateBlockMappings = pgTable(
  "template_block_mappings",
  {
    id: text("id").primaryKey(),
    installationId: text("installation_id")
      .notNull()
      .references(() => templateInstallations.id),
    templateNodeKey: text("template_node_key").notNull(),
    blockId: text("block_id")
      .notNull()
      .references(() => boardBlocks.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("template_block_mappings_installation_node_key_unique").on(
      table.installationId,
      table.templateNodeKey,
    ),
    uniqueIndex("template_block_mappings_installation_block_id_unique").on(
      table.installationId,
      table.blockId,
    ),
  ],
);
