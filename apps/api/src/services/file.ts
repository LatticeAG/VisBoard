import { createHash } from "node:crypto";
import { files } from "@visboard/db";
import type { Database } from "@visboard/db";
import { EventType, PREFIX, createId } from "@visboard/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { AuthPrincipal } from "../auth/middleware.js";
import { getEnv } from "../env.js";
import { badRequest, notFound, payloadTooLarge } from "../lib/errors.js";
import { actorFromAuth } from "../lib/helpers.js";
import { buildStoragePath, deleteStoredFile, readStoredFile, saveFile } from "../lib/storage.js";
import { scheduleAgentsMdSync } from "./agents-md-sync.js";
import { createEvent } from "./event.js";
import { getProjectBySlug } from "./project.js";

const BLOCKED_MIME_TYPES = new Set(["application/x-executable"]);

const MACHO_MAGICS = [
  [0xfe, 0xed, 0xfa, 0xce],
  [0xfe, 0xed, 0xfa, 0xcf],
  [0xce, 0xfa, 0xed, 0xfe],
  [0xcf, 0xfa, 0xed, 0xfe],
  [0xca, 0xfe, 0xba, 0xbe],
  [0xbe, 0xba, 0xfe, 0xca],
];

function bytesMatch(data: Uint8Array, magic: number[]): boolean {
  if (data.length < magic.length) return false;
  return magic.every((byte, index) => data[index] === byte);
}

function isBlockedExecutable(data: Uint8Array, mimeType: string): boolean {
  if (BLOCKED_MIME_TYPES.has(mimeType)) return true;
  if (bytesMatch(data, [0x7f, 0x45, 0x4c, 0x46])) return true;
  if (bytesMatch(data, [0x4d, 0x5a])) return true;
  return MACHO_MAGICS.some((magic) => bytesMatch(data, magic));
}

export async function listFiles(
  db: Database["db"],
  workspaceSlug: string,
  projectSlug: string,
  auth?: AuthPrincipal,
) {
  const { project } = await getProjectBySlug(db, workspaceSlug, projectSlug, auth);
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
  const sha256 = createHash("sha256").update(fileData.data).digest("hex");
  const env = getEnv();
  if (fileData.data.length > env.VISBOARD_MAX_FILE_BYTES) {
    throw payloadTooLarge(`File exceeds maximum size of ${env.VISBOARD_MAX_FILE_BYTES} bytes`);
  }
  if (isBlockedExecutable(fileData.data, fileData.mimeType)) {
    throw badRequest("Executable files are not allowed");
  }
  const { project } = await getProjectBySlug(db, workspaceSlug, projectSlug, auth);
  const fileId = createId(PREFIX.file);
  const storagePath = buildStoragePath(project.id, fileId, fileData.name);
  const actor = actorFromAuth(auth);
  const now = new Date();

  const [file] = await db
    .insert(files)
    .values({
      id: fileId,
      projectId: project.id,
      name: fileData.name,
      mimeType: fileData.mimeType,
      sizeBytes: fileData.data.length,
      storagePath,
      sha256,
      createdByType: actor.actorType,
      createdById: actor.actorId,
      createdAt: now,
    })
    .returning();
  if (!file) throw new Error("Failed to create file");

  try {
    await saveFile(storagePath, fileData.data);
  } catch (err) {
    await db.update(files).set({ deletedAt: new Date() }).where(eq(files.id, fileId));
    throw err;
  }

  await createEvent(db, project.id, auth, {
    type: EventType.FILE_UPLOADED,
    resource_type: "file",
    resource_id: fileId,
  });

  scheduleAgentsMdSync(project.id);

  return formatFile(file);
}

export async function getFile(
  db: Database["db"],
  workspaceSlug: string,
  projectSlug: string,
  fileId: string,
  auth?: AuthPrincipal,
) {
  const { project } = await getProjectBySlug(db, workspaceSlug, projectSlug, auth);
  const [file] = await db
    .select()
    .from(files)
    .where(and(eq(files.projectId, project.id), eq(files.id, fileId), isNull(files.deletedAt)))
    .limit(1);

  if (!file) throw notFound(`File '${fileId}' not found`);
  return file;
}

export async function readFileContent(
  db: Database["db"],
  workspaceSlug: string,
  projectSlug: string,
  fileId: string,
  auth?: AuthPrincipal,
) {
  const file = await getFile(db, workspaceSlug, projectSlug, fileId, auth);
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
  const file = await getFile(db, workspaceSlug, projectSlug, fileId, auth);
  const now = new Date();

  await db.update(files).set({ deletedAt: now }).where(eq(files.id, fileId));

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
