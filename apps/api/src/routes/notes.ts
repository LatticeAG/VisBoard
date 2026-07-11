import { Hono } from "hono";
import { authMiddleware, requireScope } from "../auth/middleware.js";
import { getDb } from "../db.js";
import { assertWorkspaceAccess, parseIfMatch, noteEtag } from "../lib/helpers.js";
import { getWorkspaceBySlug } from "../services/workspace.js";
import {
  createNote,
  deleteNote,
  getNote,
  getNoteVersion,
  listNoteVersions,
  listNotes,
  updateNote,
} from "../services/note.js";

export const noteRoutes = new Hono();

noteRoutes.use("*", authMiddleware);

noteRoutes.get("/", requireScope("read"), async (c) => {
  const auth = c.get("auth");
  const wsSlug = c.req.param("ws")!;
  const projectSlug = c.req.param("p")!;
  const { db } = getDb();
  const ws = await getWorkspaceBySlug(db, wsSlug);
  if (!ws) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Workspace '${wsSlug}' not found`);
  }
  assertWorkspaceAccess(auth, ws.id);
  const notes = await listNotes(db, wsSlug, projectSlug);
  return c.json({ data: notes });
});

noteRoutes.post("/", requireScope("write:notes", "admin"), async (c) => {
  const auth = c.get("auth");
  const wsSlug = c.req.param("ws")!;
  const projectSlug = c.req.param("p")!;
  const body = await c.req.json<{
    title: string;
    slug?: string;
    body?: string;
    frontmatter?: Record<string, unknown>;
  }>();
  const { db } = getDb();
  const ws = await getWorkspaceBySlug(db, wsSlug);
  if (!ws) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Workspace '${wsSlug}' not found`);
  }
  assertWorkspaceAccess(auth, ws.id);
  const note = await createNote(db, wsSlug, projectSlug, auth, body);
  return c.json(note, 201);
});

noteRoutes.get("/:id", requireScope("read"), async (c) => {
  const auth = c.get("auth");
  const wsSlug = c.req.param("ws")!;
  const projectSlug = c.req.param("p")!;
  const noteId = c.req.param("id")!;
  const { db } = getDb();
  const ws = await getWorkspaceBySlug(db, wsSlug);
  if (!ws) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Workspace '${wsSlug}' not found`);
  }
  assertWorkspaceAccess(auth, ws.id);
  const note = await getNote(db, wsSlug, projectSlug, noteId);
  const { formatNote } = await import("../services/note.js");
  const formatted = formatNote(note);
  return c.json(formatted, 200, { ETag: noteEtag(note.version) });
});

noteRoutes.patch("/:id", requireScope("write:notes", "admin"), async (c) => {
  const auth = c.get("auth");
  const wsSlug = c.req.param("ws")!;
  const projectSlug = c.req.param("p")!;
  const noteId = c.req.param("id")!;
  const body = await c.req.json<{
    title?: string;
    body?: string;
    frontmatter?: Record<string, unknown>;
  }>();
  const ifMatch = parseIfMatch(c.req.header("If-Match"));
  const { db } = getDb();
  const ws = await getWorkspaceBySlug(db, wsSlug);
  if (!ws) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Workspace '${wsSlug}' not found`);
  }
  assertWorkspaceAccess(auth, ws.id);
  const note = await updateNote(
    db,
    wsSlug,
    projectSlug,
    noteId,
    auth,
    body,
    ifMatch,
  );
  return c.json(note, 200, { ETag: noteEtag(note.version) });
});

noteRoutes.delete("/:id", requireScope("write:notes", "admin"), async (c) => {
  const auth = c.get("auth");
  const wsSlug = c.req.param("ws")!;
  const projectSlug = c.req.param("p")!;
  const noteId = c.req.param("id")!;
  const { db } = getDb();
  const ws = await getWorkspaceBySlug(db, wsSlug);
  if (!ws) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Workspace '${wsSlug}' not found`);
  }
  assertWorkspaceAccess(auth, ws.id);
  await deleteNote(db, wsSlug, projectSlug, noteId, auth);
  return c.body(null, 204);
});

noteRoutes.get("/:id/versions", requireScope("read"), async (c) => {
  const auth = c.get("auth");
  const wsSlug = c.req.param("ws")!;
  const projectSlug = c.req.param("p")!;
  const noteId = c.req.param("id")!;
  const { db } = getDb();
  const ws = await getWorkspaceBySlug(db, wsSlug);
  if (!ws) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Workspace '${wsSlug}' not found`);
  }
  assertWorkspaceAccess(auth, ws.id);
  const versions = await listNoteVersions(db, wsSlug, projectSlug, noteId);
  return c.json({ data: versions });
});

noteRoutes.get("/:id/versions/:version", requireScope("read"), async (c) => {
  const auth = c.get("auth");
  const wsSlug = c.req.param("ws")!;
  const projectSlug = c.req.param("p")!;
  const noteId = c.req.param("id")!;
  const version = Number.parseInt(c.req.param("version")!, 10);
  const { db } = getDb();
  const ws = await getWorkspaceBySlug(db, wsSlug);
  if (!ws) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Workspace '${wsSlug}' not found`);
  }
  assertWorkspaceAccess(auth, ws.id);
  const v = await getNoteVersion(db, wsSlug, projectSlug, noteId, version);
  return c.json(v);
});
