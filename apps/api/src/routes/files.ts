import { Hono } from "hono";
import { authMiddleware, requireScope } from "../auth/middleware.js";
import { getDb } from "../db.js";
import { assertWorkspaceAccess, reqParam } from "../lib/helpers.js";
import { deleteFile, getFile, listFiles, readFileContent, uploadFile } from "../services/file.js";
import { getWorkspaceBySlug } from "../services/workspace.js";

export const fileRoutes = new Hono();

fileRoutes.use("*", authMiddleware);

fileRoutes.get("/", requireScope("read"), async (c) => {
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
  const files = await listFiles(db, wsSlug, projectSlug, auth);
  return c.json({ data: files });
});

fileRoutes.post("/", requireScope("write:files", "admin"), async (c) => {
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

  const form = await c.req.parseBody();
  const file = form.file;
  if (!file || typeof file === "string") {
    const { badRequest } = await import("../lib/errors.js");
    throw badRequest("Missing file field");
  }

  const data = new Uint8Array(await file.arrayBuffer());
  const result = await uploadFile(db, wsSlug, projectSlug, auth, {
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    data,
  });
  return c.json(result, 201);
});

fileRoutes.get("/:id", requireScope("read"), async (c) => {
  const auth = c.get("auth");
  const wsSlug = reqParam(c, "ws");
  const projectSlug = reqParam(c, "p");
  const fileId = reqParam(c, "id");
  const download = c.req.query("download");
  const { db } = getDb();
  const ws = await getWorkspaceBySlug(db, wsSlug);
  if (!ws) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Workspace '${wsSlug}' not found`);
  }
  assertWorkspaceAccess(auth, ws.id);

  if (download === "1") {
    const { file, data } = await readFileContent(db, wsSlug, projectSlug, fileId, auth);
    return new Response(data, {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": `attachment; filename="${file.name}"`,
      },
    });
  }

  const file = await getFile(db, wsSlug, projectSlug, fileId, auth);
  return c.json({
    id: file.id,
    project_id: file.projectId,
    name: file.name,
    mime_type: file.mimeType,
    size_bytes: file.sizeBytes,
    sha256: file.sha256,
    created_by_type: file.createdByType,
    created_by_id: file.createdById,
    created_at: file.createdAt.toISOString(),
  });
});

fileRoutes.delete("/:id", requireScope("write:files", "admin"), async (c) => {
  const auth = c.get("auth");
  const wsSlug = reqParam(c, "ws");
  const projectSlug = reqParam(c, "p");
  const fileId = reqParam(c, "id");
  const { db } = getDb();
  const ws = await getWorkspaceBySlug(db, wsSlug);
  if (!ws) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Workspace '${wsSlug}' not found`);
  }
  assertWorkspaceAccess(auth, ws.id);
  await deleteFile(db, wsSlug, projectSlug, fileId, auth);
  return c.body(null, 204);
});
