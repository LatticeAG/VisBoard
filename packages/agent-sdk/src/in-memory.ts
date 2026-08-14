import { hashBeliefTrace, requireBeliefTraceForSubmit } from "./belief-trace.js";
import {
  AgentConflictError,
  AgentIsolationError,
  AgentLeaseError,
  AgentModeError,
  HandoffStateError,
} from "./errors.js";
import { checksum, hash } from "./serialize.js";
import type {
  AgentContext,
  AgentFile,
  AgentFileEntry,
  AgentFileTree,
  AgentLease,
  AgentRun,
  AgentRunAccess,
  AgentRunWithLease,
  AgentScratchpad,
  AgentTransport,
  AgentWorkspace,
  AgentWorkspaceSnapshot,
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
  HandoffDecision,
  HandoffPacket,
  HandoffPacketInput,
  HandoffState,
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

type MutableFile = {
  content: string;
  version: number;
  generated: boolean;
  updated_at: string;
};

type MutableScratchpad = {
  content: string;
  version: number;
  updated_at: string;
};

type MutableWorkspace = {
  workspace: AgentWorkspace;
  files: Map<string, MutableFile>;
  scratchpad: MutableScratchpad;
  snapshots: Map<string, AgentWorkspaceSnapshot>;
};

const MODE_RANK = {
  observe: 0,
  propose: 1,
  contribute: 2,
  operate: 3,
} as const;

export interface InMemoryAgentTransportOptions {
  /** Injected only for deterministic tests; production adapters should use a durable store. */
  now?: () => Date;
  default_lease_duration_ms?: number;
}

/**
 * A reference adapter for local development and contract tests.
 *
 * It intentionally models the V3 safety boundary rather than pretending to be
 * a remote filesystem: every mutable operation names a run lease, each run is
 * tied to one board/workspace, paths are rooted and normalized, and submission
 * freezes the originating run before returning the handoff receipt.
 */
export class InMemoryAgentTransport implements AgentTransport {
  private readonly now: () => Date;
  private readonly defaultLeaseDurationMs: number;
  private idCounter = 0;
  private readonly contexts = new Map<string, AgentContext>();
  private readonly workspaces = new Map<string, MutableWorkspace>();
  private readonly runs = new Map<string, AgentRun>();
  private readonly leases = new Map<string, AgentLease>();
  private readonly handoffs = new Map<string, Handoff>();

  constructor(options: InMemoryAgentTransportOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.defaultLeaseDurationMs = clampLeaseDuration(
      options.default_lease_duration_ms ?? 15 * 60_000,
    );
  }

  /** Seed a policy-filtered context bundle for a board in local tests. */
  setContext(context: AgentContext): void {
    this.contexts.set(context.board_id, copy(context));
  }

  async getContext(input: GetAgentContextInput): Promise<AgentContext> {
    const existing = this.contexts.get(input.board_id);
    if (existing) {
      const context = copy(existing);
      context.purpose = input.purpose;
      if (input.at_revision !== undefined) context.revision_id = input.at_revision;
      if (input.include_agents_md === false) context.agents_md = null;
      if (input.block_ids?.length) {
        context.blocks = context.blocks.filter((block) => input.block_ids?.includes(block.id));
      }
      return context;
    }

    return {
      board_id: input.board_id,
      revision_id: input.at_revision ?? null,
      document_id: null,
      purpose: input.purpose,
      blocks: [],
      agents_md: input.include_agents_md === false ? null : "# AGENTS.md\n",
      active_handoff_id: this.findActiveHandoff(input.board_id),
      allowed_capabilities: [],
      token_estimate: 0,
      omitted: [],
    };
  }

  async createWorkspace(input: CreateAgentWorkspaceInput): Promise<AgentWorkspace> {
    const access = requireAccess(input.access);
    const run = this.requireMutableRun(input.board_id, access);
    this.requireMode(run, "operate", "create_workspace");
    if (run.agent_id !== input.agent_id) {
      throw new AgentIsolationError("An agent can only create its own workspace");
    }
    if (run.agent_workspace_id) {
      throw new AgentConflictError("This run is already bound to an agent workspace");
    }

    const timestamp = this.timestamp();
    const id = this.nextId("aws");
    const workspace: AgentWorkspace = {
      id,
      board_id: input.board_id,
      agent_id: input.agent_id,
      profile: input.profile,
      state: "ready",
      source: input.source ?? null,
      branch: input.branch ?? null,
      root_label: input.root_label ?? "workspace",
      quota_bytes: input.quota_bytes ?? null,
      latest_snapshot_id: null,
      created_at: timestamp,
      updated_at: timestamp,
    };

    this.workspaces.set(id, {
      workspace,
      files: new Map(),
      scratchpad: { content: "", version: 1, updated_at: timestamp },
      snapshots: new Map(),
    });
    run.agent_workspace_id = id;
    return copy(workspace);
  }

  async getWorkspace(input: ScopedAgentWorkspaceInput): Promise<AgentWorkspace> {
    const mutable = this.requireWorkspaceReadAccess(input);
    return copy(mutable.workspace);
  }

  async listFiles(input: ListAgentFilesInput): Promise<AgentFileTree> {
    const mutable = this.requireWorkspaceReadAccess(input);
    const base = normalizePath(input.path ?? "", true);
    const entries = this.listDirectory(mutable, base);
    const start = parseCursor(input.cursor);
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
    const page = entries.slice(start, start + limit);
    const next = start + page.length < entries.length ? String(start + page.length) : null;
    return { entries: page, next_cursor: next };
  }

  async readFile(input: ReadAgentFileInput): Promise<AgentFile> {
    const mutable = this.requireWorkspaceReadAccess(input);
    const path = this.assertPathAllowed(input.access, input.path);
    const file = mutable.files.get(path);
    if (!file) throw new AgentIsolationError(`File '${path}' was not found`);
    return formatFile(path, file);
  }

  async writeFile(input: WriteAgentFileInput): Promise<AgentFile> {
    const mutable = this.requireWorkspaceMutableAccess(input, "operate", "write_file");
    const path = this.assertPathAllowed(input.access, input.path);
    const current = mutable.files.get(path);

    if (current && input.expected_etag !== fileEtag(current)) {
      throw new AgentConflictError(
        `File '${path}' changed; fetch it and retry with its current ETag`,
      );
    }
    if (!current && input.expected_etag !== undefined && input.expected_etag !== null) {
      throw new AgentConflictError(`File '${path}' does not exist; create it without an ETag`);
    }

    const next: MutableFile = {
      content: input.content,
      version: (current?.version ?? 0) + 1,
      generated: input.generated ?? current?.generated ?? false,
      updated_at: this.timestamp(),
    };
    this.assertWorkspaceQuota(mutable, path, next);
    mutable.files.set(path, next);
    this.touchWorkspace(mutable);
    return formatFile(path, next);
  }

  async deleteFile(input: DeleteAgentFileInput): Promise<void> {
    const mutable = this.requireWorkspaceMutableAccess(input, "operate", "delete_file");
    const path = this.assertPathAllowed(input.access, input.path);
    const current = mutable.files.get(path);
    if (!current) throw new AgentIsolationError(`File '${path}' was not found`);
    if (input.expected_etag !== fileEtag(current)) {
      throw new AgentConflictError(
        `File '${path}' changed; fetch it and retry with its current ETag`,
      );
    }
    mutable.files.delete(path);
    this.touchWorkspace(mutable);
  }

  async getScratchpad(input: ScopedAgentWorkspaceInput): Promise<AgentScratchpad> {
    const mutable = this.requireWorkspaceReadAccess(input);
    return formatScratchpad(input.agent_workspace_id, mutable.scratchpad);
  }

  async updateScratchpad(input: UpdateAgentScratchpadInput): Promise<AgentScratchpad> {
    const mutable = this.requireWorkspaceMutableAccess(input, "contribute", "update_scratchpad");
    const currentEtag = scratchpadEtag(mutable.scratchpad);
    if (
      input.expected_etag !== undefined &&
      input.expected_etag !== null &&
      input.expected_etag !== currentEtag
    ) {
      throw new AgentConflictError("Scratchpad changed; fetch it and retry with its current ETag");
    }
    mutable.scratchpad = {
      content: input.content,
      version: mutable.scratchpad.version + 1,
      updated_at: this.timestamp(),
    };
    this.touchWorkspace(mutable);
    return formatScratchpad(input.agent_workspace_id, mutable.scratchpad);
  }

  async startRun(input: StartAgentRunInput): Promise<AgentRunWithLease> {
    if (input.resumed_from_handoff_id) {
      const handoff = this.requireHandoff(input.board_id, input.resumed_from_handoff_id);
      if (!isResumable(handoff.state)) {
        throw new HandoffStateError(
          "A new lease requires an approved or changes-requested handoff",
        );
      }
    } else if (this.hasFrozenHandoff(input.board_id, input.agent_id)) {
      throw new AgentLeaseError(
        "The agent has an active handoff freeze for this board",
        "lease.handoff_frozen",
      );
    }

    if (input.agent_workspace_id) {
      const workspace = this.requireWorkspace(input.agent_workspace_id);
      if (
        workspace.workspace.board_id !== input.board_id ||
        workspace.workspace.agent_id !== input.agent_id
      ) {
        throw new AgentIsolationError("Agent run cannot attach another board or agent's workspace");
      }
    }

    const timestamp = this.timestamp();
    const run: AgentRun = {
      id: this.nextId("arun"),
      board_id: input.board_id,
      agent_id: input.agent_id,
      agent_workspace_id: input.agent_workspace_id ?? null,
      mode: input.mode,
      state: "running",
      goal: input.goal,
      base_revision_id: input.base_revision_id ?? null,
      started_at: timestamp,
      ended_at: null,
      summary: null,
    };
    const duration = clampLeaseDuration(input.lease_duration_ms ?? this.defaultLeaseDurationMs);
    const lease: AgentLease = {
      id: this.nextId("lease"),
      run_id: run.id,
      capabilities: [...(input.requested_capabilities ?? [])],
      allowed_paths: normalizeAllowedPaths(input.allowed_paths ?? [""]),
      state: "active",
      issued_at: timestamp,
      expires_at: new Date(this.now().getTime() + duration).toISOString(),
      revoked_at: null,
    };
    this.runs.set(run.id, run);
    this.leases.set(lease.id, lease);
    return { run: copy(run), lease: copy(lease) };
  }

  async getRun(input: { board_id: string; run_id: string }): Promise<AgentRun> {
    const run = this.requireRun(input.board_id, input.run_id);
    return copy(run);
  }

  async heartbeat(input: RunMutationInput): Promise<AgentRun> {
    const run = this.requireMutableRun(input.board_id, input.access);
    return copy(run);
  }

  async renewLease(input: RenewAgentLeaseInput): Promise<AgentLease> {
    this.requireMutableRun(input.board_id, input.access);
    const lease = this.requireLease(input.access.lease_id, input.access.run_id);
    const duration = clampLeaseDuration(input.duration_ms ?? this.defaultLeaseDurationMs);
    lease.expires_at = new Date(this.now().getTime() + duration).toISOString();
    return copy(lease);
  }

  async completeRun(input: CompleteAgentRunInput): Promise<AgentRun> {
    return this.finishRun(input, "completed", input.summary);
  }

  async failRun(input: FailAgentRunInput): Promise<AgentRun> {
    return this.finishRun(input, "failed", input.summary);
  }

  async cancelRun(input: RunMutationInput): Promise<AgentRun> {
    return this.finishRun(input, "cancelled", "Cancelled");
  }

  async createHandoff(input: CreateHandoffInput): Promise<Handoff> {
    const run = this.requireMutableRun(input.board_id, input.access);
    this.requireMode(run, "propose", "create_handoff");
    const workspaceId = input.agent_workspace_id ?? run.agent_workspace_id;
    if (workspaceId !== null && workspaceId !== undefined) {
      this.assertRunWorkspace(run, workspaceId);
    }

    const timestamp = this.timestamp();
    const handoff: Handoff = {
      id: this.nextId("hof"),
      board_id: input.board_id,
      originating_run_id: run.id,
      agent_workspace_id: workspaceId ?? null,
      revision_id: input.revision_id ?? input.packet.source_revision_id ?? run.base_revision_id,
      state: "draft",
      packet: normalizePacket(input.packet),
      packet_hash: null,
      belief_trace_hash: null,
      claimed_by_id: null,
      submitted_at: null,
      decided_at: null,
      resumed_at: null,
      decisions: [],
      created_at: timestamp,
      updated_at: timestamp,
    };
    this.handoffs.set(handoff.id, handoff);
    return copy(handoff);
  }

  async getHandoff(input: GetHandoffInput): Promise<Handoff> {
    return copy(this.requireHandoff(input.board_id, input.handoff_id));
  }

  async listHandoffs(input: ListHandoffsInput): Promise<Handoff[]> {
    return [...this.handoffs.values()]
      .filter(
        (handoff) =>
          handoff.board_id === input.board_id &&
          (input.state === undefined || handoff.state === input.state),
      )
      .sort((left, right) => left.created_at.localeCompare(right.created_at))
      .map(copy);
  }

  async submitHandoff(input: SubmitHandoffInput): Promise<Handoff> {
    const run = this.requireMutableRun(input.board_id, input.access);
    this.requireMode(run, "propose", "submit_handoff");
    const handoff = this.requireHandoff(input.board_id, input.handoff_id);
    if (handoff.originating_run_id !== run.id) {
      throw new AgentIsolationError("Only the originating run can submit this handoff");
    }
    if (handoff.state !== "draft") {
      throw new HandoffStateError("Only a draft handoff can be submitted");
    }

    const trace = requireBeliefTraceForSubmit(handoff.packet);
    const snapshot = handoff.agent_workspace_id
      ? this.snapshotWorkspace(handoff.agent_workspace_id)
      : null;
    handoff.packet = {
      ...handoff.packet,
      belief_trace: trace,
      workspace_snapshot: snapshot,
      source_revision_id: handoff.revision_id,
    };
    handoff.packet_hash = checksum(handoff.packet);
    handoff.belief_trace_hash = hashBeliefTrace(trace);
    handoff.state = "awaiting_review";
    handoff.submitted_at = this.timestamp();
    handoff.updated_at = handoff.submitted_at;

    // The in-memory adapter deliberately performs the state transition and
    // lease revocation together before any caller receives the handoff.
    run.state = "waiting_for_human";
    const lease = this.requireLease(input.access.lease_id, run.id);
    lease.state = "revoked";
    lease.revoked_at = handoff.submitted_at;
    return copy(handoff);
  }

  async claimHandoff(input: ClaimHandoffInput): Promise<Handoff> {
    const handoff = this.requireHandoff(input.board_id, input.handoff_id);
    if (handoff.state !== "awaiting_review" && handoff.state !== "in_review") {
      throw new HandoffStateError("Only a pending handoff can be claimed");
    }
    if (handoff.claimed_by_id && handoff.claimed_by_id !== input.reviewer_id) {
      throw new AgentConflictError("This handoff is already claimed by another reviewer");
    }
    handoff.claimed_by_id = input.reviewer_id;
    handoff.state = "in_review";
    handoff.updated_at = this.timestamp();
    return copy(handoff);
  }

  async decideHandoff(input: DecideHandoffInput): Promise<Handoff> {
    const handoff = this.requireHandoff(input.board_id, input.handoff_id);
    if (handoff.state !== "awaiting_review" && handoff.state !== "in_review") {
      throw new HandoffStateError("Only a submitted handoff can receive a decision");
    }
    if (handoff.claimed_by_id && handoff.claimed_by_id !== input.reviewer_id) {
      throw new AgentIsolationError("Only the claimed reviewer can decide this handoff");
    }
    if (!handoff.packet_hash) {
      throw new HandoffStateError("A decision cannot be made before packet sealing");
    }

    const timestamp = this.timestamp();
    const decision: HandoffDecision = {
      id: this.nextId("hdec"),
      handoff_id: handoff.id,
      reviewer_id: input.reviewer_id,
      outcome: input.outcome,
      rationale: input.rationale ?? null,
      conditions: copy(input.conditions ?? {}),
      packet_hash: handoff.packet_hash,
      created_at: timestamp,
    };
    handoff.decisions.push(decision);
    handoff.state = decisionState(input.outcome);
    handoff.decided_at = timestamp;
    handoff.updated_at = timestamp;
    return copy(handoff);
  }

  async resumeHandoff(input: ResumeHandoffInput): Promise<AgentRunWithLease> {
    const handoff = this.requireHandoff(input.board_id, input.handoff_id);
    if (!isResumable(handoff.state)) {
      throw new HandoffStateError(
        "The handoff needs an eligible human decision before it can resume",
      );
    }
    const origin = this.requireRun(input.board_id, handoff.originating_run_id);
    if (origin.agent_id !== input.agent_id) {
      throw new AgentIsolationError("A handoff can only resume its originating agent identity");
    }

    const next = await this.startRun({
      board_id: input.board_id,
      agent_id: input.agent_id,
      mode: input.mode ?? origin.mode,
      goal: input.goal ?? origin.goal,
      base_revision_id: handoff.revision_id ?? origin.base_revision_id ?? undefined,
      agent_workspace_id: handoff.agent_workspace_id ?? undefined,
      requested_capabilities: input.requested_capabilities,
      allowed_paths: input.allowed_paths,
      lease_duration_ms: input.lease_duration_ms,
      resumed_from_handoff_id: handoff.id,
    });
    handoff.state = "resumed";
    handoff.resumed_at = this.timestamp();
    handoff.updated_at = handoff.resumed_at;
    return next;
  }

  private async finishRun(
    input: CompleteAgentRunInput | FailAgentRunInput | RunMutationInput,
    state: Extract<AgentRun["state"], "completed" | "failed" | "cancelled">,
    summary: string,
  ): Promise<AgentRun> {
    const run = this.requireMutableRun(input.board_id, input.access);
    run.state = state;
    run.summary = summary;
    run.ended_at = this.timestamp();
    const lease = this.requireLease(input.access.lease_id, run.id);
    lease.state = "revoked";
    lease.revoked_at = run.ended_at;
    return copy(run);
  }

  private requireWorkspaceReadAccess(input: ScopedAgentWorkspaceInput): MutableWorkspace {
    const run = this.requireRunForAccess(input.board_id, input.access);
    const mutable = this.requireWorkspace(input.agent_workspace_id);
    this.assertRunWorkspace(run, mutable.workspace.id);
    return mutable;
  }

  private requireWorkspaceMutableAccess(
    input: ScopedAgentWorkspaceInput,
    minimumMode: keyof typeof MODE_RANK,
    operation: string,
  ): MutableWorkspace {
    const run = this.requireMutableRun(input.board_id, input.access);
    this.requireMode(run, minimumMode, operation);
    const mutable = this.requireWorkspace(input.agent_workspace_id);
    this.assertRunWorkspace(run, mutable.workspace.id);
    return mutable;
  }

  private requireRunForAccess(boardId: string, access: AgentRunAccess): AgentRun {
    const run = this.requireRun(boardId, access.run_id);
    this.requireLease(access.lease_id, run.id);
    return run;
  }

  private requireMutableRun(boardId: string, access: AgentRunAccess): AgentRun {
    const run = this.requireRunForAccess(boardId, access);
    const lease = this.requireLease(access.lease_id, run.id);
    if (lease.state !== "active") {
      throw new AgentLeaseError("This run lease is no longer active", "lease.not_active");
    }
    if (new Date(lease.expires_at).getTime() <= this.now().getTime()) {
      lease.state = "expired";
      throw new AgentLeaseError("This run lease has expired", "lease.expired");
    }
    if (run.state !== "running") {
      throw new AgentLeaseError(
        `Run is ${run.state} and cannot mutate state`,
        "lease.run_not_mutable",
      );
    }
    return run;
  }

  private requireMode(run: AgentRun, minimumMode: keyof typeof MODE_RANK, operation: string): void {
    if (MODE_RANK[run.mode] < MODE_RANK[minimumMode]) {
      throw new AgentModeError(run.mode, operation);
    }
  }

  private requireRun(boardId: string, runId: string): AgentRun {
    const run = this.runs.get(runId);
    if (!run || run.board_id !== boardId) {
      throw new AgentIsolationError("Run does not belong to this board");
    }
    return run;
  }

  private requireLease(leaseId: string, runId: string): AgentLease {
    const lease = this.leases.get(leaseId);
    if (!lease || lease.run_id !== runId) {
      throw new AgentLeaseError("Lease does not belong to this run", "lease.invalid");
    }
    return lease;
  }

  private requireWorkspace(workspaceId: string): MutableWorkspace {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) throw new AgentIsolationError("Agent workspace was not found");
    return workspace;
  }

  private requireHandoff(boardId: string, handoffId: string): Handoff {
    const handoff = this.handoffs.get(handoffId);
    if (!handoff || handoff.board_id !== boardId) {
      throw new AgentIsolationError("Handoff does not belong to this board");
    }
    return handoff;
  }

  private assertRunWorkspace(run: AgentRun, workspaceId: string): void {
    const workspace = this.requireWorkspace(workspaceId).workspace;
    if (
      run.agent_workspace_id !== workspaceId ||
      workspace.board_id !== run.board_id ||
      workspace.agent_id !== run.agent_id
    ) {
      throw new AgentIsolationError("Run cannot access this agent workspace");
    }
  }

  private assertPathAllowed(access: AgentRunAccess, candidate: string): string {
    const path = normalizePath(candidate, false);
    const lease = this.requireLease(access.lease_id, access.run_id);
    const allowed = lease.allowed_paths.some(
      (root) => root === "" || path === root || path.startsWith(`${root}/`),
    );
    if (!allowed) {
      throw new AgentIsolationError(`Path '${path}' is outside the run lease roots`);
    }
    return path;
  }

  private assertWorkspaceQuota(
    mutable: MutableWorkspace,
    targetPath: string,
    nextFile: MutableFile,
  ): void {
    const quota = mutable.workspace.quota_bytes;
    if (quota === null) return;
    let size = 0;
    for (const [path, file] of mutable.files) {
      size += byteLength(path === targetPath ? nextFile.content : file.content);
    }
    if (!mutable.files.has(targetPath)) size += byteLength(nextFile.content);
    if (size > quota) {
      throw new AgentLeaseError("Workspace storage quota exceeded", "quota.workspace_bytes");
    }
  }

  private listDirectory(mutable: MutableWorkspace, base: string): AgentFileEntry[] {
    const entries = new Map<string, AgentFileEntry>();
    const prefix = base ? `${base}/` : "";
    for (const [path, file] of mutable.files) {
      if (base && path !== base && !path.startsWith(prefix)) continue;
      const remainder = base ? path.slice(prefix.length) : path;
      const separator = remainder.indexOf("/");
      if (separator === -1) {
        entries.set(path, formatFileEntry(path, file));
        continue;
      }
      const name = remainder.slice(0, separator);
      const directoryPath = base ? `${base}/${name}` : name;
      if (!entries.has(directoryPath)) {
        entries.set(directoryPath, {
          path: directoryPath,
          kind: "directory",
          size_bytes: 0,
          sha256: null,
          etag: null,
          language: null,
          generated: false,
          updated_at: mutable.workspace.updated_at,
        });
      }
    }
    return [...entries.values()].sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
      return left.path.localeCompare(right.path);
    });
  }

  private snapshotWorkspace(workspaceId: string): AgentWorkspaceSnapshot {
    const mutable = this.requireWorkspace(workspaceId);
    const manifest = [...mutable.files.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, file]) => ({
        path,
        content: file.content,
        generated: file.generated,
        version: file.version,
      }));
    const snapshot: AgentWorkspaceSnapshot = {
      id: this.nextId("awss"),
      workspace_id: workspaceId,
      kind: "filesystem_manifest",
      checksum: checksum({ files: manifest, scratchpad: mutable.scratchpad.content }),
      created_at: this.timestamp(),
      file_count: manifest.length,
    };
    mutable.snapshots.set(snapshot.id, snapshot);
    mutable.workspace.latest_snapshot_id = snapshot.id;
    this.touchWorkspace(mutable);
    return copy(snapshot);
  }

  private hasFrozenHandoff(boardId: string, agentId: string): boolean {
    for (const handoff of this.handoffs.values()) {
      if (handoff.board_id !== boardId) continue;
      if (
        handoff.state !== "awaiting_review" &&
        handoff.state !== "in_review" &&
        handoff.state !== "approved" &&
        handoff.state !== "changes_requested"
      ) {
        continue;
      }
      const run = this.runs.get(handoff.originating_run_id);
      if (run?.agent_id === agentId) return true;
    }
    return false;
  }

  private findActiveHandoff(boardId: string): string | null {
    for (const handoff of this.handoffs.values()) {
      if (
        handoff.board_id === boardId &&
        (handoff.state === "awaiting_review" || handoff.state === "in_review")
      ) {
        return handoff.id;
      }
    }
    return null;
  }

  private touchWorkspace(mutable: MutableWorkspace): void {
    mutable.workspace.updated_at = this.timestamp();
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private nextId(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}_${this.idCounter.toString(36).padStart(8, "0")}`;
  }
}

function requireAccess(access: AgentRunAccess | undefined): AgentRunAccess {
  if (!access) {
    throw new AgentLeaseError("An active run lease is required", "lease.required");
  }
  return access;
}

function normalizeAllowedPaths(paths: string[]): string[] {
  const normalized = [...new Set(paths.map((path) => normalizePath(path, true)))];
  return normalized.length > 0 ? normalized : [""];
}

function normalizePath(input: string, allowEmpty: boolean): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(input);
  } catch {
    throw new AgentIsolationError("Path contains an invalid percent escape");
  }
  if (decoded === "" && allowEmpty) return "";
  if (!decoded || decoded.startsWith("/") || decoded.includes("\\") || decoded.includes("\0")) {
    throw new AgentIsolationError("Path must be a non-empty, relative POSIX path");
  }
  const segments = decoded.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new AgentIsolationError("Path traversal and empty path segments are not allowed");
  }
  return segments.join("/");
}

function parseCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const value = Number.parseInt(cursor, 10);
  if (!Number.isSafeInteger(value) || value < 0 || String(value) !== cursor) {
    throw new AgentConflictError("Invalid file tree cursor");
  }
  return value;
}

function clampLeaseDuration(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new AgentLeaseError(
      "Lease duration must be a positive number",
      "validation.lease_duration",
    );
  }
  return Math.min(Math.max(Math.floor(durationMs), 1_000), 60 * 60_000);
}

function byteLength(content: string): number {
  return Buffer.byteLength(content, "utf8");
}

function fileEtag(file: MutableFile): string {
  return `W/\"${file.version}-${hash(file.content).slice(0, 16)}\"`;
}

function scratchpadEtag(scratchpad: MutableScratchpad): string {
  return `W/\"${scratchpad.version}-${hash(scratchpad.content).slice(0, 16)}\"`;
}

function formatFile(path: string, file: MutableFile): AgentFile {
  return {
    path,
    content: file.content,
    encoding: "utf-8",
    etag: fileEtag(file),
    sha256: hash(file.content),
    size_bytes: byteLength(file.content),
    updated_at: file.updated_at,
  };
}

function formatFileEntry(path: string, file: MutableFile): AgentFileEntry {
  return {
    path,
    kind: "file",
    size_bytes: byteLength(file.content),
    sha256: hash(file.content),
    etag: fileEtag(file),
    language: inferLanguage(path),
    generated: file.generated,
    updated_at: file.updated_at,
  };
}

function formatScratchpad(workspaceId: string, scratchpad: MutableScratchpad): AgentScratchpad {
  return {
    workspace_id: workspaceId,
    content: scratchpad.content,
    etag: scratchpadEtag(scratchpad),
    updated_at: scratchpad.updated_at,
  };
}

function inferLanguage(path: string): string | null {
  const extension = path.split(".").pop()?.toLowerCase();
  const languageByExtension: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    md: "markdown",
    py: "python",
    go: "go",
    rs: "rust",
    sql: "sql",
    yml: "yaml",
    yaml: "yaml",
  };
  return extension ? (languageByExtension[extension] ?? null) : null;
}

function normalizePacket(input: HandoffPacketInput): HandoffPacket {
  if (!input.goal.trim()) {
    throw new HandoffStateError("A handoff goal is required");
  }
  if (!input.requested_decision.question.trim() || input.requested_decision.choices.length === 0) {
    throw new HandoffStateError("A handoff must include a typed requested decision");
  }
  return {
    goal: input.goal,
    completed_work: [...(input.completed_work ?? [])],
    excluded_work: [...(input.excluded_work ?? [])],
    requested_decision: copy(input.requested_decision),
    change_summary: copy(input.change_summary ?? []),
    evidence: copy(input.evidence ?? []),
    risks: copy(input.risks ?? []),
    proposed_next_actions: copy(input.proposed_next_actions ?? []),
    source_revision_id: input.source_revision_id ?? null,
    target_branch: input.target_branch ?? null,
    rollback_plan: input.rollback_plan ?? null,
    workspace_snapshot: null,
    belief_trace: input.belief_trace,
  };
}

function decisionState(outcome: DecideHandoffInput["outcome"]): HandoffState {
  switch (outcome) {
    case "approve":
    case "approve_with_conditions":
      return "approved";
    case "request_changes":
    case "request_replan":
      return "changes_requested";
    case "reject":
      return "rejected";
    case "delegate":
      return "in_review";
  }
}

function isResumable(state: HandoffState): boolean {
  return state === "approved" || state === "changes_requested";
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
