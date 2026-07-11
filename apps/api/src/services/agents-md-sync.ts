import {
  agents,
  checklistItems,
  checklists,
  events,
  files,
  notes,
  projects,
  users,
  workspaceMembers,
  workspaces,
} from "@visboard/db";
import { generate } from "@visboard/agents-md";
import { EventType, PREFIX, createId } from "@visboard/shared";
import type { ProjectStatus } from "@visboard/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@visboard/db";
import { getEnv } from "../env.js";
import { firstParagraph } from "../lib/helpers.js";
import { createEvent } from "./event.js";

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleAgentsMdSync(projectId: string): void {
  const existing = debounceTimers.get(projectId);
  if (existing) clearTimeout(existing);

  debounceTimers.set(
    projectId,
    setTimeout(() => {
      debounceTimers.delete(projectId);
      syncAgentsMd(projectId).catch((err) => {
        console.error(`agents-md sync failed for ${projectId}:`, err);
      });
    }, 500),
  );
}

export function clearAgentsMdSyncTimers(): void {
  for (const timer of debounceTimers.values()) {
    clearTimeout(timer);
  }
  debounceTimers.clear();
}

export async function syncAgentsMd(projectId: string): Promise<string> {
  const { getDb } = await import("../db.js");
  const { db } = getDb();
  return syncAgentsMdWithDb(db, projectId);
}

export async function syncAgentsMdWithDb(
  db: Database["db"],
  projectId: string,
): Promise<string> {
  const env = getEnv();

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) return "";

  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, project.workspaceId))
    .limit(1);
  if (!workspace) return "";

  const noteRows = await db
    .select()
    .from(notes)
    .where(and(eq(notes.projectId, projectId), isNull(notes.deletedAt)));

  const userNotes = noteRows.filter((n) => !n.isSystem);
  const localOverride = noteRows.find((n) => n.slug === "agents.local.md");

  const checklistRows = await db
    .select()
    .from(checklists)
    .where(
      and(eq(checklists.projectId, projectId), isNull(checklists.deletedAt)),
    );

  const checklistData = [];
  for (const chk of checklistRows) {
    const items = await db
      .select()
      .from(checklistItems)
      .where(eq(checklistItems.checklistId, chk.id));
    checklistData.push({
      id: chk.id,
      title: chk.title,
      items: items
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((item) => ({
          id: item.id,
          text: item.text,
          done: item.done,
          assignee_type: item.assigneeType as "user" | "agent" | null | undefined,
          assignee_id: item.assigneeId,
        })),
    });
  }

  const fileRows = await db
    .select()
    .from(files)
    .where(and(eq(files.projectId, projectId), isNull(files.deletedAt)));

  const agentRows = await db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.workspaceId, workspace.id),
        eq(agents.status, "active"),
        isNull(agents.revokedAt),
      ),
    );

  const filteredAgents = agentRows.filter(
    (a) => a.projectIds.length === 0 || a.projectIds.includes(projectId),
  );

  const memberRows = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, workspace.id));

  const userRows = [];
  for (const m of memberRows) {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, m.userId))
      .limit(1);
    if (user) userRows.push(user);
  }

  const markdown = generate({
    project: {
      name: project.name,
      description: project.description,
      status: project.status as ProjectStatus,
      slug: project.slug,
    },
    workspace: { slug: workspace.slug },
    apiBaseUrl: env.API_BASE_URL,
    users: userRows.map((u) => ({
      id: u.id,
      display_name: u.displayName,
    })),
    agents: filteredAgents.map((a) => ({
      id: a.id,
      name: a.name,
      scopes: a.scopes,
    })),
    notes: userNotes.map((n) => ({
      slug: n.slug,
      title: n.title,
      body: n.body,
    })),
    checklists: checklistData,
    files: fileRows.map((f) => ({
      id: f.id,
      name: f.name,
      mime_type: f.mimeType,
      size_bytes: f.sizeBytes,
    })),
    localOverrides: localOverride?.body ?? null,
  });

  const now = new Date();
  const existing = noteRows.find((n) => n.systemKey === "agents.md");

  if (existing) {
    const newVersion = existing.version + 1;
    await db
      .update(notes)
      .set({
        title: "AGENTS.md",
        body: markdown,
        version: newVersion,
        updatedByType: "system",
        updatedById: "system",
        updatedAt: now,
      })
      .where(eq(notes.id, existing.id));
  } else {
    await db.insert(notes).values({
      id: createId(PREFIX.note),
      projectId,
      slug: "agents-md",
      title: "AGENTS.md",
      body: markdown,
      frontmatter: {},
      isSystem: true,
      systemKey: "agents.md",
      version: 1,
      createdByType: "system",
      createdById: "system",
      updatedByType: "system",
      updatedById: "system",
      createdAt: now,
      updatedAt: now,
    });
  }

  await db.insert(events).values({
    id: createId(PREFIX.event),
    projectId,
    type: EventType.SYSTEM_AGENTS_MD_SYNCED,
    actorType: "system",
    actorId: "system",
    resourceType: "note",
    resourceId: existing?.id ?? null,
    payload: {},
    createdAt: now,
  });

  return markdown;
}

export async function getAgentsMd(
  db: Database["db"],
  workspaceSlug: string,
  projectSlug: string,
): Promise<string> {
  const { getProjectBySlug } = await import("./project.js");
  const { project } = await getProjectBySlug(db, workspaceSlug, projectSlug);

  const [systemNote] = await db
    .select()
    .from(notes)
    .where(
      and(
        eq(notes.projectId, project.id),
        eq(notes.systemKey, "agents.md"),
        isNull(notes.deletedAt),
      ),
    )
    .limit(1);

  if (systemNote) return systemNote.body;
  return syncAgentsMdWithDb(db, project.id);
}

export async function getContext(
  db: Database["db"],
  workspaceSlug: string,
  projectSlug: string,
  include: "headings" | "bodies" = "headings",
) {
  const { getProjectBySlug, formatProject } = await import("./project.js");
  const { project } = await getProjectBySlug(db, workspaceSlug, projectSlug);

  const agentsMd = await getAgentsMd(db, workspaceSlug, projectSlug);

  const noteRows = await db
    .select()
    .from(notes)
    .where(
      and(
        eq(notes.projectId, project.id),
        isNull(notes.deletedAt),
        eq(notes.isSystem, false),
      ),
    );

  const checklistRows = await db
    .select()
    .from(checklists)
    .where(
      and(eq(checklists.projectId, project.id), isNull(checklists.deletedAt)),
    );

  const checklistData = [];
  for (const chk of checklistRows) {
    const items = await db
      .select()
      .from(checklistItems)
      .where(eq(checklistItems.checklistId, chk.id));
    checklistData.push({
      id: chk.id,
      title: chk.title,
      items: items
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((item) => ({
          id: item.id,
          text: item.text,
          done: item.done,
          assignee_type: item.assigneeType,
          assignee_id: item.assigneeId,
        })),
    });
  }

  const fileRows = await db
    .select()
    .from(files)
    .where(and(eq(files.projectId, project.id), isNull(files.deletedAt)));

  const memberRows = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, project.workspaceId));

  const userParticipants = [];
  for (const m of memberRows) {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, m.userId))
      .limit(1);
    if (user) {
      userParticipants.push({
        id: user.id,
        display_name: user.displayName,
      });
    }
  }

  const agentRows = await db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.workspaceId, project.workspaceId),
        eq(agents.status, "active"),
        isNull(agents.revokedAt),
      ),
    );

  const agentParticipants = agentRows
    .filter(
      (a) => a.projectIds.length === 0 || a.projectIds.includes(project.id),
    )
    .map((a) => ({
      id: a.id,
      name: a.name,
      scopes: a.scopes,
    }));

  return {
    project: formatProject(project),
    agents_md: agentsMd,
    notes: noteRows.map((n) => ({
      id: n.id,
      slug: n.slug,
      title: n.title,
      summary: firstParagraph(n.body),
      ...(include === "bodies" ? { body: n.body } : {}),
    })),
    checklists: checklistData,
    files: fileRows.map((f) => ({
      id: f.id,
      name: f.name,
      mime_type: f.mimeType,
      size_bytes: f.sizeBytes,
    })),
    participants: {
      users: userParticipants,
      agents: agentParticipants,
    },
  };
}
