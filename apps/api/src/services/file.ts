import { files } from "@visboard/db";
import { EventType, PREFIX, createId } from "@visboard/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@visboard/db";
import type { AuthPrincipal } from "../auth/middleware.js";
import { actorFromAuth } from "../lib/helpers.js";
import { notFound, payloadTooLarge } from "../lib/errors.js";
import { getEnv } from "../env.js";
import {
  buildStoragePath,
  deleteStoredFile,
  readStoredFile,
  saveFile,
} from "../lib/storage.js";
import { getProjectBySlug } from "./project.js";
import { scheduleAgentsMdSync } from "./agents-md-sync.js";
import { createEvent } from "./event.js";

const BLOCKED_MIME_TYPES = new Set(["application/x-executable"]);

export async function listFiles(
  db: Database["db"],
  workspaceSlug: string,
  projectSlug: string,
) {
  const { project } = await getProjectBySlug(db, workspaceSlug, projectSlug);
  const rows = await db
    .select()
    .from(files)
    .where(and(eq(files.projectId, project.id), isNull(files.deletedAt)));

  return rows.map(formatFile);
}

export async function uploadFile(
  db: Database["db"],
  workspaceSlug: string,
  projectSlug: string,
  auth: AuthPrincipal,
  fileData: {
    name: string;
    mimeType: string;
    data: Uint8Array;
  },
) {
  const env = getEnv();
  if (fileData.data.length > env.VISBOARD_MAX_FILE_BYTES) {
    throw payloadTooLarge(
      `File exceeds maximum size of ${env.VISBOARD_MAX_FILE_BYTES} bytes`,
    );
  }
  if (BLOCKED_MIME_TYPES.has(fileData.mimeType)) {
    throw payloadTooLarge("Executable files are not allowed");
  }

  const { project } = await getProjectBySlug(db, workspaceSlug, projectSlug);
  const fileId = createId(PREFIX.file);
  const storagePath = buildStoragePath(project.id, fileId, fileData.name);
  const actor = actorFromAuth(auth);
  const now = new Date();

  await saveFile(storagePath, fileData.data);

  const [file] = await db
    .insert(files)
    .values({
      id: fileId,
      projectId: project.id,
      name: fileData.name,
      mimeType: fileData.mimeType,
      sizeBytes: fileData.data.length,
      storagePath,
      createdByType: actor.actorType,
      createdById: actor.actorId,
      createdAt: now,
    })
    .returning();

  await createEvent(db, project.id, auth, {
    type: EventType.FILE_UPLOADED,
    resource_type: "file",
    resource_id: fileId,
  });

  scheduleAgentsMdSync(project.id);

  return formatFile(file!);
}

export async function getFile(
  db: Database["db"],
  workspaceSlug: string,
  projectSlug: string,
  fileId: string,
) {
  const { project } = await getProjectBySlug(db, workspaceSlug, projectSlug);
  const [file] = await db
    .select()
    .from(files)
    .where(
      and(
        eq(files.projectId, project.id),
        eq(files.id, fileId),
        isNull(files.deletedAt),
      ),
    )
    .limit(1);

  if (!file) throw notFound(`File '${fileId}' not found`);
  return file;
}

export async function readFileContent(
  db: Database["db"],
  workspaceSlug: string,
  projectSlug: string,
  fileId: string,
) {
  const file = await getFile(db, workspaceSlug, projectSlug, fileId);
  const data = await readStoredFile(file.storagePath);
  return { file, data };
}

export async function deleteFile(
  db: Database["db"],
  workspaceSlug: string,
  projectSlug: string,
  fileId: string,
  auth: AuthPrincipal,
) {
  const file = await getFile(db, workspaceSlug, projectSlug, fileId);
  const now = new Date();

  await db
    .update(files)
    .set({ deletedAt: now })
    .where(eq(files.id, fileId));

  await deleteStoredFile(file.storagePath);

  await createEvent(db, file.projectId, auth, {
    type: EventType.FILE_DELETED,
    resource_type: "file",
    resource_id: fileId,
  });

  scheduleAgentsMdSync(file.projectId);
}

function formatFile(f: typeof files.$inferSelect) {
  return {
    id: f.id,
    project_id: f.projectId,
    name: f.name,
    mime_type: f.mimeType,
    size_bytes: f.sizeBytes,
    sha256: f.sha256,
    created_by_type: f.createdByType,
    created_by_id: f.createdById,
    created_at: f.createdAt.toISOString(),
  };
}
