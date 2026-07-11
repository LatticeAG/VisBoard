import type { HttpClient } from "../http.js";
import type {
  CreateProjectInput,
  Project,
  UpdateProjectInput,
} from "../types.js";

export class ProjectsResource {
  constructor(private readonly http: HttpClient) {}

  list(ws: string): Promise<Project[]> {
    return this.http.request<Project[]>(`/workspaces/${ws}/projects`);
  }

  create(ws: string, input: CreateProjectInput): Promise<Project> {
    return this.http.request<Project>(`/workspaces/${ws}/projects`, {
      method: "POST",
      body: input,
    });
  }

  get(ws: string, project: string): Promise<Project> {
    return this.http.request<Project>(`/workspaces/${ws}/projects/${project}`);
  }

  update(ws: string, project: string, input: UpdateProjectInput): Promise<Project> {
    return this.http.request<Project>(`/workspaces/${ws}/projects/${project}`, {
      method: "PATCH",
      body: input,
    });
  }

  archive(ws: string, project: string): Promise<Project> {
    return this.http.request<Project>(`/workspaces/${ws}/projects/${project}`, {
      method: "DELETE",
    });
  }
}
