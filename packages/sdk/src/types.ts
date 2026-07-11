export type {
  Agent,
  CreateAgentInput,
  UpdateAgentInput,
} from "@visboard/shared";

export type AgentWithToken = import("@visboard/shared").Agent & { token?: string };
export type {
  Checklist,
  ChecklistItem,
  ChecklistWithItems,
  CreateChecklistInput,
  CreateChecklistItemInput,
  UpdateChecklistInput,
  UpdateChecklistItemInput,
} from "@visboard/shared";
export type {
  CreateEventInput,
  EventRecord,
} from "@visboard/shared";
export type { FileRecord } from "@visboard/shared";
export type {
  CreateNoteInput,
  Note,
  NoteVersion,
  UpdateNoteInput,
} from "@visboard/shared";
export type {
  CreateProjectInput,
  Project,
  ProjectStatus,
  UpdateProjectInput,
} from "@visboard/shared";
export type {
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  Workspace,
} from "@visboard/shared";

/** @deprecated Use EventRecord */
export type Event = import("@visboard/shared").EventRecord;

/** @deprecated Use CreateEventInput */
export type AppendEventInput = import("@visboard/shared").CreateEventInput;

export interface Pagination {
  next_cursor: string | null;
  has_more: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: Pagination;
}

export interface ContextNote {
  id: string;
  slug: string;
  title: string;
  summary: string;
  body?: string;
}

export interface ContextChecklistItem {
  id: string;
  text: string;
  done: boolean;
  sort_order: number;
  assignee_type: string | null;
  assignee_id: string | null;
}

export interface ContextChecklist {
  id: string;
  title: string;
  items: ContextChecklistItem[];
}

export interface ContextFile {
  id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
}

export interface ContextParticipant {
  id: string;
  display_name?: string;
  name?: string;
  scopes?: string[];
}

export interface ProjectContext {
  project: Pick<Project, "id" | "slug" | "name" | "description" | "status">;
  agents_md: string;
  notes: ContextNote[];
  checklists: ContextChecklist[];
  files: ContextFile[];
  participants: {
    users: ContextParticipant[];
    agents: ContextParticipant[];
  };
}

export interface BootstrapResult {
  workspace: Workspace;
  user: { id: string; display_name: string; email: string | null };
  token: string;
}

export interface ExportJob {
  export_id: string;
  status: "pending" | "ready" | "failed";
}

export interface HealthStatus {
  status: string;
  version: string;
}

export interface ListEventsParams {
  since?: string;
  types?: string[];
  limit?: number;
  cursor?: string;
}

export interface GetContextParams {
  include?: "headings" | "bodies";
}

export interface BootstrapInput {
  name: string;
  slug?: string;
}

import type { Project, Workspace } from "@visboard/shared";
