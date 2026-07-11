import { Hono } from "hono";
import { authMiddleware, requireScope } from "../auth/middleware.js";
import { getDb } from "../db.js";
import { assertWorkspaceAccess } from "../lib/helpers.js";
import { getWorkspaceBySlug } from "../services/workspace.js";
import {
  createAgent,
  listAgents,
  revokeAgent,
  updateAgent,
} from "../services/agent.js";

export const agentRoutes = new Hono();

agentRoutes.use("*", authMiddleware);

agentRoutes.get("/", requireScope("read", "admin"), async (c) => {
  const auth = c.get("auth");
  const wsSlug = c.req.param("ws")!;
  const projectSlug = c.req.query("project");
  const { db } = getDb();
  const ws = await getWorkspaceBySlug(db, wsSlug);
  if (!ws) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Workspace '${wsSlug}' not found`);
  }
  assertWorkspaceAccess(auth, ws.id);
  const agents = await listAgents(db, wsSlug, projectSlug);
  return c.json({ data: agents });
});

agentRoutes.post("/", requireScope("admin"), async (c) => {
  const auth = c.get("auth");
  const wsSlug = c.req.param("ws")!;
  const body = await c.req.json<{
    name: string;
    description?: string;
    scopes: string[];
    project_ids?: string[];
  }>();
  const { db } = getDb();
  const ws = await getWorkspaceBySlug(db, wsSlug);
  if (!ws) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Workspace '${wsSlug}' not found`);
  }
  assertWorkspaceAccess(auth, ws.id);
  const agent = await createAgent(db, wsSlug, auth, body);
  return c.json(agent, 201);
});

agentRoutes.patch("/:id", requireScope("admin"), async (c) => {
  const auth = c.get("auth");
  const wsSlug = c.req.param("ws")!;
  const agentId = c.req.param("id")!;
  const body = await c.req.json<{
    name?: string;
    description?: string;
    scopes?: string[];
    project_ids?: string[];
  }>();
  const { db } = getDb();
  const ws = await getWorkspaceBySlug(db, wsSlug);
  if (!ws) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Workspace '${wsSlug}' not found`);
  }
  assertWorkspaceAccess(auth, ws.id);
  const agent = await updateAgent(db, wsSlug, agentId, body);
  return c.json(agent);
});

agentRoutes.post("/:id/revoke", requireScope("admin"), async (c) => {
  const auth = c.get("auth");
  const wsSlug = c.req.param("ws")!;
  const agentId = c.req.param("id")!;
  const { db } = getDb();
  const ws = await getWorkspaceBySlug(db, wsSlug);
  if (!ws) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Workspace '${wsSlug}' not found`);
  }
  assertWorkspaceAccess(auth, ws.id);
  const agent = await revokeAgent(db, wsSlug, agentId, auth);
  return c.json(agent);
});
