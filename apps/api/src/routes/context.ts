import { Hono } from "hono";
import { authMiddleware, requireScope } from "../auth/middleware.js";
import { getDb } from "../db.js";
import { assertWorkspaceAccess, reqParam } from "../lib/helpers.js";
import { getAgentsMd, getContext, syncAgentsMdWithDb } from "../services/agents-md-sync.js";
import { getProjectBySlug } from "../services/project.js";
import { getWorkspaceBySlug } from "../services/workspace.js";

export const contextRoutes = new Hono();

contextRoutes.use("*", authMiddleware);

contextRoutes.get("/agents.md", requireScope("read"), async (c) => {
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
  const markdown = await getAgentsMd(db, wsSlug, projectSlug);
  return c.text(markdown, 200, { "Content-Type": "text/markdown" });
});

contextRoutes.post("/agents.md/sync", requireScope("read", "admin"), async (c) => {
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
  const { project } = await getProjectBySlug(db, wsSlug, projectSlug, auth);
  const markdown = await syncAgentsMdWithDb(db, project.id);
  return c.text(markdown, 200, { "Content-Type": "text/markdown" });
});

contextRoutes.get("/context", requireScope("read"), async (c) => {
  const auth = c.get("auth");
  const wsSlug = reqParam(c, "ws");
  const projectSlug = reqParam(c, "p");
  const include = (c.req.query("include") ?? "headings") as "headings" | "bodies";
  const { db } = getDb();
  const ws = await getWorkspaceBySlug(db, wsSlug);
  if (!ws) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Workspace '${wsSlug}' not found`);
  }
  assertWorkspaceAccess(auth, ws.id);
  const context = await getContext(db, wsSlug, projectSlug, include);
  return c.json(context);
});
