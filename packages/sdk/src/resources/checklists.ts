import type { HttpClient } from "../http.js";
import type {
  ChecklistItem,
  ChecklistWithItems,
  CreateChecklistInput,
  CreateChecklistItemInput,
  UpdateChecklistInput,
  UpdateChecklistItemInput,
} from "../types.js";

function isChecklistItem(value: ChecklistItem | ChecklistWithItems): value is ChecklistItem {
  return "checklist_id" in value && !("items" in value);
}

function extractChecklistItem(
  response: ChecklistItem | ChecklistWithItems,
  checklistId: string,
  opts?: { itemId?: string; text?: string },
): ChecklistItem {
  if (isChecklistItem(response)) {
    return response;
  }

  const items = response.items ?? [];
  let match: (typeof items)[number] | undefined;

  if (opts?.itemId) {
    match = items.find((item) => item.id === opts.itemId);
  } else if (opts?.text) {
    const matches = items.filter((item) => item.text === opts.text);
    if (matches.length === 1) {
      match = matches[0];
    }
  }

  if (!match) {
    const sorted = [...items].sort((a, b) => b.sort_order - a.sort_order);
    match = sorted[0];
  }

  if (!match) {
    throw new Error("Checklist item not found in API response");
  }

  return {
    ...match,
    checklist_id: checklistId,
  };
}

export class ChecklistsResource {
  constructor(private readonly http: HttpClient) {}

  list(ws: string, project: string): Promise<ChecklistWithItems[]> {
    return this.http.requestList<ChecklistWithItems>(
      `/workspaces/${ws}/projects/${project}/checklists`,
    );
  }

  create(ws: string, project: string, input: CreateChecklistInput): Promise<ChecklistWithItems> {
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
    return this.http
      .request<ChecklistItem | ChecklistWithItems>(
        `/workspaces/${ws}/projects/${project}/checklists/${checklistId}/items`,
        {
          method: "POST",
          body: input,
        },
      )
      .then((response) => extractChecklistItem(response, checklistId, { text: input.text }));
  }

  updateItem(
    ws: string,
    project: string,
    checklistId: string,
    itemId: string,
    input: UpdateChecklistItemInput,
  ): Promise<ChecklistItem> {
    return this.http
      .request<ChecklistItem | ChecklistWithItems>(
        `/workspaces/${ws}/projects/${project}/checklists/${checklistId}/items/${itemId}`,
        {
          method: "PATCH",
          body: input,
        },
      )
      .then((response) => extractChecklistItem(response, checklistId, { itemId }));
  }
}
