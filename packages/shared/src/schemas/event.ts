import { z } from "zod";
import { EventType } from "../events.js";
import { ID_PATTERNS } from "../ids.js";
import { actorTypeSchema, timestampSchema } from "./common.js";
import { projectIdSchema } from "./project.js";

export const eventIdSchema = z.string().regex(ID_PATTERNS.event);

export const eventTypeSchema = z.enum([
  EventType.PROJECT_CREATED,
  EventType.PROJECT_UPDATED,
  EventType.NOTE_CREATED,
  EventType.NOTE_UPDATED,
  EventType.NOTE_DELETED,
  EventType.CHECKLIST_CREATED,
  EventType.CHECKLIST_ITEM_UPDATED,
  EventType.FILE_UPLOADED,
  EventType.FILE_DELETED,
  EventType.AGENT_CREATED,
  EventType.AGENT_REVOKED,
  EventType.AGENT_TURN_COMPLETED,
  EventType.SYSTEM_AGENTS_MD_SYNCED,
]);

export const eventSchema = z.object({
  id: eventIdSchema,
  project_id: projectIdSchema,
  type: eventTypeSchema,
  actor_type: actorTypeSchema,
  actor_id: z.string(),
  resource_type: z.string().nullable().optional(),
  resource_id: z.string().nullable().optional(),
  payload: z.record(z.unknown()).default({}),
  created_at: timestampSchema,
});

export const createEventSchema = z.object({
  type: eventTypeSchema,
  resource_type: z.string().optional(),
  resource_id: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
});

export type EventRecord = z.infer<typeof eventSchema>;
export type CreateEventInput = z.infer<typeof createEventSchema>;
