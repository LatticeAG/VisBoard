import type { RequestOptions, VisBoardClient } from "@visboard/sdk";
import type {
  AgentContext,
  AgentFile,
  AgentFileTree,
  AgentLease,
  AgentRun,
  AgentRunWithLease,
  AgentScratchpad,
  AgentTransport,
  AgentWorkspace,
  ClaimHandoffInput,
  CompleteAgentRunInput,
  CreateAgentWorkspaceInput,
  CreateHandoffInput,
  DecideHandoffInput,
  DeleteAgentFileInput,
  FailAgentRunInput,
  GetAgentContextInput,
  GetHandoffInput,
  Handoff,
  ListAgentFilesInput,
  ListHandoffsInput,
  ReadAgentFileInput,
  RenewAgentLeaseInput,
  ResumeHandoffInput,
  RunMutationInput,
  ScopedAgentWorkspaceInput,
  StartAgentRunInput,
  SubmitHandoffInput,
  UpdateAgentScratchpadInput,
  WriteAgentFileInput,
} from "./types.js";

/** The minimal public surface supplied by the ordinary @visboard/sdk client. */
export interface AgentHttpClient {
  readonly baseUrl: string;
  request<T>(path: string, options?: RequestOptions): Promise<T>;
}

export interface HttpAgentTransportOptions {
  /** A VisBoardClient is structurally compatible with this interface. */
  client: AgentHttpClient | VisBoardClient;
  workspace_id: string;
  /** Override when the SDK client is pointed at a nonstandard API version. */
  v2_base_url?: string;
}

/**
 * Optional V2 adapter for AgentSession. It delegates serialization, auth, and
 * RFC 7807 error handling to the ordinary SDK's public request escape hatch.
 *
 * The server remains the authorization authority. Mutating bodies retain the
 * explicit run/lease pair so a route cannot accidentally treat a static agent
 * credential as mutable execution authority.
 */
export class HttpAgentTransport implements AgentTransport {
  private readonly client: AgentHttpClient;
  private readonly workspaceId: string;
  private readonly v2BaseUrl: string;

  constructor(options: HttpAgentTransportOptions) {
    this.client = options.client;
    this.workspaceId = options.workspace_id;
    this.v2BaseUrl = (options.v2_base_url ?? deriveV2BaseUrl(options.client.baseUrl)).replace(
      /\/$/,
      "",
    );
  }

  getContext(input: GetAgentContextInput): Promise<AgentContext> {
    return this.client.request(this.boardPath(input.board_id, "/context"), {
      query: compactQuery({
        purpose: input.purpose,
        at_revision: input.at_revision,
        block_ids: input.block_ids?.join(","),
        include_agents_md: input.include_agents_md,
      }),
    });
  }

  createWorkspace(input: CreateAgentWorkspaceInput): Promise<AgentWorkspace> {
    return this.client.request(this.boardPath(input.board_id, "/agent-workspaces"), {
      method: "POST",
      body: input,
    });
  }

  getWorkspace(input: ScopedAgentWorkspaceInput): Promise<AgentWorkspace> {
    return this.client.request(this.workspacePath(input.board_id, input.agent_workspace_id), {
      headers: accessHeaders(input.access),
    });
  }

  listFiles(input: ListAgentFilesInput): Promise<AgentFileTree> {
    return this.client.request(
      this.workspacePath(input.board_id, input.agent_workspace_id, "/tree"),
      {
        headers: accessHeaders(input.access),
        query: compactQuery({
          path: input.path,
          cursor: input.cursor,
          limit: input.limit,
        }),
      },
    );
  }

  readFile(input: ReadAgentFileInput): Promise<AgentFile> {
    return this.client.request(
      this.filePath(input.board_id, input.agent_workspace_id, input.path),
      {
        headers: accessHeaders(input.access),
      },
    );
  }

  writeFile(input: WriteAgentFileInput): Promise<AgentFile> {
    return this.client.request(
      this.filePath(input.board_id, input.agent_workspace_id, input.path),
      {
        method: "PUT",
        body: {
          content: input.content,
          expected_etag: input.expected_etag,
          generated: input.generated,
          access: input.access,
        },
      },
    );
  }

  deleteFile(input: DeleteAgentFileInput): Promise<void> {
    return this.client.request(
      this.filePath(input.board_id, input.agent_workspace_id, input.path),
      {
        method: "DELETE",
        body: {
          expected_etag: input.expected_etag,
          access: input.access,
        },
      },
    );
  }

  getScratchpad(input: ScopedAgentWorkspaceInput): Promise<AgentScratchpad> {
    return this.client.request(
      this.workspacePath(input.board_id, input.agent_workspace_id, "/scratchpad"),
      {
        headers: accessHeaders(input.access),
      },
    );
  }

  updateScratchpad(input: UpdateAgentScratchpadInput): Promise<AgentScratchpad> {
    return this.client.request(
      this.workspacePath(input.board_id, input.agent_workspace_id, "/scratchpad"),
      {
        method: "PUT",
        body: {
          content: input.content,
          expected_etag: input.expected_etag,
          access: input.access,
        },
      },
    );
  }

  startRun(input: StartAgentRunInput): Promise<AgentRunWithLease> {
    return this.client.request(this.boardPath(input.board_id, "/agent-runs"), {
      method: "POST",
      body: input,
    });
  }

  getRun(input: { board_id: string; run_id: string }): Promise<AgentRun> {
    return this.client.request(
      this.boardPath(input.board_id, `/agent-runs/${encodeSegment(input.run_id)}`),
    );
  }

  heartbeat(input: RunMutationInput): Promise<AgentRun> {
    return this.client.request(this.runPath(input.board_id, input.access.run_id, "/heartbeats"), {
      method: "POST",
      body: { access: input.access },
    });
  }

  renewLease(input: RenewAgentLeaseInput): Promise<AgentLease> {
    return this.client.request(
      this.runPath(input.board_id, input.access.run_id, "/lease-renewals"),
      {
        method: "POST",
        body: { access: input.access, duration_ms: input.duration_ms },
      },
    );
  }

  completeRun(input: CompleteAgentRunInput): Promise<AgentRun> {
    return this.client.request(this.runPath(input.board_id, input.access.run_id, "/complete"), {
      method: "POST",
      body: { access: input.access, summary: input.summary },
    });
  }

  failRun(input: FailAgentRunInput): Promise<AgentRun> {
    return this.client.request(this.runPath(input.board_id, input.access.run_id, "/fail"), {
      method: "POST",
      body: { access: input.access, summary: input.summary },
    });
  }

  cancelRun(input: RunMutationInput): Promise<AgentRun> {
    return this.client.request(this.runPath(input.board_id, input.access.run_id, "/cancel"), {
      method: "POST",
      body: { access: input.access },
    });
  }

  createHandoff(input: CreateHandoffInput): Promise<Handoff> {
    return this.client.request(this.boardPath(input.board_id, "/handoffs"), {
      method: "POST",
      body: input,
    });
  }

  listHandoffs(input: ListHandoffsInput): Promise<Handoff[]> {
    return this.client.request(this.boardPath(input.board_id, "/handoffs"), {
      query: compactQuery({ state: input.state }),
    });
  }

  getHandoff(input: GetHandoffInput): Promise<Handoff> {
    return this.client.request(this.handoffPath(input.board_id, input.handoff_id));
  }

  submitHandoff(input: SubmitHandoffInput): Promise<Handoff> {
    return this.client.request(this.handoffPath(input.board_id, input.handoff_id, "/submit"), {
      method: "POST",
      body: { access: input.access },
    });
  }

  claimHandoff(input: ClaimHandoffInput): Promise<Handoff> {
    return this.client.request(this.handoffPath(input.board_id, input.handoff_id, "/claim"), {
      method: "POST",
      body: { reviewer_id: input.reviewer_id },
    });
  }

  decideHandoff(input: DecideHandoffInput): Promise<Handoff> {
    return this.client.request(this.handoffPath(input.board_id, input.handoff_id, "/decisions"), {
      method: "POST",
      body: {
        reviewer_id: input.reviewer_id,
        outcome: input.outcome,
        rationale: input.rationale,
        conditions: input.conditions,
      },
    });
  }

  resumeHandoff(input: ResumeHandoffInput): Promise<AgentRunWithLease> {
    return this.client.request(this.handoffPath(input.board_id, input.handoff_id, "/resume"), {
      method: "POST",
      body: {
        agent_id: input.agent_id,
        mode: input.mode,
        goal: input.goal,
        requested_capabilities: input.requested_capabilities,
        allowed_paths: input.allowed_paths,
        lease_duration_ms: input.lease_duration_ms,
      },
    });
  }

  private boardPath(boardId: string, suffix = ""): string {
    return `${this.v2BaseUrl}/workspaces/${encodeSegment(this.workspaceId)}/boards/${encodeSegment(boardId)}${suffix}`;
  }

  private workspacePath(boardId: string, workspaceId: string, suffix = ""): string {
    return `${this.boardPath(boardId, "/agent-workspaces")}/${encodeSegment(workspaceId)}${suffix}`;
  }

  private filePath(boardId: string, workspaceId: string, path: string): string {
    return `${this.workspacePath(boardId, workspaceId, "/files")}/${encodePath(path)}`;
  }

  private runPath(boardId: string, runId: string, suffix: string): string {
    return this.boardPath(boardId, `/agent-runs/${encodeSegment(runId)}${suffix}`);
  }

  private handoffPath(boardId: string, handoffId: string, suffix = ""): string {
    return this.boardPath(boardId, `/handoffs/${encodeSegment(handoffId)}${suffix}`);
  }
}

function deriveV2BaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  return `${trimmed.replace(/\/v\d+(?:\.\d+)?$/, "")}/v2`;
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}

function encodePath(value: string): string {
  return value.split("/").map(encodeSegment).join("/");
}

function accessHeaders(access: { run_id: string; lease_id: string }): Record<string, string> {
  return {
    "X-Visboard-Run-Id": access.run_id,
    "X-Visboard-Lease-Id": access.lease_id,
  };
}

function compactQuery(
  values: Record<string, string | number | boolean | undefined>,
): Record<string, string | number | boolean | undefined> {
  return values;
}
