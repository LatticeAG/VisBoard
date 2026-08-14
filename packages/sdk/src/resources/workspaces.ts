import type { HttpClient } from "../http.js";
import type {
  BootstrapInput,
  BootstrapResult,
  CreateWorkspaceInput,
  ExportJob,
  HealthStatus,
  ImportResult,
  UpdateWorkspaceInput,
  Workspace,
} from "../types.js";

export class WorkspacesResource {
  constructor(private readonly http: HttpClient) {}

  list(): Promise<Workspace[]> {
    return this.http.requestList<Workspace>("/workspaces");
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

  import(input: {
    file: Blob;
    slug: string;
    name: string;
  }): Promise<ImportResult & { workspace: Workspace; imported_at: string }> {
    const form = new FormData();
    form.append("file", input.file, "export.zip");
    form.append("slug", input.slug);
    form.append("name", input.name);
    return this.http.request("/workspaces/import", {
      method: "POST",
      body: form,
    });
  }
}

export class BootstrapResource {
  constructor(private readonly http: HttpClient) {}

  create(input: BootstrapInput): Promise<BootstrapResult> {
    const headers: Record<string, string> = {};
    if (input.bootstrapToken) {
      headers["X-Bootstrap-Token"] = input.bootstrapToken;
    }
    const { bootstrapToken: _token, ...body } = input;
    return this.http.request<BootstrapResult>("/bootstrap", {
      method: "POST",
      body,
      headers,
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

  ready(): Promise<HealthStatus> {
    const origin = this.http.baseUrl.replace(/\/v1\/?$/, "");
    return this.http.request<HealthStatus>(`${origin}/readyz`, { token: null });
  }
}
