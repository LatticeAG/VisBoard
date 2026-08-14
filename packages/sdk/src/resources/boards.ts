import type { HttpClient } from "../http.js";
import type {
  Board,
  BoardBlock,
  BoardCommandInput,
  BoardCommandReceipt,
  BoardDiff,
  BoardRevision,
  BoardState,
  CreateBoardInput,
  CreateBoardRevisionInput,
  RestoreBoardInput,
  UpdateBoardInput,
} from "../types.js";

/** Options shared by V2 commands.  The server keeps the idempotency receipt
 * durable, so callers should retain a key when retrying a command. */
export interface BoardMutationOptions {
  idempotencyKey?: string;
  expectedRevisionId?: string;
  expectedDocumentId?: string;
}

function mutationHeaders(options: BoardMutationOptions = {}): Record<string, string> {
  const headers: Record<string, string> = {};
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  if (options.expectedRevisionId) {
    headers["If-Board-Revision"] = options.expectedRevisionId;
  }
  if (options.expectedDocumentId) {
    headers["If-Board-Document"] = options.expectedDocumentId;
  }
  return headers;
}

/**
 * V2 board API.  Unlike the legacy projects resource, all selectors here are
 * canonical IDs (`ws_` and `brd_`), which makes writes unambiguous.
 */
export class BoardsResource {
  constructor(private readonly http: HttpClient) {}

  list(workspaceId: string): Promise<Board[]> {
    return this.http.requestList<Board>(`/workspaces/${workspaceId}/boards`);
  }

  create(
    workspaceId: string,
    input: CreateBoardInput,
    options: BoardMutationOptions = {},
  ): Promise<Board> {
    return this.http.request<Board>(`/workspaces/${workspaceId}/boards`, {
      method: "POST",
      body: input,
      headers: mutationHeaders(options),
    });
  }

  get(workspaceId: string, boardId: string): Promise<Board> {
    return this.http.request<Board>(`/workspaces/${workspaceId}/boards/${boardId}`);
  }

  update(
    workspaceId: string,
    boardId: string,
    input: UpdateBoardInput,
    options: BoardMutationOptions = {},
  ): Promise<Board> {
    return this.http.request<Board>(`/workspaces/${workspaceId}/boards/${boardId}`, {
      method: "PATCH",
      body: input,
      headers: mutationHeaders(options),
    });
  }

  getState(
    workspaceId: string,
    boardId: string,
    options: { atRevision?: string } = {},
  ): Promise<BoardState> {
    return this.http.request<BoardState>(`/workspaces/${workspaceId}/boards/${boardId}/state`, {
      query: { at_revision: options.atRevision },
    });
  }

  getBlock(workspaceId: string, boardId: string, blockId: string): Promise<BoardBlock> {
    return this.http.request<BoardBlock>(
      `/workspaces/${workspaceId}/boards/${boardId}/blocks/${blockId}`,
    );
  }

  command(
    workspaceId: string,
    boardId: string,
    command: BoardCommandInput,
    options: BoardMutationOptions = {},
  ): Promise<BoardCommandReceipt> {
    return this.http.request<BoardCommandReceipt>(
      `/workspaces/${workspaceId}/boards/${boardId}/commands`,
      {
        method: "POST",
        body: command,
        headers: mutationHeaders(options),
      },
    );
  }

  listRevisions(workspaceId: string, boardId: string): Promise<BoardRevision[]> {
    return this.http.requestList<BoardRevision>(
      `/workspaces/${workspaceId}/boards/${boardId}/revisions`,
    );
  }

  captureRevision(
    workspaceId: string,
    boardId: string,
    input: CreateBoardRevisionInput = {},
    options: BoardMutationOptions = {},
  ): Promise<BoardRevision> {
    return this.http.request<BoardRevision>(
      `/workspaces/${workspaceId}/boards/${boardId}/revisions`,
      {
        method: "POST",
        body: input,
        headers: mutationHeaders(options),
      },
    );
  }

  getRevision(workspaceId: string, boardId: string, revisionId: string): Promise<BoardRevision> {
    return this.http.request<BoardRevision>(
      `/workspaces/${workspaceId}/boards/${boardId}/revisions/${revisionId}`,
    );
  }

  diff(workspaceId: string, boardId: string, from: string, to: string): Promise<BoardDiff> {
    return this.http.request<BoardDiff>(`/workspaces/${workspaceId}/boards/${boardId}/diff`, {
      query: { from, to },
    });
  }

  restore(
    workspaceId: string,
    boardId: string,
    input: RestoreBoardInput,
    options: BoardMutationOptions = {},
  ): Promise<BoardRevision> {
    return this.http.request<BoardRevision>(
      `/workspaces/${workspaceId}/boards/${boardId}/restore`,
      {
        method: "POST",
        body: input,
        headers: mutationHeaders(options),
      },
    );
  }

  installTemplate(
    workspaceId: string,
    boardId: string,
    input: { template_version_id: string; variables?: Record<string, unknown> },
    options: BoardMutationOptions = {},
  ): Promise<{
    installation: Record<string, unknown>;
    blocks: BoardBlock[];
    revision: BoardRevision;
  }> {
    return this.http.request<{
      installation: Record<string, unknown>;
      blocks: BoardBlock[];
      revision: BoardRevision;
    }>(`/workspaces/${workspaceId}/boards/${boardId}/template-installations`, {
      method: "POST",
      body: input,
      headers: mutationHeaders(options),
    });
  }
}
