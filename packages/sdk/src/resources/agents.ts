import type { HttpClient } from "../http.js";
import type { Agent, AgentWithToken, CreateAgentInput, UpdateAgentInput } from "../types.js";

export class AgentsResource {
  constructor(private readonly http: HttpClient) {}

  list(ws: string, params: { project?: string } = {}): Promise<Agent[]> {
    const query: Record<string, string | undefined> = {};
    if (params.project) query.project = params.project;
    return this.http.requestList<Agent>(`/workspaces/${ws}/agents`, { query });
  }

  create(ws: string, input: CreateAgentInput): Promise<AgentWithToken> {
    return this.http.request<AgentWithToken>(`/workspaces/${ws}/agents`, {
      method: "POST",
      body: input,
    });
  }

  update(ws: string, agentId: string, input: UpdateAgentInput): Promise<Agent> {
    return this.http.request<Agent>(`/workspaces/${ws}/agents/${agentId}`, {
      method: "PATCH",
      body: input,
    });
  }

  revoke(ws: string, agentId: string): Promise<Agent> {
    return this.http.request<Agent>(`/workspaces/${ws}/agents/${agentId}/revoke`, {
      method: "POST",
    });
  }
}
