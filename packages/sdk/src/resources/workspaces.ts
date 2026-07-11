import type { HttpClient } from "../http.js";
import type {
  BootstrapInput,
  BootstrapResult,
  CreateWorkspaceInput,
  ExportJob,
  HealthStatus,
  UpdateWorkspaceInput,
  Workspace,
} from "../types.js";

export class WorkspacesResource {
  constructor(private readonly http: HttpClient) {}

  list(): Promise<Workspace[]> {
    return this.http.request<Workspace[]>("/workspaces");
  }

  create(input: CreateWorkspaceInput): Promise<Workspace> {
    return this.http.request<Workspace>("/workspaces", {
      method: "POST",
      body: input,
    });
  }

  get(ws: string): Promise<Workspace> {
    return this.http.request<Workspace>(`/workspaces/${ws}`);
  }

  update(ws: string, input: UpdateWorkspaceInput): Promise<Workspace> {
    return this.http.request<Workspace>(`/workspaces/${ws}`, {
      method: "PATCH",
      body: input,
    });
  }

  export(ws: string): Promise<ExportJob> {
    return this.http.request<ExportJob>(`/workspaces/${ws}/export`, {
      method: "POST",
    });
  }

  getExport(ws: string, exportId: string): Promise<Response> {
    return this.http.requestRaw(`/workspaces/${ws}/exports/${exportId}`);
  }
}

export class BootstrapResource {
  constructor(private readonly http: HttpClient) {}

  create(input: BootstrapInput): Promise<BootstrapResult> {
    return this.http.request<BootstrapResult>("/bootstrap", {
      method: "POST",
      body: input,
      token: null,
    });
  }
}

export class HealthResource {
  constructor(private readonly http: HttpClient) {}

  check(): Promise<HealthStatus> {
    const origin = this.http.baseUrl.replace(/\/v1\/?$/, "");
    return this.http.request<HealthStatus>(`${origin}/health`, { token: null });
  }
}
