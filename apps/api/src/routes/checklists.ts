import { Hono } from "hono";
import { authMiddleware, requireScope } from "../auth/middleware.js";
import { getDb } from "../db.js";
import { assertWorkspaceAccess } from "../lib/helpers.js";
import { getWorkspaceBySlug } from "../services/workspace.js";
import {
  addChecklistItem,
  createChecklist,
  deleteChecklist,
  getChecklist,
  listChecklists,
  updateChecklist,
  updateChecklistItem,
} from "../services/checklist.js";

export const checklistRoutes = new Hono();

checklistRoutes.use("*", authMiddleware);

checklistRoutes.get("/", requireScope("read"), async (c) => {
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
  const checklists = await listChecklists(db, wsSlug, projectSlug, auth);
  return c.json({ data: checklists });
});

checklistRoutes.post("/", requireScope("write:checklists", "admin"), async (c) => {
  const auth = c.get("auth");
  const wsSlug = c.req.param("ws")!;
  const projectSlug = c.req.param("p")!;
  const body = await c.req.json<{ title: string; source_note_id?: string }>();
  const { db } = getDb();
  const ws = await getWorkspaceBySlug(db, wsSlug);
  if (!ws) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Workspace '${wsSlug}' not found`);
  }
  assertWorkspaceAccess(auth, ws.id);
  const checklist = await createChecklist(db, wsSlug, projectSlug, auth, body);
  return c.json(checklist, 201);
});

checklistRoutes.get("/:id", requireScope("read"), async (c) => {
  const auth = c.get("auth");
  const wsSlug = c.req.param("ws")!;
  const projectSlug = c.req.param("p")!;
  const checklistId = c.req.param("id")!;
  const { db } = getDb();
  const ws = await getWorkspaceBySlug(db, wsSlug);
  if (!ws) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Workspace '${wsSlug}' not found`);
  }
  assertWorkspaceAccess(auth, ws.id);
  await getChecklist(db, wsSlug, projectSlug, checklistId, auth);
  const all = await listChecklists(db, wsSlug, projectSlug, auth);
  const found = all.find((ch) => ch.id === checklistId);
  if (!found) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Checklist '${checklistId}' not found`);
  }
  return c.json(found);
});

checklistRoutes.patch("/:id", requireScope("write:checklists", "admin"), async (c) => {
  const auth = c.get("auth");
  const wsSlug = c.req.param("ws")!;
  const projectSlug = c.req.param("p")!;
  const checklistId = c.req.param("id")!;
  const body = await c.req.json<{ title?: string }>();
  const { db } = getDb();
  const ws = await getWorkspaceBySlug(db, wsSlug);
  if (!ws) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Workspace '${wsSlug}' not found`);
  }
  assertWorkspaceAccess(auth, ws.id);
  const checklist = await updateChecklist(
    db,
    wsSlug,
    projectSlug,
    checklistId,
    auth,
    body,
  );
  return c.json(checklist);
});

checklistRoutes.delete("/:id", requireScope("write:checklists", "admin"), async (c) => {
  const auth = c.get("auth");
  const wsSlug = c.req.param("ws")!;
  const projectSlug = c.req.param("p")!;
  const checklistId = c.req.param("id")!;
  const { db } = getDb();
  const ws = await getWorkspaceBySlug(db, wsSlug);
  if (!ws) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Workspace '${wsSlug}' not found`);
  }
  assertWorkspaceAccess(auth, ws.id);
  await deleteChecklist(db, wsSlug, projectSlug, checklistId, auth);
  return c.body(null, 204);
});

checklistRoutes.post("/:id/items", requireScope("write:checklists", "admin"), async (c) => {
  const auth = c.get("auth");
  const wsSlug = c.req.param("ws")!;
  const projectSlug = c.req.param("p")!;
  const checklistId = c.req.param("id")!;
  const body = await c.req.json<{ text: string; sort_order?: number }>();
  const { db } = getDb();
  const ws = await getWorkspaceBySlug(db, wsSlug);
  if (!ws) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Workspace '${wsSlug}' not found`);
  }
  assertWorkspaceAccess(auth, ws.id);
  const checklist = await addChecklistItem(
    db,
    wsSlug,
    projectSlug,
    checklistId,
    auth,
    body,
  );
  return c.json(checklist, 201);
});

checklistRoutes.patch(
  "/:id/items/:item",
  requireScope("write:checklists", "admin"),
  async (c) => {
    const auth = c.get("auth");
    const wsSlug = c.req.param("ws")!;
    const projectSlug = c.req.param("p")!;
    const checklistId = c.req.param("id")!;
    const itemId = c.req.param("item")!;
    const body = await c.req.json<{
      text?: string;
      done?: boolean;
      assignee_type?: string;
      assignee_id?: string;
      due_at?: string;
      blocked_by?: string[];
    }>();
    const { db } = getDb();
    const ws = await getWorkspaceBySlug(db, wsSlug);
    if (!ws) {
      const { notFound } = await import("../lib/errors.js");
      throw notFound(`Workspace '${wsSlug}' not found`);
    }
    assertWorkspaceAccess(auth, ws.id);
    const checklist = await updateChecklistItem(
      db,
      wsSlug,
      projectSlug,
      checklistId,
      itemId,
      auth,
      body,
    );
    return c.json(checklist);
  },
);
