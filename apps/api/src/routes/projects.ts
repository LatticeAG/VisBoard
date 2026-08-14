import { createProjectSchema, updateProjectSchema } from "@visboard/shared";
import { Hono } from "hono";
import { authMiddleware, requireScope } from "../auth/middleware.js";
import { getDb } from "../db.js";
import { assertWorkspaceAccess, reqParam } from "../lib/helpers.js";
import { readJson } from "../lib/json.js";
import {
  archiveProject,
  createProject,
  getProjectBySlug,
  listProjects,
  updateProject,
} from "../services/project.js";
import { getWorkspaceBySlug } from "../services/workspace.js";

export const projectRoutes = new Hono();

projectRoutes.use("*", authMiddleware);

projectRoutes.get("/", requireScope("read"), async (c) => {
  const auth = c.get("auth");
  const wsSlug = reqParam(c, "ws");
  const { db } = getDb();
  const ws = await getWorkspaceBySlug(db, wsSlug);
  if (!ws) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Workspace '${wsSlug}' not found`);
  }
  assertWorkspaceAccess(auth, ws.id);
  const projects = await listProjects(db, wsSlug, auth);
  return c.json({ data: projects });
});

projectRoutes.post("/", requireScope("admin"), async (c) => {
  const auth = c.get("auth");
  const wsSlug = reqParam(c, "ws");
  const body = await readJson(c, createProjectSchema);
  const { db } = getDb();
  const ws = await getWorkspaceBySlug(db, wsSlug);
  if (!ws) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Workspace '${wsSlug}' not found`);
  }
  assertWorkspaceAccess(auth, ws.id);
  const project = await createProject(db, wsSlug, auth, body);
  return c.json(project, 201);
});

projectRoutes.get("/:p", requireScope("read"), async (c) => {
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
  const { formatProject } = await import("../services/project.js");
  return c.json(formatProject(project));
});

projectRoutes.patch("/:p", requireScope("admin"), async (c) => {
  const auth = c.get("auth");
  const wsSlug = reqParam(c, "ws");
  const projectSlug = reqParam(c, "p");
  const body = await readJson(c, updateProjectSchema);
  const { db } = getDb();
  const ws = await getWorkspaceBySlug(db, wsSlug);
  if (!ws) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Workspace '${wsSlug}' not found`);
  }
  assertWorkspaceAccess(auth, ws.id);
  const project = await updateProject(db, wsSlug, projectSlug, auth, body);
  return c.json(project);
});

projectRoutes.delete("/:p", requireScope("admin"), async (c) => {
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
  const project = await archiveProject(db, wsSlug, projectSlug, auth);
  return c.json(project);
});
