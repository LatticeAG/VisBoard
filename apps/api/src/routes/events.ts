import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { authMiddleware, requireScope } from "../auth/middleware.js";
import { getDb } from "../db.js";
import { assertWorkspaceAccess, reqParam } from "../lib/helpers.js";
import { readJson } from "../lib/json.js";
import {
  appendProjectEvent,
  listProjectEvents,
  pollProjectEvents,
  subscribeToProjectEvents,
} from "../services/event.js";
import { getProjectBySlug } from "../services/project.js";
import { getWorkspaceBySlug } from "../services/workspace.js";

export const eventRoutes = new Hono();

eventRoutes.use("*", authMiddleware);

eventRoutes.post("/", requireScope("write:events", "admin"), async (c) => {
  const auth = c.get("auth");
  const wsSlug = reqParam(c, "ws");
  const projectSlug = reqParam(c, "p");
  const body = await readJson(
    c,
    z.object({
      type: z.string().min(1),
      resource_type: z.string().optional(),
      resource_id: z.string().optional(),
      payload: z.record(z.unknown()).optional(),
    }),
  );
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
  const wsSlug = reqParam(c, "ws");
  const projectSlug = reqParam(c, "p");
  const { db } = getDb();
  const ws = await getWorkspaceBySlug(db, wsSlug);
  if (!ws) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Workspace '${wsSlug}' not found`);
  }
  assertWorkspaceAccess(auth, ws.id);
  const result = await listProjectEvents(
    db,
    wsSlug,
    projectSlug,
    {
      since: c.req.query("since"),
      types: c.req.query("types"),
      limit: c.req.query("limit"),
      cursor: c.req.query("cursor"),
    },
    auth,
  );
  return c.json(result);
});

eventRoutes.get("/stream", requireScope("read"), async (c) => {
  const auth = c.get("auth");
  const wsSlug = reqParam(c, "ws");
  const projectSlug = reqParam(c, "p");
  const since = c.req.query("since");
  const types = c.req.query("types");
  const { db } = getDb();
  const ws = await getWorkspaceBySlug(db, wsSlug);
  if (!ws) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Workspace '${wsSlug}' not found`);
  }
  assertWorkspaceAccess(auth, ws.id);
  const { project } = await getProjectBySlug(db, wsSlug, projectSlug, auth);

  const sentIds = new Set<string>();
  let lastSince = since;

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({
      event: "connected",
      data: JSON.stringify({ project_id: project.id }),
    });

    const sendEvents = async () => {
      const events = await pollProjectEvents(db, project.id, {
        since: lastSince,
        types,
      });
      for (const event of events) {
        if (sentIds.has(event.id)) continue;
        sentIds.add(event.id);
        await stream.writeSSE({
          event: "event",
          data: JSON.stringify(event),
          id: event.id,
        });
        lastSince = event.id;
      }
    };

    await sendEvents();

    const unsubscribe = subscribeToProjectEvents(project.id, (event) => {
      if (sentIds.has(event.id)) return;
      if (types) {
        const allowed = types.split(",").map((t) => t.trim());
        if (!allowed.includes(event.type)) return;
      }
      sentIds.add(event.id);
      void stream.writeSSE({
        event: "event",
        data: JSON.stringify(event),
        id: event.id,
      });
      lastSince = event.id;
    });

    const interval = setInterval(() => {
      void sendEvents();
    }, 1000);

    stream.onAbort(() => {
      clearInterval(interval);
      unsubscribe();
    });

    await new Promise(() => {});
  });
});
