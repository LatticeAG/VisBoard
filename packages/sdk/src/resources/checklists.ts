import type { HttpClient } from "../http.js";
import type {
  ChecklistItem,
  ChecklistWithItems,
  CreateChecklistInput,
  CreateChecklistItemInput,
  UpdateChecklistInput,
  UpdateChecklistItemInput,
} from "../types.js";

export class ChecklistsResource {
  constructor(private readonly http: HttpClient) {}

  list(ws: string, project: string): Promise<ChecklistWithItems[]> {
    return this.http.request<ChecklistWithItems[]>(
      `/workspaces/${ws}/projects/${project}/checklists`,
    );
  }

  create(
    ws: string,
    project: string,
    input: CreateChecklistInput,
  ): Promise<ChecklistWithItems> {
    return this.http.request<ChecklistWithItems>(
      `/workspaces/${ws}/projects/${project}/checklists`,
      {
        method: "POST",
        body: input,
      },
    );
  }

  get(ws: string, project: string, checklistId: string): Promise<ChecklistWithItems> {
    return this.http.request<ChecklistWithItems>(
      `/workspaces/${ws}/projects/${project}/checklists/${checklistId}`,
    );
  }

  update(
    ws: string,
    project: string,
    checklistId: string,
    input: UpdateChecklistInput,
  ): Promise<ChecklistWithItems> {
    return this.http.request<ChecklistWithItems>(
      `/workspaces/${ws}/projects/${project}/checklists/${checklistId}`,
      {
        method: "PATCH",
        body: input,
      },
    );
  }

  delete(ws: string, project: string, checklistId: string): Promise<void> {
    return this.http.request<void>(
      `/workspaces/${ws}/projects/${project}/checklists/${checklistId}`,
      { method: "DELETE" },
    );
  }

  addItem(
    ws: string,
    project: string,
    checklistId: string,
    input: CreateChecklistItemInput,
  ): Promise<ChecklistItem> {
    return this.http.request<ChecklistItem>(
      `/workspaces/${ws}/projects/${project}/checklists/${checklistId}/items`,
      {
        method: "POST",
        body: input,
      },
    );
  }

  updateItem(
    ws: string,
    project: string,
    checklistId: string,
    itemId: string,
    input: UpdateChecklistItemInput,
  ): Promise<ChecklistItem> {
    return this.http.request<ChecklistItem>(
      `/workspaces/${ws}/projects/${project}/checklists/${checklistId}/items/${itemId}`,
      {
        method: "PATCH",
        body: input,
      },
    );
  }
}
