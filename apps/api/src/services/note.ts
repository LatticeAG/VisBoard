import { noteVersions, notes } from "@visboard/db";
import type { Database } from "@visboard/db";
import { EventType, PREFIX, createId, slugify } from "@visboard/shared";
import { and, eq, isNull, or } from "drizzle-orm";
import matter from "gray-matter";
import type { AuthPrincipal } from "../auth/middleware.js";
import { badRequest, conflict, payloadTooLarge, preconditionFailed } from "../lib/errors.js";
import { actorFromAuth, noteEtag } from "../lib/helpers.js";
import { scheduleAgentsMdSync } from "./agents-md-sync.js";
import { createEvent } from "./event.js";
import { getProjectBySlug } from "./project.js";

function parseNoteBody(input: {
  body?: string;
  frontmatter?: Record<string, unknown>;
}) {
  if (input.frontmatter !== undefined) {
    return {
      body: input.body ?? "",
      frontmatter: input.frontmatter,
    };
  }
  if (input.body) {
    const parsed = matter(input.body);
    return {
      body: parsed.content,
      frontmatter: parsed.data as Record<string, unknown>,
    };
  }
  return { body: "", frontmatter: {} };
}

const NOTE_BODY_MAX_BYTES = 1_048_576;

function assertNoteBodySize(body: string): void {
  if (Buffer.byteLength(body, "utf8") > NOTE_BODY_MAX_BYTES) {
    throw payloadTooLarge(`Note body exceeds maximum size of ${NOTE_BODY_MAX_BYTES} bytes`);
  }
}

export async function listNotes(
  db: Database["db"],
  workspaceSlug: string,
  projectSlug: string,
  auth?: AuthPrincipal,
) {
  const { project } = await getProjectBySlug(db, workspaceSlug, projectSlug, auth);
  const rows = await db
    .select()
    .from(notes)
    .where(and(eq(notes.projectId, project.id), isNull(notes.deletedAt)));

  return rows.filter((n) => !n.isSystem).map(formatNote);
}

export async function createNote(
  db: Database["db"],
  workspaceSlug: string,
  projectSlug: string,
  auth: AuthPrincipal,
  input: {
    title: string;
    slug?: string;
    body?: string;
    frontmatter?: Record<string, unknown>;
  },
) {
  const { project } = await getProjectBySlug(db, workspaceSlug, projectSlug, auth);
  const slug = input.slug ?? slugify(input.title);
  const { body, frontmatter } = parseNoteBody(input);
  assertNoteBodySize(body);
  const actor = actorFromAuth(auth);
  const now = new Date();
  const noteId = createId(PREFIX.note);

  const existing = await db
    .select()
    .from(notes)
    .where(and(eq(notes.projectId, project.id), eq(notes.slug, slug)))
    .limit(1);
  if (existing.some((n) => !n.deletedAt)) {
    throw conflict(`Note slug '${slug}' already exists`);
  }

  const [note] = await db
    .insert(notes)
    .values({
      id: noteId,
      projectId: project.id,
      slug,
      title: input.title,
      body,
      frontmatter,
      version: 1,
      createdByType: actor.actorType,
      createdById: actor.actorId,
      updatedByType: actor.actorType,
      updatedById: actor.actorId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!note) throw new Error("Failed to create note");

  await db.insert(noteVersions).values({
    id: createId(PREFIX.noteVersion),
    noteId,
    version: 1,
    title: input.title,
    body,
    frontmatter,
    createdByType: actor.actorType,
    createdById: actor.actorId,
    createdAt: now,
  });

  await createEvent(db, project.id, auth, {
    type: EventType.NOTE_CREATED,
    resource_type: "note",
    resource_id: noteId,
  });

  scheduleAgentsMdSync(project.id);

  return formatNote(note);
}

export async function getNote(
  db: Database["db"],
  workspaceSlug: string,
  projectSlug: string,
  noteIdOrSlug: string,
  auth?: AuthPrincipal,
) {
  const { project } = await getProjectBySlug(db, workspaceSlug, projectSlug, auth);

  const idCondition = eq(notes.id, noteIdOrSlug);
  const slugCondition = eq(notes.slug, noteIdOrSlug);
  const identifierCondition = noteIdOrSlug.startsWith(`${PREFIX.note}_`)
    ? idCondition
    : or(idCondition, slugCondition);

  const [note] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.projectId, project.id), identifierCondition, isNull(notes.deletedAt)))
    .limit(1);

  if (!note) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Note '${noteIdOrSlug}' not found`);
  }

  return note;
}

export async function updateNote(
  db: Database["db"],
  workspaceSlug: string,
  projectSlug: string,
  noteId: string,
  auth: AuthPrincipal,
  input: {
    title?: string;
    body?: string;
    frontmatter?: Record<string, unknown>;
  },
  ifMatch: number | null,
) {
  const note = await getNote(db, workspaceSlug, projectSlug, noteId, auth);

  if (ifMatch !== null && ifMatch !== note.version) {
    throw preconditionFailed(`Version mismatch: expected ${ifMatch}, current is ${note.version}`);
  }
  if (ifMatch === null) {
    throw badRequest("If-Match header is required for note updates");
  }

  const parsed = parseNoteBody({
    body: input.body ?? note.body,
    frontmatter: input.frontmatter ?? (note.frontmatter as Record<string, unknown>),
  });
  assertNoteBodySize(parsed.body);

  const actor = actorFromAuth(auth);
  const now = new Date();
  const newVersion = note.version + 1;

  const [updated] = await db
    .update(notes)
    .set({
      title: input.title ?? note.title,
      body: input.body !== undefined ? parsed.body : note.body,
      frontmatter: input.frontmatter !== undefined ? parsed.frontmatter : note.frontmatter,
      version: newVersion,
      updatedByType: actor.actorType,
      updatedById: actor.actorId,
      updatedAt: now,
    })
    .where(eq(notes.id, noteId))
    .returning();
  if (!updated) throw new Error("Failed to update note");

  await db.insert(noteVersions).values({
    id: createId(PREFIX.noteVersion),
    noteId,
    version: newVersion,
    title: updated.title,
    body: updated.body,
    frontmatter: updated.frontmatter,
    createdByType: actor.actorType,
    createdById: actor.actorId,
    createdAt: now,
  });

  await createEvent(db, note.projectId, auth, {
    type: EventType.NOTE_UPDATED,
    resource_type: "note",
    resource_id: noteId,
  });

  scheduleAgentsMdSync(note.projectId);

  return formatNote(updated);
}

export async function deleteNote(
  db: Database["db"],
  workspaceSlug: string,
  projectSlug: string,
  noteId: string,
  auth: AuthPrincipal,
) {
  const note = await getNote(db, workspaceSlug, projectSlug, noteId, auth);
  const now = new Date();

  await db.update(notes).set({ deletedAt: now, updatedAt: now }).where(eq(notes.id, noteId));

  await createEvent(db, note.projectId, auth, {
    type: EventType.NOTE_DELETED,
    resource_type: "note",
    resource_id: noteId,
  });

  scheduleAgentsMdSync(note.projectId);
}

export async function listNoteVersions(
  db: Database["db"],
  workspaceSlug: string,
  projectSlug: string,
  noteId: string,
  auth?: AuthPrincipal,
) {
  await getNote(db, workspaceSlug, projectSlug, noteId, auth);
  const rows = await db.select().from(noteVersions).where(eq(noteVersions.noteId, noteId));

  return rows.map((v) => ({
    id: v.id,
    note_id: v.noteId,
    version: v.version,
    title: v.title,
    body: v.body,
    frontmatter: v.frontmatter,
    created_by_type: v.createdByType,
    created_by_id: v.createdById,
    created_at: v.createdAt.toISOString(),
  }));
}

export async function getNoteVersion(
  db: Database["db"],
  workspaceSlug: string,
  projectSlug: string,
  noteId: string,
  version: number,
  auth?: AuthPrincipal,
) {
  await getNote(db, workspaceSlug, projectSlug, noteId, auth);
  const [row] = await db
    .select()
    .from(noteVersions)
    .where(and(eq(noteVersions.noteId, noteId), eq(noteVersions.version, version)))
    .limit(1);

  if (!row) {
    const { notFound } = await import("../lib/errors.js");
    throw notFound(`Note version ${version} not found`);
  }

  return {
    id: row.id,
    note_id: row.noteId,
    version: row.version,
    title: row.title,
    body: row.body,
    frontmatter: row.frontmatter,
    created_by_type: row.createdByType,
    created_by_id: row.createdById,
    created_at: row.createdAt.toISOString(),
  };
}

export function formatNote(n: typeof notes.$inferSelect) {
  return {
    id: n.id,
    project_id: n.projectId,
    slug: n.slug,
    title: n.title,
    body: n.body,
    frontmatter: n.frontmatter,
    is_system: n.isSystem,
    system_key: n.systemKey,
    version: n.version,
    etag: noteEtag(n.version),
    created_by_type: n.createdByType,
    created_by_id: n.createdById,
    updated_by_type: n.updatedByType,
    updated_by_id: n.updatedById,
    created_at: n.createdAt.toISOString(),
    updated_at: n.updatedAt.toISOString(),
  };
}
