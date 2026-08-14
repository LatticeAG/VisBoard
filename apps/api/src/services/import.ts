import { checklistItems, checklists, files, noteVersions, notes, projects } from "@visboard/db";
import type { Database } from "@visboard/db";
import { PREFIX, createId, slugify } from "@visboard/shared";
import { and, eq, isNull } from "drizzle-orm";
import matter from "gray-matter";
import JSZip from "jszip";
import type { AuthPrincipal } from "../auth/middleware.js";
import { badRequest } from "../lib/errors.js";
import { actorFromAuth } from "../lib/helpers.js";
import { buildStoragePath, saveFile } from "../lib/storage.js";
import { scheduleAgentsMdSync } from "./agents-md-sync.js";
import type { ExportManifest } from "./export.js";
import { getWorkspaceBySlug } from "./workspace.js";

export type ImportSummary = {
  projects: number;
  notes: number;
  checklists: number;
  files: number;
};

export async function importWorkspaceData(
  db: Database["db"],
  workspaceSlug: string,
  auth: AuthPrincipal,
  input: { manifest: ExportManifest; fileContents?: Map<string, Uint8Array> },
): Promise<ImportSummary> {
  const ws = await getWorkspaceBySlug(db, workspaceSlug);
  if (!ws) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Workspace '${workspaceSlug}' not found`);
  }

  const { manifest, fileContents = new Map() } = input;
  const actor = actorFromAuth(auth);
  const now = new Date();
  const summary: ImportSummary = {
    projects: 0,
    notes: 0,
    checklists: 0,
    files: 0,
  };

  const projectIdBySlug = new Map<string, string>();
  const projectIdByExportId = new Map<string, string>();

  const existingProjects = await db
    .select()
    .from(projects)
    .where(and(eq(projects.workspaceId, ws.id), isNull(projects.deletedAt)));

  for (const p of existingProjects) {
    projectIdBySlug.set(p.slug, p.id);
  }

  for (const projectData of manifest.projects) {
    let projectId = projectIdBySlug.get(projectData.slug);
    if (!projectId) {
      projectId = createId(PREFIX.project);
      await db.insert(projects).values({
        id: projectId,
        workspaceId: ws.id,
        slug: projectData.slug,
        name: projectData.name,
        description: projectData.description ?? "",
        status: projectData.status ?? "draft",
        createdAt: now,
        updatedAt: now,
      });
      projectIdBySlug.set(projectData.slug, projectId);
      summary.projects += 1;
    } else {
      await db
        .update(projects)
        .set({
          name: projectData.name,
          description: projectData.description ?? "",
          status: projectData.status ?? "draft",
          updatedAt: now,
        })
        .where(eq(projects.id, projectId));
    }
    projectIdByExportId.set(projectData.id, projectId);
  }

  for (const noteData of manifest.notes) {
    if (noteData.is_system) continue;

    const projectSlug = manifest.projects.find(
      (p: ExportManifest["projects"][number]) => p.id === noteData.project_id,
    )?.slug;
    const projectId =
      (projectSlug ? projectIdBySlug.get(projectSlug) : undefined) ??
      projectIdByExportId.get(noteData.project_id);
    if (!projectId) continue;

    const [existing] = await db
      .select()
      .from(notes)
      .where(
        and(eq(notes.projectId, projectId), eq(notes.slug, noteData.slug), isNull(notes.deletedAt)),
      )
      .limit(1);

    if (existing) {
      await db
        .update(notes)
        .set({
          title: noteData.title,
          body: noteData.body,
          frontmatter: noteData.frontmatter,
          version: existing.version + 1,
          updatedByType: actor.actorType,
          updatedById: actor.actorId,
          updatedAt: now,
        })
        .where(eq(notes.id, existing.id));
    } else {
      const noteId = createId(PREFIX.note);
      await db.insert(notes).values({
        id: noteId,
        projectId,
        slug: noteData.slug,
        title: noteData.title,
        body: noteData.body,
        frontmatter: noteData.frontmatter,
        version: noteData.version ?? 1,
        createdByType: actor.actorType,
        createdById: actor.actorId,
        updatedByType: actor.actorType,
        updatedById: actor.actorId,
        createdAt: now,
        updatedAt: now,
      });

      await db.insert(noteVersions).values({
        id: createId(PREFIX.noteVersion),
        noteId,
        version: noteData.version ?? 1,
        title: noteData.title,
        body: noteData.body,
        frontmatter: noteData.frontmatter,
        createdByType: actor.actorType,
        createdById: actor.actorId,
        createdAt: now,
      });
    }
    summary.notes += 1;
  }

  for (const chkData of manifest.checklists) {
    const projectId = projectIdBySlug.get(chkData.project_slug);
    if (!projectId) continue;

    let checklistId: string;
    const [existingChk] = await db
      .select()
      .from(checklists)
      .where(
        and(
          eq(checklists.projectId, projectId),
          eq(checklists.title, chkData.title),
          isNull(checklists.deletedAt),
        ),
      )
      .limit(1);

    if (existingChk) {
      checklistId = existingChk.id;
    } else {
      checklistId = createId(PREFIX.checklist);
      await db.insert(checklists).values({
        id: checklistId,
        projectId,
        title: chkData.title,
        sourceNoteId: chkData.source_note_id,
        createdAt: now,
        updatedAt: now,
      });
      summary.checklists += 1;
    }

    for (const item of chkData.items) {
      const [existingItem] = await db
        .select()
        .from(checklistItems)
        .where(and(eq(checklistItems.checklistId, checklistId), eq(checklistItems.text, item.text)))
        .limit(1);

      if (existingItem) {
        await db
          .update(checklistItems)
          .set({
            done: item.done,
            sortOrder: item.sort_order,
            assigneeType: item.assignee_type,
            assigneeId: item.assignee_id,
            dueAt: item.due_at ? new Date(item.due_at) : null,
            blockedBy: item.blocked_by,
            updatedAt: now,
          })
          .where(eq(checklistItems.id, existingItem.id));
      } else {
        await db.insert(checklistItems).values({
          id: createId(PREFIX.item),
          checklistId,
          text: item.text,
          done: item.done,
          sortOrder: item.sort_order,
          assigneeType: item.assignee_type,
          assigneeId: item.assignee_id,
          dueAt: item.due_at ? new Date(item.due_at) : null,
          blockedBy: item.blocked_by,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  for (const fileData of manifest.files) {
    const projectId = projectIdBySlug.get(fileData.project_slug);
    if (!projectId) continue;

    const zipPath = `files/${fileData.project_slug}/${fileData.id}/${fileData.name}`;
    const content = fileContents.get(zipPath);
    if (!content) continue;

    const [existingFile] = await db
      .select()
      .from(files)
      .where(
        and(eq(files.projectId, projectId), eq(files.name, fileData.name), isNull(files.deletedAt)),
      )
      .limit(1);

    if (existingFile) {
      await saveFile(existingFile.storagePath, content);
      await db
        .update(files)
        .set({
          mimeType: fileData.mime_type,
          sizeBytes: content.length,
        })
        .where(eq(files.id, existingFile.id));
    } else {
      const fileId = createId(PREFIX.file);
      const storagePath = buildStoragePath(projectId, fileId, fileData.name);
      await saveFile(storagePath, content);
      await db.insert(files).values({
        id: fileId,
        projectId,
        name: fileData.name,
        mimeType: fileData.mime_type,
        sizeBytes: content.length,
        storagePath,
        sha256: fileData.sha256,
        createdByType: actor.actorType,
        createdById: actor.actorId,
        createdAt: now,
      });
      summary.files += 1;
    }
  }

  for (const projectId of projectIdBySlug.values()) {
    scheduleAgentsMdSync(projectId);
  }

  return summary;
}

export async function parseImportPayload(
  contentType: string | undefined,
  body: ArrayBuffer,
  multipartFile?: { name: string; data: ArrayBuffer },
): Promise<{ manifest: ExportManifest; fileContents: Map<string, Uint8Array> }> {
  const fileContents = new Map<string, Uint8Array>();

  if (multipartFile) {
    return parseZipBuffer(multipartFile.data, fileContents);
  }

  if (contentType?.includes("application/zip")) {
    return parseZipBuffer(body, fileContents);
  }

  const manifest = JSON.parse(new TextDecoder().decode(body)) as ExportManifest;
  return { manifest, fileContents };
}

async function parseZipBuffer(
  body: ArrayBuffer,
  fileContents: Map<string, Uint8Array>,
): Promise<{ manifest: ExportManifest; fileContents: Map<string, Uint8Array> }> {
  const zip = await JSZip.loadAsync(body);
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) {
    throw badRequest("Export zip must contain manifest.json");
  }
  const manifestText = await manifestFile.async("string");
  const manifest = JSON.parse(manifestText) as ExportManifest;

  for (const [path, file] of Object.entries(zip.files)) {
    if (path === "manifest.json" || file.dir) continue;
    if (path.startsWith("files/")) {
      fileContents.set(path, await file.async("uint8array"));
    }
    if (path.startsWith("notes/")) {
      const md = await file.async("string");
      const parsed = matter(md);
      const parts = path.split("/");
      const projectSlug = parts[1];
      const noteSlug = parts[2]?.replace(/\.md$/, "") ?? slugify("note");
      const project = manifest.projects.find(
        (p: ExportManifest["projects"][number]) => p.slug === projectSlug,
      );
      if (!project) continue;

      const alreadyInManifest = manifest.notes.some(
        (n: ExportManifest["notes"][number]) => n.project_id === project.id && n.slug === noteSlug,
      );
      if (!alreadyInManifest) {
        manifest.notes.push({
          id: createId(PREFIX.note),
          project_id: project.id,
          slug: noteSlug,
          title: (parsed.data.title as string) ?? noteSlug,
          body: parsed.content,
          frontmatter: parsed.data as Record<string, unknown>,
          is_system: false,
          system_key: null,
          version: 1,
          etag: 'W/"1"',
          created_by_type: "system",
          created_by_id: "import",
          updated_by_type: "system",
          updated_by_id: "import",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    }
  }

  return { manifest, fileContents };
}
