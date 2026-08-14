import type { HttpClient } from "../http.js";
import type {
  CreateEventInput,
  EventRecord,
  ListEventsParams,
  PaginatedResponse,
} from "../types.js";

export class EventsResource {
  constructor(private readonly http: HttpClient) {}

  append(ws: string, project: string, input: CreateEventInput): Promise<EventRecord> {
    return this.http.request<EventRecord>(`/workspaces/${ws}/projects/${project}/events`, {
      method: "POST",
      body: input,
    });
  }

  list(
    ws: string,
    project: string,
    params: ListEventsParams = {},
  ): Promise<PaginatedResponse<EventRecord>> {
    const query: Record<string, string | number | undefined> = {};
    if (params.since) query.since = params.since;
    if (params.types?.length) query.types = params.types.join(",");
    if (params.limit) query.limit = params.limit;
    if (params.cursor) query.cursor = params.cursor;

    return this.http.request<PaginatedResponse<EventRecord>>(
      `/workspaces/${ws}/projects/${project}/events`,
      { query },
    );
  }
}
