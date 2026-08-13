import {
  boardBlocks,
  boardDocuments,
  boardEvents,
  boardRevisions,
  boards,
  type Database,
} from "@visboard/db";
import {
  PREFIX,
  boardBlockSchema,
  boardRevisionStateSchema,
  createBoardBlockSchema,
  createId,
  slugify,
  updateBoardBlockSchema,
  type BoardCommand,
  type BoardRevisionState,
  type CreateBoardInput,
  type UpdateBoardInput,
} from "@visboard/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { AuthPrincipal } from "../auth/middleware.js";
import { actorFromAuth } from "../lib/helpers.js";
import {
  badRequest,
  conflict,
  notFound,
  preconditionFailed,
} from "../lib/errors.js";
import { getWorkspaceById } from "./workspace.js";

type Actor = ReturnType<typeof actorFromAuth>;
type BoardRecord = typeof boards.$inferSelect;
type DocumentRecord = typeof boardDocuments.$inferSelect;
type BlockRecord = typeof boardBlocks.$inferSelect;
type RevisionRecord = typeof boardRevisions.$inferSelect;

type RevisionOptions = {
  trigger: "board_created" | "manual" | "command" | "template_installed" | "restore";
  actor: Actor;
  label?: string | null;
  summary?: string | null;
  restoredFromRevisionId?: string | null;
  eventType?: string;
  payload?: Record<string, unknown>;
  expectedRevisionId?: string;
  expectedDocumentId?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function toIso(value: Date): string {
  return value.toISOString();
}

export function formatBoard(board: BoardRecord) {
  return {
    id: board.id,
    workspace_id: board.workspaceId,
    legacy_project_id: board.legacyProjectId,
    slug: board.slug,
    name: board.name,
    description: board.description,
    status: board.status,
    current_document_id: board.currentDocumentId,
    head_revision_id: board.headRevisionId,
    head_sequence: board.headSequence,
    effect_generation: board.effectGeneration,
    template_installation_id: board.templateInstallationId,
    created_at: toIso(board.createdAt),
    updated_at: toIso(board.updatedAt),
    deleted_at: board.deletedAt ? toIso(board.deletedAt) : null,
  };
}

export function formatBoardDocument(document: DocumentRecord) {
  return {
    id: document.id,
    board_id: document.boardId,
    epoch: document.epoch,
    state: document.state,
    schema_version: document.schemaVersion,
    created_from_revision_id: document.createdFromRevisionId,
    created_at: toIso(document.createdAt),
    updated_at: toIso(document.updatedAt),
  };
}

export function formatBoardBlock(block: BlockRecord) {
  return {
    id: block.id,
    board_id: block.boardId,
    document_id: block.documentId,
    type: block.type,
    schema_version: block.schemaVersion,
    parent_block_id: block.parentBlockId,
    slot: block.slot,
    rank: block.rank,
    visibility: block.visibility,
    attributes: asRecord(block.attributes),
    content: asRecord(block.content),
    lifecycle_state: block.lifecycleState,
    template_origin_key: block.templateOriginKey,
    created_by_type: block.createdByType,
    created_by_id: block.createdById,
    updated_by_type: block.updatedByType,
    updated_by_id: block.updatedById,
    created_at: toIso(block.createdAt),
    updated_at: toIso(block.updatedAt),
    deleted_at: block.deletedAt ? toIso(block.deletedAt) : null,
  };
}

export function formatBoardRevision(revision: RevisionRecord) {
  const state = boardRevisionStateSchema.parse(revision.state);
  return {
    id: revision.id,
    board_id: revision.boardId,
    document_id: revision.documentId,
    revision_number: revision.revisionNumber,
    parent_revision_id: revision.parentRevisionId,
    restored_from_revision_id: revision.restoredFromRevisionId,
    trigger: revision.trigger,
    label: revision.label,
    summary: revision.summary,
    state,
    actor_type: revision.actorType,
    actor_id: revision.actorId,
    created_at: toIso(revision.createdAt),
  };
}

export async function listBoards(db: Database["db"], workspaceId: string) {
  const rows = await db
    .select()
    .from(boards)
    .where(and(eq(boards.workspaceId, workspaceId), isNull(boards.deletedAt)));

  return rows
    .filter((board) => board.workspaceId === workspaceId && !board.deletedAt)
    .map(formatBoard);
}

async function getBoardRecord(
  db: Database["db"],
  workspaceId: string,
  boardId: string,
): Promise<BoardRecord> {
  const rows = await db
    .select()
    .from(boards)
    .where(
      and(
        eq(boards.id, boardId),
        eq(boards.workspaceId, workspaceId),
        isNull(boards.deletedAt),
      ),
    );
  const board = rows.find(
    (row) =>
      row.id === boardId && row.workspaceId === workspaceId && !row.deletedAt,
  );
  if (!board) throw notFound(`Board '${boardId}' not found`);
  return board;
}

async function getBoardRecordById(
  db: Database["db"],
  boardId: string,
): Promise<BoardRecord> {
  const rows = await db.select().from(boards).where(eq(boards.id, boardId));
  const board = rows.find((row) => row.id === boardId && !row.deletedAt);
  if (!board) throw notFound(`Board '${boardId}' not found`);
  return board;
}

export async function getBoard(
  db: Database["db"],
  workspaceId: string,
  boardId: string,
) {
  return formatBoard(await getBoardRecord(db, workspaceId, boardId));
}

async function getActiveDocument(
  db: Database["db"],
  board: BoardRecord,
): Promise<DocumentRecord> {
  if (!board.currentDocumentId) {
    throw conflict(`Board '${board.id}' has no active document`);
  }
  const rows = await db
    .select()
    .from(boardDocuments)
    .where(eq(boardDocuments.id, board.currentDocumentId));
  const document = rows.find(
    (row) =>
      row.id === board.currentDocumentId &&
      row.boardId === board.id &&
      row.state === "active",
  );
  if (!document) throw conflict(`Board '${board.id}' has no active document`);
  return document;
}

export async function listBoardBlocks(
  db: Database["db"],
  boardId: string,
  documentId?: string,
) {
  const rows = await db
    .select()
    .from(boardBlocks)
    .where(
      and(
        eq(boardBlocks.boardId, boardId),
        documentId ? eq(boardBlocks.documentId, documentId) : undefined,
        isNull(boardBlocks.deletedAt),
      ),
    );

  return rows
    .filter(
      (block) =>
        block.boardId === boardId &&
        !block.deletedAt &&
        (!documentId || block.documentId === documentId),
    )
    .sort((a, b) => a.rank.localeCompare(b.rank));
}

async function getBoardBlockRecord(
  db: Database["db"],
  boardId: string,
  blockId: string,
  includeArchived = false,
) {
  const rows = await db
    .select()
    .from(boardBlocks)
    .where(and(eq(boardBlocks.id, blockId), eq(boardBlocks.boardId, boardId)));
  const block = rows.find(
    (row) =>
      row.id === blockId &&
      row.boardId === boardId &&
      !row.deletedAt &&
      (includeArchived || row.lifecycleState === "active"),
  );
  if (!block) throw notFound(`Block '${blockId}' not found`);
  return block;
}

export async function getBoardBlock(
  db: Database["db"],
  workspaceId: string,
  boardId: string,
  blockId: string,
) {
  await getBoardRecord(db, workspaceId, boardId);
  return formatBoardBlock(await getBoardBlockRecord(db, boardId, blockId, true));
}

function nextRank(blocks: readonly BlockRecord[]): string {
  return `a${String(blocks.length + 1).padStart(8, "0")}`;
}

export async function createBoard(
  db: Database["db"],
  workspaceId: string,
  auth: AuthPrincipal,
  input: CreateBoardInput,
) {
  const workspace = await getWorkspaceById(db, workspaceId);
  if (!workspace) throw notFound(`Workspace '${workspaceId}' not found`);

  const slug = input.slug ?? slugify(input.name);
  const existing = await db
    .select()
    .from(boards)
    .where(and(eq(boards.workspaceId, workspaceId), eq(boards.slug, slug)));
  if (existing.some((board) => board.workspaceId === workspaceId && board.slug === slug && !board.deletedAt)) {
    throw conflict(`Board slug '${slug}' already exists`);
  }

  const now = new Date();
  const boardId = createId(PREFIX.board);
  const documentId = createId(PREFIX.boardDocument);
  const actor = actorFromAuth(auth);

  await db.insert(boards).values({
    id: boardId,
    workspaceId,
    slug,
    name: input.name,
    description: input.description ?? "",
    status: input.status ?? "active",
    currentDocumentId: null,
    headRevisionId: null,
    headSequence: 0,
    effectGeneration: 0,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(boardDocuments).values({
    id: documentId,
    boardId,
    epoch: 1,
    state: "active",
    schemaVersion: 1,
    createdFromRevisionId: null,
    createdAt: now,
    updatedAt: now,
  });

  await db
    .update(boards)
    .set({ currentDocumentId: documentId, updatedAt: now })
    .where(eq(boards.id, boardId));

  const revision = await captureBoardRevision(db, boardId, {
    trigger: "board_created",
    actor,
    summary: "Initial board revision",
    eventType: "board.created",
  });
  const board = await getBoardRecord(db, workspaceId, boardId);
  const document = await getActiveDocument(db, board);

  return {
    board: formatBoard(board),
    document: formatBoardDocument(document),
    revision,
  };
}

export async function updateBoard(
  db: Database["db"],
  workspaceId: string,
  boardId: string,
  input: UpdateBoardInput,
) {
  const board = await getBoardRecord(db, workspaceId, boardId);
  if (
    input.expected_revision_id !== undefined &&
    input.expected_revision_id !== board.headRevisionId
  ) {
    throw preconditionFailed(
      `Revision mismatch: expected ${input.expected_revision_id}, current is ${board.headRevisionId}`,
    );
  }

  const now = new Date();
  const [updated] = await db
    .update(boards)
    .set({
      name: input.name ?? board.name,
      description: input.description ?? board.description,
      status: input.status ?? board.status,
      updatedAt: now,
    })
    .where(eq(boards.id, board.id))
    .returning();
  return formatBoard(updated!);
}

export async function getBoardState(
  db: Database["db"],
  workspaceId: string,
  boardId: string,
  atRevisionId?: string,
) {
  const board = await getBoardRecord(db, workspaceId, boardId);
  if (atRevisionId) {
    const revision = await getBoardRevision(db, workspaceId, boardId, atRevisionId);
    return {
      board: formatBoard(board),
      document: revision.state.document,
      blocks: revision.state.blocks,
      head_revision: revision,
      read_only: true,
    };
  }

  const document = await getActiveDocument(db, board);
  const blocks = await listBoardBlocks(db, board.id, document.id);
  const revision = board.headRevisionId
    ? await getBoardRevision(db, workspaceId, boardId, board.headRevisionId)
    : null;
  return {
    board: formatBoard(board),
    document: formatBoardDocument(document),
    blocks: blocks.map(formatBoardBlock),
    head_revision: revision,
    read_only: false,
  };
}

export async function createBoardBlock(
  db: Database["db"],
  boardId: string,
  actor: Actor,
  input: unknown,
  document?: DocumentRecord,
) {
  const parsed = createBoardBlockSchema.safeParse(input);
  if (!parsed.success) throw badRequest(parsed.error.message);
  const board = await getBoardRecordById(db, boardId);
  const activeDocument = document ?? (await getActiveDocument(db, board));
  const blocks = await listBoardBlocks(db, board.id, activeDocument.id);
  const now = new Date();

  const [block] = await db
    .insert(boardBlocks)
    .values({
      id: createId(PREFIX.boardBlock),
      boardId: board.id,
      documentId: activeDocument.id,
      type: parsed.data.type,
      schemaVersion: parsed.data.schema_version,
      parentBlockId: parsed.data.parent_block_id ?? null,
      slot: parsed.data.slot ?? null,
      rank: parsed.data.rank ?? nextRank(blocks),
      visibility: parsed.data.visibility ?? "board",
      attributes: parsed.data.attributes ?? {},
      content: parsed.data.content ?? {},
      lifecycleState: "active",
      templateOriginKey: parsed.data.template_origin_key ?? null,
      createdByType: actor.actorType,
      createdById: actor.actorId,
      updatedByType: actor.actorType,
      updatedById: actor.actorId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return block!;
}

async function updateBoardBlock(
  db: Database["db"],
  block: BlockRecord,
  actor: Actor,
  input: unknown,
) {
  const parsed = updateBoardBlockSchema.safeParse(input);
  if (!parsed.success) throw badRequest(parsed.error.message);
  const now = new Date();
  const [updated] = await db
    .update(boardBlocks)
    .set({
      attributes: parsed.data.attributes ?? block.attributes,
      content: parsed.data.content ?? block.content,
      visibility: parsed.data.visibility ?? block.visibility,
      rank: parsed.data.rank ?? block.rank,
      parentBlockId:
        parsed.data.parent_block_id !== undefined
          ? parsed.data.parent_block_id
          : block.parentBlockId,
      slot: parsed.data.slot !== undefined ? parsed.data.slot : block.slot,
      updatedByType: actor.actorType,
      updatedById: actor.actorId,
      updatedAt: now,
    })
    .where(eq(boardBlocks.id, block.id))
    .returning();
  return updated!;
}

export async function captureBoardRevision(
  db: Database["db"],
  boardId: string,
  options: RevisionOptions,
) {
  const board = await getBoardRecordById(db, boardId);
  if (
    options.expectedRevisionId !== undefined &&
    options.expectedRevisionId !== board.headRevisionId
  ) {
    throw preconditionFailed(
      `Revision mismatch: expected ${options.expectedRevisionId}, current is ${board.headRevisionId}`,
    );
  }
  if (
    options.expectedDocumentId !== undefined &&
    options.expectedDocumentId !== board.currentDocumentId
  ) {
    throw preconditionFailed(
      `Document mismatch: expected ${options.expectedDocumentId}, current is ${board.currentDocumentId}`,
    );
  }
  const document = await getActiveDocument(db, board);
  const blocks = await listBoardBlocks(db, board.id, document.id);
  const state: BoardRevisionState = {
    version: 1,
    document: formatBoardDocument(document) as unknown as Record<string, unknown>,
    blocks: blocks.map(
      (block) => formatBoardBlock(block) as unknown as Record<string, unknown>,
    ),
  };
  const existingRevisions = await db
    .select()
    .from(boardRevisions)
    .where(eq(boardRevisions.boardId, board.id));
  const revisionNumber =
    existingRevisions
      .filter((revision) => revision.boardId === board.id)
      .reduce((highest, revision) => Math.max(highest, revision.revisionNumber), 0) + 1;
  const now = new Date();
  const revisionId = createId(PREFIX.boardRevision);

  const [revision] = await db
    .insert(boardRevisions)
    .values({
      id: revisionId,
      boardId: board.id,
      documentId: document.id,
      revisionNumber,
      parentRevisionId: board.headRevisionId,
      restoredFromRevisionId: options.restoredFromRevisionId ?? null,
      trigger: options.trigger,
      label: options.label ?? null,
      summary: options.summary ?? null,
      state: state as unknown as Record<string, unknown>,
      actorType: options.actor.actorType,
      actorId: options.actor.actorId,
      createdAt: now,
    })
    .returning();

  const sequence = (board.headSequence ?? 0) + 1;
  await db
    .update(boards)
    .set({
      headRevisionId: revisionId,
      headSequence: sequence,
      updatedAt: now,
    })
    .where(eq(boards.id, board.id));
  await db.insert(boardEvents).values({
    id: createId(PREFIX.boardEvent),
    boardId: board.id,
    sequence,
    revisionId,
    type: options.eventType ?? "board.revision.created",
    actorType: options.actor.actorType,
    actorId: options.actor.actorId,
    payload: {
      trigger: options.trigger,
      label: options.label ?? null,
      summary: options.summary ?? null,
      ...options.payload,
    },
    createdAt: now,
  });

  return formatBoardRevision(revision!);
}

function assertCommandPreconditions(board: BoardRecord, command: BoardCommand) {
  if (
    command.expected.revision_id !== undefined &&
    command.expected.revision_id !== board.headRevisionId
  ) {
    throw preconditionFailed(
      `Revision mismatch: expected ${command.expected.revision_id}, current is ${board.headRevisionId}`,
    );
  }
  if (
    command.expected.document_id !== undefined &&
    command.expected.document_id !== board.currentDocumentId
  ) {
    throw preconditionFailed(
      `Document mismatch: expected ${command.expected.document_id}, current is ${board.currentDocumentId}`,
    );
  }
}

function commandBlockId(command: BoardCommand): string {
  if (!command.target.block_id) {
    throw badRequest(`Command '${command.kind}' requires target.block_id`);
  }
  return command.target.block_id;
}

export async function executeBoardCommand(
  db: Database["db"],
  workspaceId: string,
  boardId: string,
  auth: AuthPrincipal,
  command: BoardCommand,
) {
  const board = await getBoardRecord(db, workspaceId, boardId);
  assertCommandPreconditions(board, command);
  const actor = actorFromAuth(auth);
  let block: BlockRecord | undefined;
  let eventType = "block.updated";

  switch (command.kind) {
    case "block.create":
      block = await createBoardBlock(db, board.id, actor, command.payload);
      eventType = "block.created";
      break;
    case "block.update": {
      const current = await getBoardBlockRecord(
        db,
        board.id,
        commandBlockId(command),
      );
      block = await updateBoardBlock(db, current, actor, command.payload);
      break;
    }
    case "block.archive": {
      const current = await getBoardBlockRecord(
        db,
        board.id,
        commandBlockId(command),
        true,
      );
      const now = new Date();
      const [updated] = await db
        .update(boardBlocks)
        .set({
          lifecycleState: "archived",
          updatedByType: actor.actorType,
          updatedById: actor.actorId,
          updatedAt: now,
        })
        .where(eq(boardBlocks.id, current.id))
        .returning();
      block = updated!;
      eventType = "block.archived";
      break;
    }
    case "block.move": {
      const current = await getBoardBlockRecord(
        db,
        board.id,
        commandBlockId(command),
      );
      block = await updateBoardBlock(db, current, actor, command.payload);
      eventType = "block.moved";
      break;
    }
    case "kanban.card.move": {
      const card = await getBoardBlockRecord(
        db,
        board.id,
        commandBlockId(command),
      );
      if (card.type !== "core.kanban_card") {
        throw conflict("kanban.card.move only applies to core.kanban_card blocks");
      }
      const laneId = command.payload.lane_id;
      if (typeof laneId !== "string") {
        throw badRequest("kanban.card.move requires payload.lane_id");
      }
      const lane = await getBoardBlockRecord(db, board.id, laneId);
      if (lane.type !== "core.kanban_column") {
        throw conflict("kanban.card.move target must be a core.kanban_column block");
      }
      block = await updateBoardBlock(db, card, actor, {
        attributes: { ...asRecord(card.attributes), lane_id: lane.id },
      });
      eventType = "kanban.card.transitioned";
      break;
    }
  }

  const revision = await captureBoardRevision(db, board.id, {
    trigger: "command",
    actor,
    summary: command.reason ?? command.kind,
    eventType,
    payload: {
      command_id: command.command_id,
      kind: command.kind,
      block_id: block?.id ?? null,
      causation_id: command.causation_id ?? null,
    },
  });

  return {
    status: "applied" as const,
    command_id: command.command_id,
    block: block ? formatBoardBlock(block) : null,
    revision,
  };
}

async function getRevisionRecord(
  db: Database["db"],
  boardId: string,
  revisionId: string,
) {
  const rows = await db
    .select()
    .from(boardRevisions)
    .where(and(eq(boardRevisions.boardId, boardId), eq(boardRevisions.id, revisionId)));
  const revision = rows.find(
    (row) => row.boardId === boardId && row.id === revisionId,
  );
  if (!revision) throw notFound(`Revision '${revisionId}' not found`);
  return revision;
}

export async function listBoardRevisions(
  db: Database["db"],
  workspaceId: string,
  boardId: string,
) {
  await getBoardRecord(db, workspaceId, boardId);
  const rows = await db
    .select()
    .from(boardRevisions)
    .where(eq(boardRevisions.boardId, boardId));
  return rows
    .filter((revision) => revision.boardId === boardId)
    .sort((a, b) => b.revisionNumber - a.revisionNumber)
    .map(formatBoardRevision);
}

export async function getBoardRevision(
  db: Database["db"],
  workspaceId: string,
  boardId: string,
  revisionId: string,
) {
  await getBoardRecord(db, workspaceId, boardId);
  return formatBoardRevision(await getRevisionRecord(db, boardId, revisionId));
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

export async function diffBoardRevisions(
  db: Database["db"],
  workspaceId: string,
  boardId: string,
  fromRevisionId: string,
  toRevisionId: string,
) {
  await getBoardRecord(db, workspaceId, boardId);
  const from = formatBoardRevision(
    await getRevisionRecord(db, boardId, fromRevisionId),
  );
  const to = formatBoardRevision(
    await getRevisionRecord(db, boardId, toRevisionId),
  );
  const fromBlocks = new Map(
    from.state.blocks.map((block) => [String(block.id), block]),
  );
  const toBlocks = new Map(
    to.state.blocks.map((block) => [String(block.id), block]),
  );
  const added = [...toBlocks.entries()]
    .filter(([id]) => !fromBlocks.has(id))
    .map(([, block]) => block);
  const removed = [...fromBlocks.entries()]
    .filter(([id]) => !toBlocks.has(id))
    .map(([, block]) => block);
  const changed: Array<{
    block_id: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    moved: boolean;
    fields: string[];
  }> = [];

  for (const [id, after] of toBlocks) {
    const before = fromBlocks.get(id);
    if (!before || stableJson(before) === stableJson(after)) continue;
    const fields = Object.keys(after).filter(
      (key) => stableJson(before[key]) !== stableJson(after[key]),
    );
    changed.push({
      block_id: id,
      before,
      after,
      moved:
        before.parent_block_id !== after.parent_block_id ||
        before.rank !== after.rank ||
        before.slot !== after.slot,
      fields,
    });
  }

  return {
    from_revision_id: from.id,
    to_revision_id: to.id,
    added,
    removed,
    changed,
    blocks: { added, removed, changed },
    summary: {
      added: added.length,
      removed: removed.length,
      changed: changed.length,
    },
  };
}

export async function restoreBoardRevision(
  db: Database["db"],
  workspaceId: string,
  boardId: string,
  revisionId: string,
  auth: AuthPrincipal,
  reason: string,
  expectedDocumentId?: string,
) {
  const board = await getBoardRecord(db, workspaceId, boardId);
  if (
    expectedDocumentId !== undefined &&
    expectedDocumentId !== board.currentDocumentId
  ) {
    throw preconditionFailed(
      `Document mismatch: expected ${expectedDocumentId}, current is ${board.currentDocumentId}`,
    );
  }
  const sourceRevision = await getRevisionRecord(db, board.id, revisionId);
  const sourceState = boardRevisionStateSchema.parse(sourceRevision.state);
  const snapshotBlocks = sourceState.blocks.map((block) => boardBlockSchema.parse(block));
  const oldDocument = await getActiveDocument(db, board);
  const now = new Date();
  const newDocumentId = createId(PREFIX.boardDocument);
  const actor = actorFromAuth(auth);

  await db
    .update(boardDocuments)
    .set({ state: "read_only", updatedAt: now })
    .where(eq(boardDocuments.id, oldDocument.id));
  await db.insert(boardDocuments).values({
    id: newDocumentId,
    boardId: board.id,
    epoch: oldDocument.epoch + 1,
    state: "active",
    schemaVersion: oldDocument.schemaVersion,
    createdFromRevisionId: sourceRevision.id,
    createdAt: now,
    updatedAt: now,
  });

  const currentBlocks = await listBoardBlocks(db, board.id, oldDocument.id);
  const currentById = new Map(currentBlocks.map((block) => [block.id, block]));
  const snapshotById = new Map(snapshotBlocks.map((block) => [block.id, block]));

  for (const current of currentBlocks) {
    if (snapshotById.has(current.id)) continue;
    await db
      .update(boardBlocks)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(boardBlocks.id, current.id));
  }

  for (const snapshot of snapshotBlocks) {
    const current = currentById.get(snapshot.id);
    const values = {
      boardId: board.id,
      documentId: newDocumentId,
      type: snapshot.type,
      schemaVersion: snapshot.schema_version,
      parentBlockId: snapshot.parent_block_id,
      slot: snapshot.slot,
      rank: snapshot.rank,
      visibility: snapshot.visibility,
      attributes: snapshot.attributes,
      content: snapshot.content,
      lifecycleState: snapshot.lifecycle_state,
      templateOriginKey: snapshot.template_origin_key,
      createdByType: snapshot.created_by_type,
      createdById: snapshot.created_by_id,
      updatedByType: actor.actorType,
      updatedById: actor.actorId,
      updatedAt: now,
      deletedAt: null,
    };
    if (current) {
      await db
        .update(boardBlocks)
        .set(values)
        .where(eq(boardBlocks.id, current.id));
    } else {
      await db.insert(boardBlocks).values({
        id: snapshot.id,
        ...values,
        createdAt: now,
      });
    }
  }

  await db
    .update(boards)
    .set({
      currentDocumentId: newDocumentId,
      effectGeneration: (board.effectGeneration ?? 0) + 1,
      updatedAt: now,
    })
    .where(eq(boards.id, board.id));

  const restored = await captureBoardRevision(db, board.id, {
    trigger: "restore",
    actor,
    summary: reason,
    restoredFromRevisionId: sourceRevision.id,
    eventType: "board.restored",
    payload: { restored_from_revision_id: sourceRevision.id },
  });
  return {
    ...restored,
    restored_from_revision_id: sourceRevision.id,
    document_id: newDocumentId,
  };
}
