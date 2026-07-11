import { checklistItems, checklists } from "@visboard/db";
import { EventType, PREFIX, createId } from "@visboard/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@visboard/db";
import type { AuthPrincipal } from "../auth/middleware.js";
import { notFound } from "../lib/errors.js";
import { getProjectBySlug } from "./project.js";
import { scheduleAgentsMdSync } from "./agents-md-sync.js";
import { createEvent } from "./event.js";

export async function listChecklists(
  db: Database["db"],
  workspaceSlug: string,
  projectSlug: string,
  auth?: AuthPrincipal,
) {
  const { project } = await getProjectBySlug(
    db,
    workspaceSlug,
    projectSlug,
    auth,
  );
  const rows = await db
    .select()
    .from(checklists)
    .where(
      and(eq(checklists.projectId, project.id), isNull(checklists.deletedAt)),
    );

  const result = [];
  for (const chk of rows) {
    const items = await db
      .select()
      .from(checklistItems)
      .where(eq(checklistItems.checklistId, chk.id));
    result.push(formatChecklist(chk, items));
  }
  return result;
}

export async function createChecklist(
  db: Database["db"],
  workspaceSlug: string,
  projectSlug: string,
  auth: AuthPrincipal,
  input: { title: string; source_note_id?: string },
) {
  const { project } = await getProjectBySlug(db, workspaceSlug, projectSlug, auth);
  const now = new Date();
  const checklistId = createId(PREFIX.checklist);

  const [chk] = await db
    .insert(checklists)
    .values({
      id: checklistId,
      projectId: project.id,
      title: input.title,
      sourceNoteId: input.source_note_id ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await createEvent(db, project.id, auth, {
    type: EventType.CHECKLIST_CREATED,
    resource_type: "checklist",
    resource_id: checklistId,
  });

  scheduleAgentsMdSync(project.id);

  return formatChecklist(chk!, []);
}

export async function getChecklist(
  db: Database["db"],
  workspaceSlug: string,
  projectSlug: string,
  checklistId: string,
  auth?: AuthPrincipal,
) {
  const { project } = await getProjectBySlug(
    db,
    workspaceSlug,
    projectSlug,
    auth,
  );
  const [chk] = await db
    .select()
    .from(checklists)
    .where(
      and(
        eq(checklists.projectId, project.id),
        eq(checklists.id, checklistId),
        isNull(checklists.deletedAt),
      ),
    )
    .limit(1);

  if (!chk) throw notFound(`Checklist '${checklistId}' not found`);

  const items = await db
    .select()
    .from(checklistItems)
    .where(eq(checklistItems.checklistId, checklistId));

  return { checklist: chk, items };
}

export async function updateChecklist(
  db: Database["db"],
  workspaceSlug: string,
  projectSlug: string,
  checklistId: string,
  auth: AuthPrincipal,
  input: { title?: string },
) {
  const { checklist, items } = await getChecklist(
    db,
    workspaceSlug,
    projectSlug,
    checklistId,
    auth,
  );
  const now = new Date();

  const [updated] = await db
    .update(checklists)
    .set({ ...input, updatedAt: now })
    .where(eq(checklists.id, checklist.id))
    .returning();

  scheduleAgentsMdSync(checklist.projectId);

  return formatChecklist(updated!, items);
}

export async function deleteChecklist(
  db: Database["db"],
  workspaceSlug: string,
  projectSlug: string,
  checklistId: string,
  _auth: AuthPrincipal,
) {
  const { checklist } = await getChecklist(
    db,
    workspaceSlug,
    projectSlug,
    checklistId,
    _auth,
  );
  const now = new Date();

  await db
    .update(checklists)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(checklists.id, checklist.id));

  scheduleAgentsMdSync(checklist.projectId);
}

export async function addChecklistItem(
  db: Database["db"],
  workspaceSlug: string,
  projectSlug: string,
  checklistId: string,
  auth: AuthPrincipal,
  input: { text: string; sort_order?: number },
) {
  const { checklist, items } = await getChecklist(
    db,
    workspaceSlug,
    projectSlug,
    checklistId,
    auth,
  );
  const now = new Date();
  const itemId = createId(PREFIX.item);
  const sortOrder =
    input.sort_order ?? Math.max(-1, ...items.map((i) => i.sortOrder)) + 1;

  const [item] = await db
    .insert(checklistItems)
    .values({
      id: itemId,
      checklistId: checklist.id,
      text: input.text,
      sortOrder,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await createEvent(db, checklist.projectId, auth, {
    type: EventType.CHECKLIST_ITEM_UPDATED,
    resource_type: "checklist_item",
    resource_id: itemId,
  });

  scheduleAgentsMdSync(checklist.projectId);

  return formatChecklistItem(item!);
}

export async function updateChecklistItem(
  db: Database["db"],
  workspaceSlug: string,
  projectSlug: string,
  checklistId: string,
  itemId: string,
  auth: AuthPrincipal,
  input: Partial<{
    text: string;
    done: boolean;
    assignee_type: string;
    assignee_id: string;
    due_at: string;
    blocked_by: string[];
  }>,
) {
  const { checklist } = await getChecklist(
    db,
    workspaceSlug,
    projectSlug,
    checklistId,
    auth,
  );

  const [existing] = await db
    .select()
    .from(checklistItems)
    .where(
      and(
        eq(checklistItems.checklistId, checklistId),
        eq(checklistItems.id, itemId),
      ),
    )
    .limit(1);

  if (!existing) throw notFound(`Checklist item '${itemId}' not found`);

  const now = new Date();
  await db
    .update(checklistItems)
    .set({
      text: input.text ?? existing.text,
      done: input.done ?? existing.done,
      assigneeType: input.assignee_type ?? existing.assigneeType,
      assigneeId: input.assignee_id ?? existing.assigneeId,
      dueAt: input.due_at ? new Date(input.due_at) : existing.dueAt,
      blockedBy: input.blocked_by ?? existing.blockedBy,
      updatedAt: now,
    })
    .where(eq(checklistItems.id, itemId));

  await createEvent(db, checklist.projectId, auth, {
    type: EventType.CHECKLIST_ITEM_UPDATED,
    resource_type: "checklist_item",
    resource_id: itemId,
    payload: input,
  });

  scheduleAgentsMdSync(checklist.projectId);

  const [updated] = await db
    .select()
    .from(checklistItems)
    .where(eq(checklistItems.id, itemId))
    .limit(1);

  return formatChecklistItem(updated!);
}

function formatChecklistItem(item: typeof checklistItems.$inferSelect) {
  return {
    id: item.id,
    checklist_id: item.checklistId,
    text: item.text,
    done: item.done,
    sort_order: item.sortOrder,
    assignee_type: item.assigneeType,
    assignee_id: item.assigneeId,
    due_at: item.dueAt?.toISOString() ?? null,
    blocked_by: item.blockedBy,
    created_at: item.createdAt.toISOString(),
    updated_at: item.updatedAt.toISOString(),
  };
}

function formatChecklist(
  chk: typeof checklists.$inferSelect,
  items: (typeof checklistItems.$inferSelect)[],
) {
  return {
    id: chk.id,
    project_id: chk.projectId,
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
        created_at: item.createdAt.toISOString(),
        updated_at: item.updatedAt.toISOString(),
      })),
    created_at: chk.createdAt.toISOString(),
    updated_at: chk.updatedAt.toISOString(),
  };
}
