export const EventType = {
  PROJECT_CREATED: "project.created",
  PROJECT_UPDATED: "project.updated",
  NOTE_CREATED: "note.created",
  NOTE_UPDATED: "note.updated",
  NOTE_DELETED: "note.deleted",
  CHECKLIST_CREATED: "checklist.created",
  CHECKLIST_ITEM_UPDATED: "checklist.item.updated",
  FILE_UPLOADED: "file.uploaded",
  FILE_DELETED: "file.deleted",
  AGENT_CREATED: "agent.created",
  AGENT_REVOKED: "agent.revoked",
  AGENT_TURN_COMPLETED: "agent.turn.completed",
  SYSTEM_AGENTS_MD_SYNCED: "system.agents_md.synced",
  COMMENT_CREATED: "comment.created",
  COMMENT_UPDATED: "comment.updated",
  COMMENT_DELETED: "comment.deleted",
  HANDOFF_SUBMITTED: "handoff.submitted",
  HANDOFF_DECIDED: "handoff.decided",
} as const;

export type EventTypeValue = (typeof EventType)[keyof typeof EventType];

export const EVENT_TYPES: readonly EventTypeValue[] = Object.values(EventType);

export function isEventType(value: string): value is EventTypeValue {
  return (EVENT_TYPES as readonly string[]).includes(value);
}
