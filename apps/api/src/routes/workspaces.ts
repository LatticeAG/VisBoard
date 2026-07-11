import { Hono } from "hono";
import { authMiddleware, requireScope } from "../auth/middleware.js";
import { getDb } from "../db.js";
import { assertWorkspaceAccess } from "../lib/helpers.js";
import {
  createWorkspace,
  getWorkspaceBySlug,
  listWorkspaces,
  updateWorkspace,
} from "../services/workspace.js";
import { startExport, getExport } from "../services/export.js";

export const workspaceRoutes = new Hono();

workspaceRoutes.use("*", authMiddleware);

workspaceRoutes.get("/", async (c) => {
  const auth = c.get("auth");
  const { db } = getDb();
  const workspaces = await listWorkspaces(db, auth.workspaceIds);
  return c.json({ data: workspaces });
});

workspaceRoutes.post("/", requireScope("admin"), async (c) => {
  const auth = c.get("auth");
  if (auth.type !== "user") {
    const { forbidden } = await import("../lib/errors.js");
    throw forbidden("Only users can create workspaces");
  }
  const body = await c.req.json<{ name: string; slug?: string }>();
  const { db } = getDb();
  const workspace = await createWorkspace(db, auth.id, body);
  return c.json(workspace, 201);
});

workspaceRoutes.get("/:ws", async (c) => {
  const auth = c.get("auth");
  const wsSlug = c.req.param("ws")!;
  const { db } = getDb();
  const ws = await getWorkspaceBySlug(db, wsSlug);
  if (!ws) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Workspace '${wsSlug}' not found`);
  }
  assertWorkspaceAccess(auth, ws.id);
  return c.json({
    id: ws.id,
    slug: ws.slug,
    name: ws.name,
    created_at: ws.createdAt.toISOString(),
    updated_at: ws.updatedAt.toISOString(),
  });
});

workspaceRoutes.patch("/:ws", requireScope("admin"), async (c) => {
  const auth = c.get("auth");
  const wsSlug = c.req.param("ws")!;
  const body = await c.req.json<{ name?: string }>();
  const { db } = getDb();
  const ws = await getWorkspaceBySlug(db, wsSlug);
  if (!ws) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Workspace '${wsSlug}' not found`);
  }
  assertWorkspaceAccess(auth, ws.id);
  const updated = await updateWorkspace(db, ws.id, body);
  return c.json(updated);
});

workspaceRoutes.post("/:ws/export", requireScope("admin"), async (c) => {
  const auth = c.get("auth");
  const wsSlug = c.req.param("ws")!;
  const { db } = getDb();
  const ws = await getWorkspaceBySlug(db, wsSlug);
  if (!ws) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Workspace '${wsSlug}' not found`);
  }
  assertWorkspaceAccess(auth, ws.id);
  const result = await startExport(db, ws.id);
  return c.json(result, 202);
});

workspaceRoutes.get("/:ws/exports/:id", requireScope("admin"), async (c) => {
  const auth = c.get("auth");
  const wsSlug = c.req.param("ws")!;
  const exportId = c.req.param("id")!;
  const { db } = getDb();
  const ws = await getWorkspaceBySlug(db, wsSlug);
  if (!ws) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Workspace '${wsSlug}' not found`);
  }
  assertWorkspaceAccess(auth, ws.id);

  const job = getExport(ws.id, exportId);
  if (!job) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Export '${exportId}' not found`);
  }

  if (job.status === "pending") {
    return c.json({ export_id: exportId, status: "pending" }, 202);
  }
  if (job.status === "failed" || !job.data) {
    const { ApiError } = await import("../lib/errors.js");
    throw new ApiError(500, "Export Failed", "Export generation failed");
  }

  return new Response(job.data, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${ws.slug}-export.zip"`,
    },
  });
});
