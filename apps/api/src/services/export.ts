import {
  checklistItems,
  checklists,
  files,
  notes,
  projects,
  workspaces,
  type Database,
} from "@visboard/db";
import { and, eq, isNull } from "drizzle-orm";
import JSZip from "jszip";
import matter from "gray-matter";
import { readStoredFile } from "../lib/storage.js";
import { formatNote } from "./note.js";
import { formatProject } from "./project.js";

interface ExportJob {
  id: string;
  workspaceId: string;
  status: "pending" | "ready" | "failed";
  data?: Uint8Array;
  createdAt: Date;
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
  const exportId = `exp_${Date.now()}`;
  const job: ExportJob = {
    id: exportId,
    workspaceId,
    status: "pending",
    createdAt: new Date(),
  };
  exportJobs.set(exportId, job);

  processExport(db, job).catch(() => {
    job.status = "failed";
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
    .where(
      and(eq(projects.workspaceId, job.workspaceId), isNull(projects.deletedAt)),
    );

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
        const md = matter.stringify(
          note.body,
          note.frontmatter as Record<string, unknown>,
        );
        zip.file(`notes/${project.slug}/${note.slug}.md`, md);
      }
    }

    const checklistRows = await db
      .select()
      .from(checklists)
      .where(
        and(eq(checklists.projectId, project.id), isNull(checklists.deletedAt)),
      );

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
  job.status = "ready";
}

export function getExport(
  workspaceId: string,
  exportId: string,
): ExportJob | null {
  const job = exportJobs.get(exportId);
  if (!job || job.workspaceId !== workspaceId) return null;
  return job;
}

export function clearExportsForTests(): void {
  exportJobs.clear();
}
