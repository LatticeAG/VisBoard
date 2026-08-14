import type { HttpClient } from "../http.js";

export interface HandoffSummary {
  id: string;
  board_id: string;
  state: string;
  packet: {
    goal: string;
    requested_decision?: { question?: string };
    change_summary?: Array<{ summary: string }>;
    evidence?: Array<{ title: string; verified?: boolean }>;
    risks?: Array<{ summary: string; category?: string }>;
    source_revision_id?: string | null;
    belief_trace?: {
      beliefs?: Array<{ id: string; statement: string; weight?: number }>;
      assumptions?: Array<{ id: string; statement: string; weight?: number }>;
      overweighted?: Array<{ id: string; statement: string; weight?: number }>;
      ignored?: Array<{ id: string; statement: string; weight?: number }>;
    };
  };
  packet_hash: string | null;
  belief_trace_hash: string | null;
  claimed_by_id: string | null;
  revision_id: string | null;
}

export interface BeliefTraceResponse {
  trace: unknown;
  belief_trace_hash: string;
  packet_hash: string;
}

export class HandoffsResource {
  constructor(private readonly http: HttpClient) {}

  list(workspaceId: string, boardId: string, state?: string): Promise<HandoffSummary[]> {
    return this.http.request<HandoffSummary[]>(
      `/workspaces/${workspaceId}/boards/${boardId}/handoffs`,
      { query: state ? { state } : undefined },
    );
  }

  get(workspaceId: string, boardId: string, handoffId: string): Promise<HandoffSummary> {
    return this.http.request<HandoffSummary>(
      `/workspaces/${workspaceId}/boards/${boardId}/handoffs/${handoffId}`,
    );
  }

  getBeliefTrace(
    workspaceId: string,
    boardId: string,
    handoffId: string,
  ): Promise<BeliefTraceResponse> {
    return this.http.request<BeliefTraceResponse>(
      `/workspaces/${workspaceId}/boards/${boardId}/handoffs/${handoffId}/belief-trace`,
    );
  }

  claim(workspaceId: string, boardId: string, handoffId: string): Promise<HandoffSummary> {
    return this.http.request<HandoffSummary>(
      `/workspaces/${workspaceId}/boards/${boardId}/handoffs/${handoffId}/claim`,
      { method: "POST" },
    );
  }

  decide(
    workspaceId: string,
    boardId: string,
    handoffId: string,
    input: { outcome: string; rationale: string; conditions?: Record<string, unknown> },
  ): Promise<HandoffSummary> {
    return this.http.request<HandoffSummary>(
      `/workspaces/${workspaceId}/boards/${boardId}/handoffs/${handoffId}/decisions`,
      { method: "POST", body: input },
    );
  }
}
