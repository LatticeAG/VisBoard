import { events } from "@visboard/db";
import { PREFIX, createId } from "@visboard/shared";
import { and, eq, gt, inArray } from "drizzle-orm";
import type { Database } from "@visboard/db";
import type { AuthPrincipal } from "../auth/middleware.js";
import { actorFromAuth } from "../lib/helpers.js";
import { parseLimit, paginate } from "../lib/pagination.js";
import { getProjectBySlug } from "./project.js";

export async function createEvent(
  db: Database["db"],
  projectId: string,
  auth: AuthPrincipal,
  input: {
    type: string;
    resource_type?: string;
    resource_id?: string;
    payload?: Record<string, unknown>;
  },
) {
  const actor = actorFromAuth(auth);
  const now = new Date();
  const eventId = createId(PREFIX.event);

  const [event] = await db
    .insert(events)
    .values({
      id: eventId,
      projectId,
      type: input.type,
      actorType: actor.actorType,
      actorId: actor.actorId,
      resourceType: input.resource_type ?? null,
      resourceId: input.resource_id ?? null,
      payload: input.payload ?? {},
      createdAt: now,
    })
    .returning();

  return formatEvent(event!);
}

export async function appendProjectEvent(
  db: Database["db"],
  workspaceSlug: string,
  projectSlug: string,
  auth: AuthPrincipal,
  input: {
    type: string;
    resource_type?: string;
    resource_id?: string;
    payload?: Record<string, unknown>;
  },
) {
  const { project } = await getProjectBySlug(db, workspaceSlug, projectSlug);
  return createEvent(db, project.id, auth, input);
}

export async function listProjectEvents(
  db: Database["db"],
  workspaceSlug: string,
  projectSlug: string,
  query: {
    since?: string;
    types?: string;
    limit?: string;
    cursor?: string;
  },
) {
  const { project } = await getProjectBySlug(db, workspaceSlug, projectSlug);
  const limit = parseLimit(query.limit) + 1;

  const conditions = [eq(events.projectId, project.id)];

  if (query.types) {
    const typeList = query.types.split(",").map((t) => t.trim());
    conditions.push(inArray(events.type, typeList));
  }

  if (query.since) {
    if (query.since.startsWith("evt_")) {
      const [sinceEvent] = await db
        .select()
        .from(events)
        .where(eq(events.id, query.since))
        .limit(1);
      if (sinceEvent) {
        conditions.push(gt(events.createdAt, sinceEvent.createdAt));
      }
    } else {
      const sinceDate = new Date(query.since);
      if (!Number.isNaN(sinceDate.getTime())) {
        conditions.push(gt(events.createdAt, sinceDate));
      }
    }
  }

  if (query.cursor) {
    const [cursorEvent] = await db
      .select()
      .from(events)
      .where(eq(events.id, query.cursor))
      .limit(1);
    if (cursorEvent) {
      conditions.push(gt(events.createdAt, cursorEvent.createdAt));
    }
  }

  const rows = await db
    .select()
    .from(events)
    .where(and(...conditions))
    .orderBy(events.createdAt)
    .limit(limit);

  const formatted = rows.map(formatEvent);
  return paginate(formatted, parseLimit(query.limit));
}

function formatEvent(e: typeof events.$inferSelect) {
  return {
    id: e.id,
    project_id: e.projectId,
    type: e.type,
    actor_type: e.actorType,
    actor_id: e.actorId,
    resource_type: e.resourceType,
    resource_id: e.resourceId,
    payload: e.payload,
    created_at: e.createdAt.toISOString(),
  };
}
