import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware, requireScope } from "../auth/middleware.js";
import { getDb } from "../db.js";
import { assertWorkspaceAccess, reqParam } from "../lib/helpers.js";
import { readJson } from "../lib/json.js";
import { createAgent, listAgents, revokeAgent, updateAgent } from "../services/agent.js";
import { getWorkspaceBySlug } from "../services/workspace.js";

export const agentRoutes = new Hono();

agentRoutes.use("*", authMiddleware);

agentRoutes.get("/", requireScope("read", "admin"), async (c) => {
  const auth = c.get("auth");
  const wsSlug = reqParam(c, "ws");
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
  const wsSlug = reqParam(c, "ws");
  const body = await readJson(
    c,
    z.object({
      name: z.string().min(1).max(256),
      description: z.string().optional(),
      scopes: z.array(z.string()).min(1),
      project_ids: z.array(z.string()).optional(),
    }),
  );
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
  const wsSlug = reqParam(c, "ws");
  const agentId = reqParam(c, "id");
  const body = await readJson(
    c,
    z.object({
      name: z.string().min(1).max(256).optional(),
      description: z.string().optional(),
      scopes: z.array(z.string()).min(1).optional(),
      project_ids: z.array(z.string()).optional(),
    }),
  );
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
  const wsSlug = reqParam(c, "ws");
  const agentId = reqParam(c, "id");
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
