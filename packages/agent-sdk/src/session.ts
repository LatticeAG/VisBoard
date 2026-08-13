import {
  AgentLeaseError,
  AgentModeError,
} from "./errors.js";
import type {
  AgentContext,
  AgentFile,
  AgentFileTree,
  AgentMode,
  AgentRun,
  AgentRunAccess,
  AgentRunWithLease,
  AgentScratchpad,
  AgentTransport,
  AgentWorkspace,
  CreateAgentWorkspaceInput,
  GetAgentContextInput,
  Handoff,
  HandoffPacketInput,
  HandoffState,
  StartAgentRunInput,
} from "./types.js";

const MODE_RANK: Record<AgentMode, number> = {
  observe: 0,
  propose: 1,
  contribute: 2,
  operate: 3,
};

const FINAL_HANDOFF_STATES = new Set<HandoffState>([
  "approved",
  "rejected",
  "changes_requested",
  "cancelled",
  "expired",
  "resumed",
]);

export interface StartAgentSessionInput
  extends Omit<StartAgentRunInput, "board_id" | "agent_id" | "mode"> {
  board_id: string;
  agent_id: string;
  mode?: AgentMode;
}

export interface AgentSessionOptions {
  transport: AgentTransport;
  board_id: string;
  agent_id: string;
  mode: AgentMode;
  run: AgentRunWithLease;
}

export interface CreateWorkspaceOptions
  extends Omit<CreateAgentWorkspaceInput, "board_id" | "agent_id" | "access"> {}

export interface WaitForHandoffOptions {
  poll_interval_ms?: number;
  timeout_ms?: number;
  signal?: AbortSignal;
}

/**
 * A framework-neutral, lease-aware agent session. The transport owns server
 * authorization; the session adds ergonomic run/lease propagation and refuses
 * obviously unsafe local calls before they reach a provider adapter.
 */
export class AgentSession {
  private runWithLease: AgentRunWithLease;

  private constructor(private readonly options: AgentSessionOptions) {
    this.runWithLease = options.run;
  }

  static async start(
    transport: AgentTransport,
    input: StartAgentSessionInput,
  ): Promise<AgentSession> {
    const mode = input.mode ?? "contribute";
    const run = await transport.startRun({
      ...input,
      mode,
    });
    return new AgentSession({
      transport,
      board_id: input.board_id,
      agent_id: input.agent_id,
      mode,
      run,
    });
  }

  static attach(options: AgentSessionOptions): AgentSession {
    return new AgentSession(options);
  }

  get boardId(): string {
    return this.options.board_id;
  }

  get agentId(): string {
    return this.options.agent_id;
  }

  get mode(): AgentMode {
    return this.options.mode;
  }

  get run(): Readonly<AgentRun> {
    return this.runWithLease.run;
  }

  get lease() {
    return this.runWithLease.lease;
  }

  async getContext(
    input: Omit<GetAgentContextInput, "board_id">,
  ): Promise<AgentContext> {
    return this.options.transport.getContext({
      ...input,
      board_id: this.boardId,
    });
  }

  async createWorkspace(input: CreateWorkspaceOptions): Promise<AgentWorkspace> {
    this.requireOperate("create_workspace");
    return this.options.transport.createWorkspace({
      ...input,
      board_id: this.boardId,
      agent_id: this.agentId,
      access: this.access(),
    });
  }

  async getWorkspace(agentWorkspaceId: string): Promise<AgentWorkspace> {
    return this.options.transport.getWorkspace({
      board_id: this.boardId,
      agent_workspace_id: agentWorkspaceId,
      access: this.access(),
    });
  }

  async listFiles(
    agentWorkspaceId: string,
    options: { path?: string; cursor?: string; limit?: number } = {},
  ): Promise<AgentFileTree> {
    return this.options.transport.listFiles({
      ...options,
      board_id: this.boardId,
      agent_workspace_id: agentWorkspaceId,
      access: this.access(),
    });
  }

  async readFile(agentWorkspaceId: string, path: string): Promise<AgentFile> {
    return this.options.transport.readFile({
      board_id: this.boardId,
      agent_workspace_id: agentWorkspaceId,
      path,
      access: this.access(),
    });
  }

  async writeFile(
    agentWorkspaceId: string,
    input: { path: string; content: string; expected_etag?: string | null; generated?: boolean },
  ): Promise<AgentFile> {
    this.requireOperate("write_file");
    return this.options.transport.writeFile({
      ...input,
      board_id: this.boardId,
      agent_workspace_id: agentWorkspaceId,
      access: this.access(),
    });
  }

  async deleteFile(
    agentWorkspaceId: string,
    path: string,
    expectedEtag: string,
  ): Promise<void> {
    this.requireOperate("delete_file");
    await this.options.transport.deleteFile({
      board_id: this.boardId,
      agent_workspace_id: agentWorkspaceId,
      path,
      expected_etag: expectedEtag,
      access: this.access(),
    });
  }

  async getScratchpad(agentWorkspaceId: string): Promise<AgentScratchpad> {
    return this.options.transport.getScratchpad({
      board_id: this.boardId,
      agent_workspace_id: agentWorkspaceId,
      access: this.access(),
    });
  }

  async updateScratchpad(
    agentWorkspaceId: string,
    content: string,
    expectedEtag?: string | null,
  ): Promise<AgentScratchpad> {
    this.requireContribute("update_scratchpad");
    return this.options.transport.updateScratchpad({
      board_id: this.boardId,
      agent_workspace_id: agentWorkspaceId,
      content,
      expected_etag: expectedEtag,
      access: this.access(),
    });
  }

  async heartbeat(): Promise<AgentRun> {
    this.requireMutable("heartbeat");
    const run = await this.options.transport.heartbeat({
      board_id: this.boardId,
      access: this.access(),
    });
    this.runWithLease = { ...this.runWithLease, run };
    return run;
  }

  async renewLease(durationMs?: number) {
    this.requireMutable("renew_lease");
    const lease = await this.options.transport.renewLease({
      board_id: this.boardId,
      access: this.access(),
      duration_ms: durationMs,
    });
    this.runWithLease = { ...this.runWithLease, lease };
    return lease;
  }

  async complete(summary: string): Promise<AgentRun> {
    this.requireMutable("complete_run");
    const run = await this.options.transport.completeRun({
      board_id: this.boardId,
      access: this.access(),
      summary,
    });
    this.runWithLease = { ...this.runWithLease, run };
    return run;
  }

  async fail(summary: string): Promise<AgentRun> {
    this.requireMutable("fail_run");
    const run = await this.options.transport.failRun({
      board_id: this.boardId,
      access: this.access(),
      summary,
    });
    this.runWithLease = { ...this.runWithLease, run };
    return run;
  }

  async cancel(): Promise<AgentRun> {
    this.requireMutable("cancel_run");
    const run = await this.options.transport.cancelRun({
      board_id: this.boardId,
      access: this.access(),
    });
    this.runWithLease = { ...this.runWithLease, run };
    return run;
  }

  async createHandoff(
    packet: HandoffPacketInput,
    options: { agent_workspace_id?: string; revision_id?: string } = {},
  ): Promise<Handoff> {
    this.requirePropose("create_handoff");
    return this.options.transport.createHandoff({
      board_id: this.boardId,
      access: this.access(),
      agent_workspace_id: options.agent_workspace_id,
      revision_id: options.revision_id,
      packet,
    });
  }

  async submitHandoff(handoffId: string): Promise<Handoff> {
    this.requireMutable("submit_handoff");
    const handoff = await this.options.transport.submitHandoff({
      board_id: this.boardId,
      access: this.access(),
      handoff_id: handoffId,
    });
    this.runWithLease = {
      run: { ...this.runWithLease.run, state: "waiting_for_human" },
      lease: {
        ...this.runWithLease.lease,
        state: "revoked",
        revoked_at: handoff.submitted_at,
      },
    };
    return handoff;
  }

  async getHandoff(handoffId: string): Promise<Handoff> {
    return this.options.transport.getHandoff({
      board_id: this.boardId,
      handoff_id: handoffId,
    });
  }

  async listHandoffs(state?: HandoffState): Promise<Handoff[]> {
    return this.options.transport.listHandoffs({
      board_id: this.boardId,
      state,
    });
  }

  async waitForHandoffDecision(
    handoffId: string,
    options: WaitForHandoffOptions = {},
  ): Promise<Handoff> {
    const pollInterval = Math.max(25, options.poll_interval_ms ?? 1_000);
    const timeout = options.timeout_ms ?? 5 * 60_000;
    const deadline = Date.now() + timeout;

    while (true) {
      if (options.signal?.aborted) {
        throw new AgentLeaseError("Waiting for handoff decision was aborted", "handoff.wait_aborted");
      }

      const handoff = await this.getHandoff(handoffId);
      if (FINAL_HANDOFF_STATES.has(handoff.state)) return handoff;
      if (Date.now() >= deadline) {
        throw new AgentLeaseError("Timed out waiting for a handoff decision", "handoff.wait_timed_out");
      }
      await wait(pollInterval, options.signal);
    }
  }

  async resumeHandoff(
    handoffId: string,
    options: {
      mode?: AgentMode;
      goal?: string;
      requested_capabilities?: string[];
      allowed_paths?: string[];
      lease_duration_ms?: number;
    } = {},
  ): Promise<AgentSession> {
    const mode = options.mode ?? this.mode;
    const next = await this.options.transport.resumeHandoff({
      board_id: this.boardId,
      handoff_id: handoffId,
      agent_id: this.agentId,
      ...options,
      mode,
    });

    return new AgentSession({
      transport: this.options.transport,
      board_id: this.boardId,
      agent_id: this.agentId,
      mode,
      run: next,
    });
  }

  private access(): AgentRunAccess {
    return {
      run_id: this.runWithLease.run.id,
      lease_id: this.runWithLease.lease.id,
    };
  }

  private requirePropose(operation: string): void {
    if (MODE_RANK[this.mode] < MODE_RANK.propose) {
      throw new AgentModeError(this.mode, operation);
    }
  }

  private requireContribute(operation: string): void {
    if (MODE_RANK[this.mode] < MODE_RANK.contribute) {
      throw new AgentModeError(this.mode, operation);
    }
    this.requireMutable(operation);
  }

  private requireOperate(operation: string): void {
    if (MODE_RANK[this.mode] < MODE_RANK.operate) {
      throw new AgentModeError(this.mode, operation);
    }
    this.requireMutable(operation);
  }

  private requireMutable(operation: string): void {
    if (this.runWithLease.run.state !== "running") {
      throw new AgentLeaseError(
        `Cannot '${operation}' while run is ${this.runWithLease.run.state}`,
        "lease.run_not_mutable",
      );
    }
    if (this.runWithLease.lease.state !== "active") {
      throw new AgentLeaseError(
        `Cannot '${operation}' with a ${this.runWithLease.lease.state} lease`,
        "lease.not_active",
      );
    }
  }
}

function wait(durationMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, durationMs);
    if (!signal) return;
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new AgentLeaseError("Waiting for handoff decision was aborted", "handoff.wait_aborted"));
      },
      { once: true },
    );
  });
}
