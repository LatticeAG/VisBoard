import {
  boardCommandSchema,
  createBoardSchema,
  installTemplateSchema,
  updateBoardSchema,
} from "@visboard/shared";
import { type Context, Hono } from "hono";
import { authMiddleware, requireScope } from "../auth/middleware.js";
import { getDb } from "../db.js";
import { badRequest, notFound } from "../lib/errors.js";
import { actorFromAuth, assertWorkspaceAccess } from "../lib/helpers.js";
import { readJsonBody } from "../lib/json.js";
import {
  captureBoardRevision,
  createBoard,
  diffBoardRevisions,
  executeBoardCommand,
  getBoard,
  getBoardBlock,
  getBoardRevision,
  getBoardState,
  listBoardRevisions,
  listBoards,
  restoreBoardRevision,
  updateBoard,
} from "../services/board.js";
import { installTemplate } from "../services/template.js";
import { getWorkspaceById } from "../services/workspace.js";
import { getAutomationEngine } from "./automations.js";

export const boardRoutes = new Hono();

boardRoutes.use("*", authMiddleware);

async function requireV2Workspace(c: Context) {
  const auth = c.get("auth");
  const workspaceId = c.req.param("workspace");
  if (!workspaceId) throw badRequest("Missing workspace path parameter");
  const { db } = getDb();
  const workspace = await getWorkspaceById(db, workspaceId);
  if (!workspace) throw notFound(`Workspace '${workspaceId}' not found`);
  assertWorkspaceAccess(auth, workspace.id);
  return { auth, db, workspaceId };
}

function parseJson<T>(parsed: { success: boolean; data?: T; error?: { message: string } }): T {
  if (!parsed.success || parsed.data === undefined) {
    throw badRequest(parsed.error?.message ?? "Invalid request body");
  }
  return parsed.data;
}

function requestPreconditions(c: Context) {
  return {
    expectedRevisionId: c.req.header("If-Board-Revision") ?? undefined,
    expectedDocumentId: c.req.header("If-Board-Document") ?? undefined,
  };
}

function semanticCommandEventType(kind: string): string {
  switch (kind) {
    case "block.create":
      return "block.created";
    case "block.archive":
      return "block.archived";
    case "block.move":
      return "block.moved";
    case "kanban.card.move":
      return "kanban.card.transitioned";
    default:
      return "block.updated";
  }
}

async function dispatchAutomationEvent(
  db: ReturnType<typeof getDb>["db"],
  workspaceId: string,
  boardId: string,
  auth: { type: "user" | "agent"; id: string },
  revision: { id: string; created_at: string },
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const board = await getBoard(db, workspaceId, boardId);
  await getAutomationEngine(db).processEvent({
    id: `automation-event:${revision.id}`,
    type,
    workspace_id: workspaceId,
    board_id: boardId,
    revision_id: revision.id,
    actor: { type: auth.type, id: auth.id },
    source: auth.type === "agent" ? "agent" : "human",
    effect_generation: board.effect_generation,
    payload,
    created_at: revision.created_at,
  });
}

boardRoutes.get("/", requireScope("read", "admin"), async (c) => {
  const { db, workspaceId } = await requireV2Workspace(c);
  return c.json({ data: await listBoards(db, workspaceId) });
});

boardRoutes.post("/", requireScope("admin"), async (c) => {
  const { auth, db, workspaceId } = await requireV2Workspace(c);
  const input = parseJson(createBoardSchema.safeParse(await readJsonBody(c)));
  const result = await createBoard(db, workspaceId, auth, input);
  if (input.template_version_id) {
    const installed = await installTemplate(db, workspaceId, result.board.id, auth, {
      template_version_id: input.template_version_id,
      variables: input.template_variables ?? {},
    });
    return c.json(
      {
        ...result.board,
        document: result.document,
        revision: result.revision,
        template_installation: installed,
      },
      201,
    );
  }
  return c.json({ ...result.board, document: result.document, revision: result.revision }, 201);
});

boardRoutes.get("/:board/state", requireScope("read", "admin"), async (c) => {
  const { db, workspaceId } = await requireV2Workspace(c);
  const boardId = c.req.param("board");
  if (!boardId) throw badRequest("Missing board path parameter");
  return c.json(await getBoardState(db, workspaceId, boardId, c.req.query("at_revision")));
});

boardRoutes.post(
  "/:board/commands",
  requireScope("write:notes", "write:checklists", "admin"),
  async (c) => {
    const { auth, db, workspaceId } = await requireV2Workspace(c);
    const boardId = c.req.param("board");
    if (!boardId) throw badRequest("Missing board path parameter");
    const command = parseJson(boardCommandSchema.safeParse(await readJsonBody(c)));
    const preconditions = requestPreconditions(c);
    command.expected = {
      ...command.expected,
      revision_id: preconditions.expectedRevisionId ?? command.expected.revision_id,
      document_id: preconditions.expectedDocumentId ?? command.expected.document_id,
    };
    const result = await executeBoardCommand(db, workspaceId, boardId, auth, command);
    await dispatchAutomationEvent(
      db,
      workspaceId,
      boardId,
      auth,
      result.revision,
      semanticCommandEventType(command.kind),
      {
        command_id: command.command_id,
        kind: command.kind,
        block_id: result.block?.id ?? null,
        causation_id: command.causation_id ?? null,
      },
    );
    return c.json(result);
  },
);

boardRoutes.get("/:board/blocks/:block", requireScope("read", "admin"), async (c) => {
  const { db, workspaceId } = await requireV2Workspace(c);
  const boardId = c.req.param("board");
  const blockId = c.req.param("block");
  if (!boardId || !blockId) throw badRequest("Missing board or block path parameter");
  return c.json(await getBoardBlock(db, workspaceId, boardId, blockId));
});

boardRoutes.get("/:board/revisions", requireScope("read", "admin"), async (c) => {
  const { db, workspaceId } = await requireV2Workspace(c);
  const boardId = c.req.param("board");
  if (!boardId) throw badRequest("Missing board path parameter");
  return c.json({ data: await listBoardRevisions(db, workspaceId, boardId) });
});

boardRoutes.post(
  "/:board/revisions",
  requireScope("write:notes", "write:checklists", "admin"),
  async (c) => {
    const { auth, db, workspaceId } = await requireV2Workspace(c);
    const boardId = c.req.param("board");
    if (!boardId) throw badRequest("Missing board path parameter");
    await getBoard(db, workspaceId, boardId);
    const body = (await c.req.json().catch(() => ({}))) as {
      label?: unknown;
      summary?: unknown;
    };
    if (body.label !== undefined && typeof body.label !== "string") {
      throw badRequest("label must be a string");
    }
    if (body.summary !== undefined && typeof body.summary !== "string") {
      throw badRequest("summary must be a string");
    }
    const revision = await captureBoardRevision(db, boardId, {
      trigger: "manual",
      actor: actorFromAuth(auth),
      label: body.label ?? null,
      summary: body.summary ?? null,
      ...requestPreconditions(c),
    });
    await dispatchAutomationEvent(
      db,
      workspaceId,
      boardId,
      auth,
      revision,
      "board.revision.created",
      { trigger: "manual", label: body.label ?? null, summary: body.summary ?? null },
    );
    return c.json(revision, 201);
  },
);

boardRoutes.get("/:board/revisions/:revision", requireScope("read", "admin"), async (c) => {
  const { db, workspaceId } = await requireV2Workspace(c);
  const boardId = c.req.param("board");
  const revisionId = c.req.param("revision");
  if (!boardId || !revisionId) throw badRequest("Missing board or revision path parameter");
  return c.json(await getBoardRevision(db, workspaceId, boardId, revisionId));
});

boardRoutes.get("/:board/diff", requireScope("read", "admin"), async (c) => {
  const { db, workspaceId } = await requireV2Workspace(c);
  const boardId = c.req.param("board");
  const from = c.req.query("from");
  const to = c.req.query("to");
  if (!boardId || !from || !to) {
    throw badRequest("board, from, and to revision IDs are required");
  }
  return c.json(await diffBoardRevisions(db, workspaceId, boardId, from, to));
});

boardRoutes.post("/:board/restore", requireScope("admin"), async (c) => {
  const { auth, db, workspaceId } = await requireV2Workspace(c);
  const boardId = c.req.param("board");
  if (!boardId) throw badRequest("Missing board path parameter");
  const body = (await readJsonBody(c)) as {
    revision_id?: unknown;
    expected_document_id?: unknown;
    reason?: unknown;
  };
  if (typeof body.revision_id !== "string" || typeof body.reason !== "string") {
    throw badRequest("revision_id and reason are required strings");
  }
  if (body.expected_document_id !== undefined && typeof body.expected_document_id !== "string") {
    throw badRequest("expected_document_id must be a string when provided");
  }
  const restored = await restoreBoardRevision(
    db,
    workspaceId,
    boardId,
    body.revision_id,
    auth,
    body.reason,
    typeof body.expected_document_id === "string"
      ? body.expected_document_id
      : requestPreconditions(c).expectedDocumentId,
  );
  await dispatchAutomationEvent(db, workspaceId, boardId, auth, restored, "board.restored", {
    restored_from_revision_id: restored.restored_from_revision_id,
    reason: body.reason,
  });
  return c.json(restored);
});

boardRoutes.post("/:board/template-installations", requireScope("admin"), async (c) => {
  const { auth, db, workspaceId } = await requireV2Workspace(c);
  const boardId = c.req.param("board");
  if (!boardId) throw badRequest("Missing board path parameter");
  const input = parseJson(installTemplateSchema.safeParse(await c.req.json()));
  const installed = await installTemplate(db, workspaceId, boardId, auth, input);
  await dispatchAutomationEvent(
    db,
    workspaceId,
    boardId,
    auth,
    installed.revision,
    "template.installed",
    {
      template_version_id: installed.installation.template_version_id,
      installation_id: installed.installation.id,
    },
  );
  return c.json(installed, 201);
});

boardRoutes.get("/:board", requireScope("read", "admin"), async (c) => {
  const { db, workspaceId } = await requireV2Workspace(c);
  const boardId = c.req.param("board");
  if (!boardId) throw badRequest("Missing board path parameter");
  return c.json(await getBoard(db, workspaceId, boardId));
});

boardRoutes.patch("/:board", requireScope("admin"), async (c) => {
  const { db, workspaceId } = await requireV2Workspace(c);
  const boardId = c.req.param("board");
  if (!boardId) throw badRequest("Missing board path parameter");
  const input = parseJson(updateBoardSchema.safeParse(await c.req.json()));
  input.expected_revision_id = c.req.header("If-Board-Revision") ?? input.expected_revision_id;
  return c.json(await updateBoard(db, workspaceId, boardId, input));
});
