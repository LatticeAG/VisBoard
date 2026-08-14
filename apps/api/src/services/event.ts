import { events } from "@visboard/db";
import type { Database } from "@visboard/db";
import { PREFIX, createId } from "@visboard/shared";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import type { AuthPrincipal } from "../auth/middleware.js";
import { actorFromAuth } from "../lib/helpers.js";
import { paginate, parseLimit } from "../lib/pagination.js";
import { getProjectBySlug } from "./project.js";

type FormattedEvent = ReturnType<typeof formatEvent>;

type EventListener = (event: FormattedEvent) => void;

const projectListeners = new Map<string, Set<EventListener>>();

export function subscribeToProjectEvents(projectId: string, listener: EventListener): () => void {
  let listeners = projectListeners.get(projectId);
  if (!listeners) {
    listeners = new Set();
    projectListeners.set(projectId, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners?.delete(listener);
    if (listeners?.size === 0) {
      projectListeners.delete(projectId);
    }
  };
}

const recentEmitted = new Set<string>();

export function dispatchProjectEventFromNotify(payload: unknown): void {
  let projectId: string | undefined;
  let event: FormattedEvent | undefined;
  if (typeof payload === "string") {
    try {
      const parsed = JSON.parse(payload) as { project_id?: string; event?: FormattedEvent };
      projectId = parsed.project_id;
      event = parsed.event;
    } catch {
      projectId = payload;
    }
  } else if (typeof payload === "object" && payload !== null) {
    const parsed = payload as { project_id?: string; event?: FormattedEvent };
    projectId = parsed.project_id;
    event = parsed.event;
  }
  if (!projectId) return;
  if (event) {
    emitProjectEvent(projectId, event);
    return;
  }
  void fanoutProjectEvents(projectId);
}

export async function notifyProjectEvent(projectId: string, db?: Database["db"]): Promise<void> {
  try {
    const store = db ?? (await import("../db.js")).getDb().db;
    await store.execute(
      sql`select pg_notify('visboard_events', json_build_object('project_id', ${projectId}::text)::text)`,
    );
  } catch {
    // Event is already durable. Fan-out is best-effort.
  }
}

async function fanoutProjectEvents(projectId: string): Promise<void> {
  try {
    const { getDb } = await import("../db.js");
    const { db } = getDb();
    const rows = await db.select().from(events).where(eq(events.projectId, projectId));
    const last = rows.at(-1);
    if (last) emitProjectEvent(projectId, formatEvent(last));
  } catch {
    // tests or missing db
  }
}

function emitProjectEvent(projectId: string, event: FormattedEvent) {
  if (recentEmitted.has(event.id)) return;
  recentEmitted.add(event.id);
  if (recentEmitted.size > 2048) {
    const oldest = recentEmitted.values().next().value;
    if (oldest) recentEmitted.delete(oldest);
  }
  const listeners = projectListeners.get(projectId);
  if (!listeners) return;
  for (const listener of listeners) {
    listener(event);
  }
}

export function clearEventListenersForTests(): void {
  projectListeners.clear();
}

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
  if (!event) throw new Error("Failed to create event");

  const formatted = formatEvent(event);
  emitProjectEvent(projectId, formatted);
  await notifyProjectEvent(projectId, db);
  return formatted;
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
  const { project } = await getProjectBySlug(db, workspaceSlug, projectSlug, auth);
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
  auth?: AuthPrincipal,
) {
  const { project } = await getProjectBySlug(db, workspaceSlug, projectSlug, auth);
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

export async function pollProjectEvents(
  db: Database["db"],
  projectId: string,
  query: {
    since?: string;
    types?: string;
  },
): Promise<FormattedEvent[]> {
  const conditions = [eq(events.projectId, projectId)];

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

  const rows = await db
    .select()
    .from(events)
    .where(and(...conditions))
    .orderBy(events.createdAt);

  return rows.map(formatEvent);
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
