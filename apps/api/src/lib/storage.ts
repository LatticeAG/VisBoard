import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getEnv } from "../env.js";

export function sanitizeFilename(name: string): string {
  const base = name.replace(/[/\\]/g, "_").replace(/\.\./g, "_");
  return base.replace(/[^\w.\-]/g, "_").slice(0, 255) || "file";
}

export function buildStoragePath(projectId: string, fileId: string, filename: string): string {
  const safe = sanitizeFilename(filename);
  return join(projectId, fileId, safe);
}

export async function saveFile(storagePath: string, data: Uint8Array): Promise<void> {
  const env = getEnv();
  const fullPath = join(env.VISBOARD_DATA_DIR, storagePath);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, data);
}

export async function readStoredFile(storagePath: string): Promise<Uint8Array> {
  const env = getEnv();
  const fullPath = join(env.VISBOARD_DATA_DIR, storagePath);
  return readFile(fullPath);
}

export async function deleteStoredFile(storagePath: string): Promise<void> {
  const env = getEnv();
  const fullPath = join(env.VISBOARD_DATA_DIR, storagePath);
  try {
    await unlink(fullPath);
  } catch {
    // ignore missing files
  }
}
