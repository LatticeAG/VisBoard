import { Hono } from "hono";
import { authMiddleware, requireScope } from "../auth/middleware.js";
import { getDb } from "../db.js";
import { assertWorkspaceAccess } from "../lib/helpers.js";
import { getWorkspaceBySlug } from "../services/workspace.js";
import {
  appendProjectEvent,
  listProjectEvents,
} from "../services/event.js";

export const eventRoutes = new Hono();

eventRoutes.use("*", authMiddleware);

eventRoutes.post("/", requireScope("write:events", "admin"), async (c) => {
  const auth = c.get("auth");
  const wsSlug = c.req.param("ws")!;
  const projectSlug = c.req.param("p")!;
  const body = await c.req.json<{
    type: string;
    resource_type?: string;
    resource_id?: string;
    payload?: Record<string, unknown>;
  }>();
  const { db } = getDb();
  const ws = await getWorkspaceBySlug(db, wsSlug);
  if (!ws) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Workspace '${wsSlug}' not found`);
  }
  assertWorkspaceAccess(auth, ws.id);
  const event = await appendProjectEvent(db, wsSlug, projectSlug, auth, body);
  return c.json(event, 201);
});

eventRoutes.get("/", requireScope("read"), async (c) => {
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
  const result = await listProjectEvents(db, wsSlug, projectSlug, {
    since: c.req.query("since"),
    types: c.req.query("types"),
    limit: c.req.query("limit"),
    cursor: c.req.query("cursor"),
  });
  return c.json(result);
});
