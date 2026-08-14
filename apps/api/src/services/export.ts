import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type Database,
  checklistItems,
  checklists,
  exportJobs as exportJobsTable,
  files,
  notes,
  projects,
  workspaces,
} from "@visboard/db";
import { PREFIX, createId } from "@visboard/shared";
import { and, eq, isNull, lt } from "drizzle-orm";
import matter from "gray-matter";
import JSZip from "jszip";
import { getEnv } from "../env.js";
import { readStoredFile } from "../lib/storage.js";
import { formatNote } from "./note.js";
import { formatProject } from "./project.js";

interface ExportJob {
  id: string;
  workspaceId: string;
  status: "pending" | "ready" | "failed";
  data?: Uint8Array;
  createdAt: Date;
  storagePath?: string | null;
}

const exportJobs = new Map<string, ExportJob>();

export type ExportManifest = {
  version: number;
  workspace: {
    id: string;
    slug: string;
    name: string;
    created_at: string;
    updated_at: string;
  };
  projects: ReturnType<typeof formatProject>[];
  notes: ReturnType<typeof formatNote>[];
  checklists: Array<{
    id: string;
    project_id: string;
    project_slug: string;
    title: string;
    source_note_id: string | null;
    items: Array<{
      id: string;
      text: string;
      done: boolean;
      sort_order: number;
      assignee_type: string | null;
      assignee_id: string | null;
      due_at: string | null;
      blocked_by: string[];
    }>;
    created_at: string;
    updated_at: string;
  }>;
  files: Array<{
    id: string;
    project_id: string;
    project_slug: string;
    name: string;
    mime_type: string;
    size_bytes: number;
    sha256: string | null;
    storage_path: string;
    created_at: string;
  }>;
  exported_at: string;
};

export async function startExport(
  db: Database["db"],
  workspaceId: string,
): Promise<{ export_id: string; status: "pending" }> {
  await expireOldExports(db);
  const exportId = createId(PREFIX.exportJob);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const storagePath = `exports/${exportId}.zip`;
  const job: ExportJob = {
    id: exportId,
    workspaceId,
    status: "pending",
    createdAt: new Date(),
    storagePath,
  };
  exportJobs.set(exportId, job);
  try {
    await db.insert(exportJobsTable).values({
      id: exportId,
      workspaceId,
      status: "pending",
      storagePath,
      createdAt: job.createdAt,
      expiresAt,
    });
  } catch {
    // Mock databases used in unit tests do not host export_jobs.
  }

  processExport(db, job).catch(async () => {
    job.status = "failed";
    try {
      await db
        .update(exportJobsTable)
        .set({ status: "failed", error: "Export generation failed" })
        .where(eq(exportJobsTable.id, job.id));
    } catch {
      // mock db
    }
  });

  return { export_id: exportId, status: "pending" };
}

async function processExport(db: Database["db"], job: ExportJob) {
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, job.workspaceId))
    .limit(1);

  if (!workspace) {
    job.status = "failed";
    return;
  }

  const projectRows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.workspaceId, job.workspaceId), isNull(projects.deletedAt)));

  const allNotes: ReturnType<typeof formatNote>[] = [];
  const allChecklists: ExportManifest["checklists"] = [];
  const allFiles: ExportManifest["files"] = [];

  const zip = new JSZip();

  for (const project of projectRows) {
    const noteRows = await db
      .select()
      .from(notes)
      .where(and(eq(notes.projectId, project.id), isNull(notes.deletedAt)));

    for (const note of noteRows) {
      const formatted = formatNote(note);
      allNotes.push(formatted);

      if (!note.isSystem) {
        const md = matter.stringify(note.body, note.frontmatter as Record<string, unknown>);
        zip.file(`notes/${project.slug}/${note.slug}.md`, md);
      }
    }

    const checklistRows = await db
      .select()
      .from(checklists)
      .where(and(eq(checklists.projectId, project.id), isNull(checklists.deletedAt)));

    for (const chk of checklistRows) {
      const items = await db
        .select()
        .from(checklistItems)
        .where(eq(checklistItems.checklistId, chk.id));

      allChecklists.push({
        id: chk.id,
        project_id: chk.projectId,
        project_slug: project.slug,
        title: chk.title,
        source_note_id: chk.sourceNoteId,
        items: items
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((item) => ({
            id: item.id,
            text: item.text,
            done: item.done,
            sort_order: item.sortOrder,
            assignee_type: item.assigneeType,
            assignee_id: item.assigneeId,
            due_at: item.dueAt?.toISOString() ?? null,
            blocked_by: item.blockedBy,
          })),
        created_at: chk.createdAt.toISOString(),
        updated_at: chk.updatedAt.toISOString(),
      });
    }

    const fileRows = await db
      .select()
      .from(files)
      .where(and(eq(files.projectId, project.id), isNull(files.deletedAt)));

    for (const file of fileRows) {
      allFiles.push({
        id: file.id,
        project_id: file.projectId,
        project_slug: project.slug,
        name: file.name,
        mime_type: file.mimeType,
        size_bytes: file.sizeBytes,
        sha256: file.sha256,
        storage_path: file.storagePath,
        created_at: file.createdAt.toISOString(),
      });

      try {
        const data = await readStoredFile(file.storagePath);
        zip.file(`files/${project.slug}/${file.id}/${file.name}`, data);
      } catch {
        // skip missing files on disk
      }
    }
  }

  const manifest: ExportManifest = {
    version: 1,
    workspace: {
      id: workspace.id,
      slug: workspace.slug,
      name: workspace.name,
      created_at: workspace.createdAt.toISOString(),
      updated_at: workspace.updatedAt.toISOString(),
    },
    projects: projectRows.map(formatProject),
    notes: allNotes,
    checklists: allChecklists,
    files: allFiles,
    exported_at: new Date().toISOString(),
  };

  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  job.data = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
  });
  const env = getEnv();
  const fullPath = join(env.VISBOARD_DATA_DIR, job.storagePath ?? `exports/${job.id}.zip`);
  await mkdir(join(env.VISBOARD_DATA_DIR, "exports"), { recursive: true });
  await writeFile(fullPath, job.data);
  job.status = "ready";
  try {
    await db
      .update(exportJobsTable)
      .set({ status: "ready", storagePath: job.storagePath ?? `exports/${job.id}.zip` })
      .where(eq(exportJobsTable.id, job.id));
  } catch {
    // mock db
  }
}

export async function getExport(
  db: Database["db"],
  workspaceId: string,
  exportId: string,
): Promise<ExportJob | null> {
  const cached = exportJobs.get(exportId);
  if (cached && cached.workspaceId === workspaceId) {
    if (cached.status === "ready" && !cached.data && cached.storagePath) {
      try {
        cached.data = await readFile(join(getEnv().VISBOARD_DATA_DIR, cached.storagePath));
      } catch {
        cached.status = "failed";
      }
    }
    return cached;
  }
  try {
    const [row] = await db
      .select()
      .from(exportJobsTable)
      .where(eq(exportJobsTable.id, exportId))
      .limit(1);
    if (!row || row.workspaceId !== workspaceId) return null;
    const job: ExportJob = {
      id: row.id,
      workspaceId: row.workspaceId,
      status: row.status as ExportJob["status"],
      createdAt: row.createdAt,
      storagePath: row.storagePath,
    };
    if (job.status === "ready" && job.storagePath) {
      try {
        job.data = await readFile(join(getEnv().VISBOARD_DATA_DIR, job.storagePath));
      } catch {
        job.status = "failed";
      }
    }
    exportJobs.set(job.id, job);
    return job;
  } catch {
    return null;
  }
}

async function expireOldExports(db: Database["db"]): Promise<void> {
  try {
    const expired = await db
      .select()
      .from(exportJobsTable)
      .where(lt(exportJobsTable.expiresAt, new Date()));
    for (const row of expired) {
      if (row.storagePath) {
        try {
          await unlink(join(getEnv().VISBOARD_DATA_DIR, row.storagePath));
        } catch {
          // ignore
        }
      }
    }
    await db.delete(exportJobsTable).where(lt(exportJobsTable.expiresAt, new Date()));
  } catch {
    // mock db
  }
}

export function clearExportsForTests(): void {
  exportJobs.clear();
}
