import type { HttpClient } from "../http.js";
import type {
  BoardTemplate,
  CreateBoardTemplateInput,
  PublishTemplateVersionInput,
  TemplateVersion,
} from "../types.js";
import type { BoardMutationOptions } from "./boards.js";

function headers(options: BoardMutationOptions = {}): Record<string, string> {
  return options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {};
}

export class TemplatesResource {
  constructor(private readonly http: HttpClient) {}

  list(params: { scope?: string } = {}): Promise<BoardTemplate[]> {
    return this.http.requestList<BoardTemplate>("/templates", {
      query: { scope: params.scope },
    });
  }

  create(
    input: CreateBoardTemplateInput,
    options: BoardMutationOptions = {},
  ): Promise<BoardTemplate> {
    return this.http.request<BoardTemplate>("/templates", {
      method: "POST",
      body: input,
      headers: headers(options),
    });
  }

  publishVersion(
    templateId: string,
    input: PublishTemplateVersionInput,
    options: BoardMutationOptions = {},
  ): Promise<TemplateVersion> {
    return this.http.request<TemplateVersion>(`/templates/${templateId}/versions`, {
      method: "POST",
      body: input,
      headers: headers(options),
    });
  }
}
