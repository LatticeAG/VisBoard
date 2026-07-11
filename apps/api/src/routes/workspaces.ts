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
import {
  importWorkspaceData,
  parseImportPayload,
} from "../services/import.js";

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

workspaceRoutes.post("/import", requireScope("admin"), async (c) => {
  const auth = c.get("auth");
  if (auth.type !== "user") {
    const { forbidden } = await import("../lib/errors.js");
    throw forbidden("Only users can import workspaces");
  }

  const form = await c.req.parseBody();
  const file = form.file;
  if (!file || typeof file === "string") {
    const { badRequest } = await import("../lib/errors.js");
    throw badRequest("Missing file field");
  }

  const slug = typeof form.slug === "string" ? form.slug : undefined;
  const name = typeof form.name === "string" ? form.name : undefined;
  if (!slug || !name) {
    const { badRequest } = await import("../lib/errors.js");
    throw badRequest("slug and name are required");
  }

  const data = new Uint8Array(await file.arrayBuffer());
  const { db } = getDb();
  const workspace = await createWorkspace(db, auth.id, { name, slug });
  const parsed = await parseImportPayload("application/zip", data.buffer, {
    name: file.name,
    data: data.buffer,
  });
  const summary = await importWorkspaceData(db, slug, auth, parsed);
  return c.json(
    {
      workspace,
      projects_imported: summary.projects,
      notes_imported: summary.notes,
      checklists_imported: summary.checklists,
      files_imported: summary.files,
    },
    201,
  );
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

workspaceRoutes.post("/:ws/import", requireScope("admin"), async (c) => {
  const auth = c.get("auth");
  const wsSlug = c.req.param("ws")!;
  const { db } = getDb();
  const ws = await getWorkspaceBySlug(db, wsSlug);
  if (!ws) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Workspace '${wsSlug}' not found`);
  }
  assertWorkspaceAccess(auth, ws.id);

  const contentType = c.req.header("content-type");
  let multipartFile: { name: string; data: ArrayBuffer } | undefined;

  if (contentType?.includes("multipart/form-data")) {
    const form = await c.req.parseBody();
    const file = form.file;
    if (!file || typeof file === "string") {
      const { badRequest } = await import("../lib/errors.js");
      throw badRequest("Missing file field in multipart upload");
    }
    multipartFile = {
      name: file.name,
      data: await file.arrayBuffer(),
    };
  }

  const body = multipartFile
    ? multipartFile.data
    : await c.req.arrayBuffer();

  const parsed = await parseImportPayload(contentType, body, multipartFile);
  const summary = await importWorkspaceData(db, wsSlug, auth, parsed);
  return c.json({
    projects_imported: summary.projects,
    notes_imported: summary.notes,
    checklists_imported: summary.checklists,
    files_imported: summary.files,
  });
});
