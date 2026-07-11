import type { HttpClient } from "../http.js";
import type {
  CreateNoteInput,
  Note,
  NoteVersion,
  UpdateNoteInput,
} from "../types.js";

export class NotesResource {
  constructor(private readonly http: HttpClient) {}

  list(ws: string, project: string): Promise<Note[]> {
    return this.http.request<Note[]>(
      `/workspaces/${ws}/projects/${project}/notes`,
    );
  }

  create(ws: string, project: string, input: CreateNoteInput): Promise<Note> {
    return this.http.request<Note>(
      `/workspaces/${ws}/projects/${project}/notes`,
      {
        method: "POST",
        body: input,
      },
    );
  }

  get(ws: string, project: string, noteId: string): Promise<Note> {
    return this.http.request<Note>(
      `/workspaces/${ws}/projects/${project}/notes/${noteId}`,
    );
  }

  update(
    ws: string,
    project: string,
    noteId: string,
    input: UpdateNoteInput,
    ifMatch?: string,
  ): Promise<Note> {
    const headers: Record<string, string> = {};
    if (ifMatch) {
      headers["If-Match"] = ifMatch;
    }
    return this.http.request<Note>(
      `/workspaces/${ws}/projects/${project}/notes/${noteId}`,
      {
        method: "PATCH",
        body: input,
        headers,
      },
    );
  }

  delete(ws: string, project: string, noteId: string): Promise<void> {
    return this.http.request<void>(
      `/workspaces/${ws}/projects/${project}/notes/${noteId}`,
      { method: "DELETE" },
    );
  }

  listVersions(ws: string, project: string, noteId: string): Promise<NoteVersion[]> {
    return this.http.request<NoteVersion[]>(
      `/workspaces/${ws}/projects/${project}/notes/${noteId}/versions`,
    );
  }

  getVersion(
    ws: string,
    project: string,
    noteId: string,
    version: number,
  ): Promise<NoteVersion> {
    return this.http.request<NoteVersion>(
      `/workspaces/${ws}/projects/${project}/notes/${noteId}/versions/${version}`,
    );
  }
}
