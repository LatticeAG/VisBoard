import { type InterchangeBlock, blockTypeSchema } from "@visboard/shared";
import { type Context, Hono } from "hono";
import { authMiddleware, requireScope } from "../auth/middleware.js";
import { getDb } from "../db.js";
import { badRequest, notFound } from "../lib/errors.js";
import { actorFromAuth, assertWorkspaceAccess } from "../lib/helpers.js";
import {
  type BoardStateForInterchange,
  exportBoardJson,
  exportBoardMarkdown,
  importBoardInterchange,
} from "../services/board-interchange.js";
import {
  captureBoardRevision,
  createBoardBlock,
  getBoard,
  getBoardState,
} from "../services/board.js";
import { getWorkspaceById } from "../services/workspace.js";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

async function requireV2Board(c: Context) {
  const auth = c.get("auth");
  const workspaceId = c.req.param("workspace");
  const boardId = c.req.param("board");
  if (!workspaceId || !boardId) {
    throw badRequest("Missing workspace or board path parameter");
  }
  const { db } = getDb();
  const workspace = await getWorkspaceById(db, workspaceId);
  if (!workspace) throw notFound(`Workspace '${workspaceId}' not found`);
  assertWorkspaceAccess(auth, workspace.id);
  await getBoard(db, workspaceId, boardId);
  return { auth, db, workspaceId, boardId };
}

function requestedFormat(value: string | undefined): "json" | "markdown" {
  if (value === undefined || value === "json") return "json";
  if (value === "markdown") return "markdown";
  throw badRequest("format must be 'json' or 'markdown'");
}

async function exportCurrentBoard(
  db: ReturnType<typeof getDb>["db"],
  workspaceId: string,
  boardId: string,
  format: "json" | "markdown",
  atRevision?: string,
) {
  const state = await getBoardState(db, workspaceId, boardId, atRevision);
  const portableState: BoardStateForInterchange = {
    board: state.board as unknown as JsonRecord,
    document: state.document as unknown as JsonRecord,
    blocks: state.blocks.map((block) => ({
      ...block,
      id: String(block.id),
      type: String(block.type),
      schema_version: typeof block.schema_version === "number" ? block.schema_version : undefined,
      parent_id: typeof block.parent_block_id === "string" ? block.parent_block_id : null,
      attributes: isRecord(block.attributes) ? block.attributes : {},
      content: isRecord(block.content) ? block.content : {},
    })) as InterchangeBlock[],
    head_revision: state.head_revision as unknown as JsonRecord | null,
  };
  const content =
    format === "json"
      ? JSON.stringify(exportBoardJson(portableState), null, 2)
      : exportBoardMarkdown(portableState);
  return {
    format,
    content,
    lossiness_report:
      format === "json"
        ? { format, lossless: true, entries: [] }
        : {
            format,
            lossless: false,
            entries: [
              {
                code: "collaboration_state_omitted",
                path: "document",
                message: "Markdown does not preserve live collaboration state.",
              },
              {
                code: "revision_history_omitted",
                path: "revision",
                message: "Markdown contains a selected checkpoint, not full history.",
              },
            ],
          },
  };
}

/**
 * Board-scoped JSON/Markdown interchange. Imports deliberately go through
 * the typed block creation boundary; unsupported extension blocks are
 * reported instead of being silently coerced into arbitrary JSON.
 */
export const interchangeRoutes = new Hono();

interchangeRoutes.use("*", authMiddleware);

interchangeRoutes.get("/:board/exports", requireScope("read", "admin"), async (c) => {
  const { db, workspaceId, boardId } = await requireV2Board(c);
  return c.json(
    await exportCurrentBoard(
      db,
      workspaceId,
      boardId,
      requestedFormat(c.req.query("format")),
      c.req.query("at_revision"),
    ),
  );
});

interchangeRoutes.post("/:board/exports", requireScope("read", "admin"), async (c) => {
  const { db, workspaceId, boardId } = await requireV2Board(c);
  const body = (await c.req.json().catch(() => ({}))) as JsonRecord;
  return c.json(
    await exportCurrentBoard(
      db,
      workspaceId,
      boardId,
      requestedFormat(stringValue(body.format)),
      stringValue(body.at_revision),
    ),
  );
});

interchangeRoutes.post("/:board/imports", requireScope("admin"), async (c) => {
  const { auth, db, workspaceId, boardId } = await requireV2Board(c);
  const raw = await c.req.text();
  let content = raw;
  let contentType = c.req.header("content-type");

  // Accept either a raw interchange document or the small API envelope used
  // by browser clients: { content, content_type? }.
  try {
    const envelope = JSON.parse(raw) as unknown;
    if (isRecord(envelope) && typeof envelope.content === "string") {
      content = envelope.content;
      contentType = stringValue(envelope.content_type) ?? contentType;
    }
  } catch {
    // Raw Markdown is intentionally not JSON.
  }

  if (!content.trim()) throw badRequest("Import content must not be empty");
  const imported = importBoardInterchange(content, contentType);
  const actor = actorFromAuth(auth);
  const sourceBlocks = imported.document.blocks;
  const pending = sourceBlocks.map((block, index) => ({ block, index }));
  const created: Array<{ source_id: string; block: unknown }> = [];
  const skipped: Array<{ source_id: string; reason: string }> = [];
  const sourceToBoardId = new Map<string, string>();

  while (pending.length > 0) {
    let progressed = false;
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const entry = pending[index];
      if (!entry) continue;
      const block = entry.block;
      const rawBlock = block as JsonRecord;
      const type = blockTypeSchema.safeParse(block.type);
      if (!type.success) {
        skipped.push({
          source_id: block.id,
          reason: `Unsupported block type '${block.type}' was retained in the import report.`,
        });
        pending.splice(index, 1);
        progressed = true;
        continue;
      }

      const parentSourceId = stringValue(rawBlock.parent_block_id) ?? block.parent_id ?? undefined;
      const parentBlockId = parentSourceId ? sourceToBoardId.get(parentSourceId) : undefined;
      if (parentSourceId && !parentBlockId) continue;

      try {
        const createdBlock = await createBoardBlock(db, boardId, actor, {
          type: type.data,
          schema_version: block.schema_version,
          parent_block_id: parentBlockId ?? null,
          slot: block.slot,
          rank: stringValue(rawBlock.rank),
          visibility: stringValue(rawBlock.visibility),
          attributes: block.attributes,
          content: block.content,
          template_origin_key: stringValue(rawBlock.template_origin_key),
        });
        sourceToBoardId.set(block.id, createdBlock.id);
        created.push({ source_id: block.id, block: createdBlock });
      } catch (error) {
        skipped.push({
          source_id: block.id,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      pending.splice(index, 1);
      progressed = true;
    }

    if (!progressed) {
      for (const entry of pending) {
        skipped.push({
          source_id: entry.block.id,
          reason: "Parent block was not importable.",
        });
      }
      break;
    }
  }

  const revision =
    created.length > 0
      ? await captureBoardRevision(db, boardId, {
          trigger: "manual",
          actor,
          label: `Imported ${imported.format.toUpperCase()}`,
          summary: `Imported ${created.length} typed block${created.length === 1 ? "" : "s"}`,
          eventType: "board.imported",
          payload: {
            format: imported.format,
            imported_blocks: created.length,
            skipped_blocks: skipped.length,
          },
        })
      : null;

  return c.json(
    {
      format: imported.format,
      imported: created,
      skipped,
      revision,
      lossiness_report: imported.document.lossiness_report,
    },
    201,
  );
});
