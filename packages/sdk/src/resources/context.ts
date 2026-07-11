import type { HttpClient } from "../http.js";
import type { GetContextParams, ProjectContext } from "../types.js";

export class ContextResource {
  constructor(private readonly http: HttpClient) {}

  get(
    ws: string,
    project: string,
    params: GetContextParams = {},
  ): Promise<ProjectContext> {
    const query: Record<string, string | undefined> = {};
    if (params.include) query.include = params.include;
    return this.http.request<ProjectContext>(
      `/workspaces/${ws}/projects/${project}/context`,
      { query },
    );
  }
}

export class AgentsMdResource {
  constructor(private readonly http: HttpClient) {}

  get(ws: string, project: string): Promise<string> {
    return this.http.request<string>(
      `/workspaces/${ws}/projects/${project}/agents.md`,
    );
  }

  sync(ws: string, project: string): Promise<void> {
    return this.http.request<void>(
      `/workspaces/${ws}/projects/${project}/agents.md/sync`,
      { method: "POST" },
    );
  }
}
