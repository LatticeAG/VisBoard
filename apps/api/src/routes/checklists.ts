import {
  createChecklistItemSchema,
  createChecklistSchema,
  updateChecklistItemSchema,
  updateChecklistSchema,
} from "@visboard/shared";
import { Hono } from "hono";
import { authMiddleware, requireScope } from "../auth/middleware.js";
import { getDb } from "../db.js";
import { assertWorkspaceAccess, reqParam } from "../lib/helpers.js";
import { readJson } from "../lib/json.js";
import {
  addChecklistItem,
  createChecklist,
  deleteChecklist,
  getChecklist,
  listChecklists,
  updateChecklist,
  updateChecklistItem,
} from "../services/checklist.js";
import { getWorkspaceBySlug } from "../services/workspace.js";

export const checklistRoutes = new Hono();

checklistRoutes.use("*", authMiddleware);

checklistRoutes.get("/", requireScope("read"), async (c) => {
  const auth = c.get("auth");
  const wsSlug = reqParam(c, "ws");
  const projectSlug = reqParam(c, "p");
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
  const wsSlug = reqParam(c, "ws");
  const projectSlug = reqParam(c, "p");
  const body = await readJson(c, createChecklistSchema);
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
  const wsSlug = reqParam(c, "ws");
  const projectSlug = reqParam(c, "p");
  const checklistId = reqParam(c, "id");
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
  const wsSlug = reqParam(c, "ws");
  const projectSlug = reqParam(c, "p");
  const checklistId = reqParam(c, "id");
  const body = await readJson(c, updateChecklistSchema);
  const { db } = getDb();
  const ws = await getWorkspaceBySlug(db, wsSlug);
  if (!ws) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Workspace '${wsSlug}' not found`);
  }
  assertWorkspaceAccess(auth, ws.id);
  const checklist = await updateChecklist(db, wsSlug, projectSlug, checklistId, auth, body);
  return c.json(checklist);
});

checklistRoutes.delete("/:id", requireScope("write:checklists", "admin"), async (c) => {
  const auth = c.get("auth");
  const wsSlug = reqParam(c, "ws");
  const projectSlug = reqParam(c, "p");
  const checklistId = reqParam(c, "id");
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
  const wsSlug = reqParam(c, "ws");
  const projectSlug = reqParam(c, "p");
  const checklistId = reqParam(c, "id");
  const body = await readJson(c, createChecklistItemSchema);
  const { db } = getDb();
  const ws = await getWorkspaceBySlug(db, wsSlug);
  if (!ws) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Workspace '${wsSlug}' not found`);
  }
  assertWorkspaceAccess(auth, ws.id);
  const checklist = await addChecklistItem(db, wsSlug, projectSlug, checklistId, auth, body);
  return c.json(checklist, 201);
});

checklistRoutes.patch("/:id/items/:item", requireScope("write:checklists", "admin"), async (c) => {
  const auth = c.get("auth");
  const wsSlug = reqParam(c, "ws");
  const projectSlug = reqParam(c, "p");
  const checklistId = reqParam(c, "id");
  const itemId = reqParam(c, "item");
  const body = await readJson(c, updateChecklistItemSchema);
  const { db } = getDb();
  const ws = await getWorkspaceBySlug(db, wsSlug);
  if (!ws) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Workspace '${wsSlug}' not found`);
  }
  assertWorkspaceAccess(auth, ws.id);
  const checklist = await updateChecklistItem(db, wsSlug, projectSlug, checklistId, itemId, auth, {
    text: body.text,
    done: body.done,
    assignee_type: body.assignee_type ?? undefined,
    assignee_id: body.assignee_id ?? undefined,
    due_at: body.due_at ?? undefined,
    blocked_by: body.blocked_by,
  });
  return c.json(checklist);
});
