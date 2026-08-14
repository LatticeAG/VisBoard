import {
  AgentConflictError,
  type AgentContext,
  type AgentFile,
  type AgentFileEntry,
  type AgentFileTree,
  AgentIsolationError,
  type AgentLease,
  AgentLeaseError,
  type AgentMode,
  AgentModeError,
  type AgentRun,
  type AgentRunAccess,
  type AgentRunState,
  type AgentRunWithLease,
  type AgentScratchpad,
  type AgentTransport,
  type AgentWorkspace,
  type AgentWorkspaceSnapshot,
  type AgentWorkspaceState,
  type ClaimHandoffInput,
  type CompleteAgentRunInput,
  type CreateAgentWorkspaceInput,
  type CreateHandoffInput,
  type DecideHandoffInput,
  type DeleteAgentFileInput,
  type FailAgentRunInput,
  type GetAgentContextInput,
  type GetHandoffInput,
  type Handoff,
  type HandoffDecision,
  type HandoffPacket,
  type HandoffPacketInput,
  type HandoffState,
  HandoffStateError,
  type ListAgentFilesInput,
  type ListHandoffsInput,
  type ReadAgentFileInput,
  type RenewAgentLeaseInput,
  type ResumeHandoffInput,
  type RunMutationInput,
  type ScopedAgentWorkspaceInput,
  type StartAgentRunInput,
  type SubmitHandoffInput,
  type UpdateAgentScratchpadInput,
  type WriteAgentFileInput,
  checksum,
  hash,
  hashBeliefTrace,
  requireBeliefTraceForSubmit,
} from "@visboard/agent-sdk";
import {
  type Database,
  agentLeases,
  agentRuns,
  agentWorkspaceFiles,
  agentWorkspaces,
  boardBlocks,
  boardEvents,
  boards,
  handoffDecisions,
  handoffs,
} from "@visboard/db";
import { EventType, PREFIX, createId } from "@visboard/shared";
import { and, asc, eq, inArray } from "drizzle-orm";

const MODE_RANK = {
  observe: 0,
  propose: 1,
  contribute: 2,
  operate: 3,
} as const;

type Tx = Parameters<Parameters<Database["db"]["transaction"]>[0]>[0];
type Store = Database["db"] | Tx;
type WorkspaceRow = typeof agentWorkspaces.$inferSelect;
type FileRow = typeof agentWorkspaceFiles.$inferSelect;
type RunRow = typeof agentRuns.$inferSelect;
type LeaseRow = typeof agentLeases.$inferSelect;
type HandoffRow = typeof handoffs.$inferSelect;
type DecisionRow = typeof handoffDecisions.$inferSelect;

export interface PostgresAgentTransportOptions {
  now?: () => Date;
  default_lease_duration_ms?: number;
}

/**
 * Durable Postgres adapter for the governed agent runtime. Control flow matches
 * InMemoryAgentTransport: lease checks, path roots, ETags, quota, isolation,
 * and submit freeze. Maps are replaced with SQL; startRun, submitHandoff, and
 * decideHandoff run inside transactions.
 */
export class PostgresAgentTransport implements AgentTransport {
  private readonly now: () => Date;
  private readonly defaultLeaseDurationMs: number;

  constructor(
    private readonly database: Database,
    options: PostgresAgentTransportOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.defaultLeaseDurationMs = clampLeaseDuration(
      options.default_lease_duration_ms ?? 15 * 60_000,
    );
  }

  private get store(): Store {
    return this.database.db;
  }

  async getContext(input: GetAgentContextInput): Promise<AgentContext> {
    const [board] = await this.store.select().from(boards).where(eq(boards.id, input.board_id));
    const blockRows = await this.store
      .select()
      .from(boardBlocks)
      .where(eq(boardBlocks.boardId, input.board_id));
    let blocks = blockRows
      .filter((block) => block.deletedAt === null)
      .map((block) => ({
        id: block.id,
        type: block.type,
      }));
    if (input.block_ids?.length) {
      blocks = blocks.filter((block) => input.block_ids?.includes(block.id));
    }
    return {
      board_id: input.board_id,
      revision_id: input.at_revision ?? board?.headRevisionId ?? null,
      document_id: board?.currentDocumentId ?? null,
      purpose: input.purpose,
      blocks,
      agents_md: input.include_agents_md === false ? null : "# AGENTS.md\n",
      active_handoff_id: await this.findActiveHandoff(input.board_id),
      allowed_capabilities: [],
      token_estimate: 0,
      omitted: [],
    };
  }

  async createWorkspace(input: CreateAgentWorkspaceInput): Promise<AgentWorkspace> {
    const access = requireAccess(input.access);
    const run = await this.requireMutableRun(input.board_id, access);
    this.requireMode(run, "operate", "create_workspace");
    if (run.agent_id !== input.agent_id) {
      throw new AgentIsolationError("An agent can only create its own workspace");
    }
    if (run.agent_workspace_id) {
      throw new AgentConflictError("This run is already bound to an agent workspace");
    }

    const timestamp = this.now();
    const id = createId(PREFIX.agentWorkspace);
    const [row] = await this.store
      .insert(agentWorkspaces)
      .values({
        id,
        boardId: input.board_id,
        agentId: input.agent_id,
        profile: input.profile,
        state: "ready",
        source: input.source ?? null,
        branch: input.branch ?? null,
        rootLabel: input.root_label ?? "workspace",
        quotaBytes: input.quota_bytes ?? null,
        latestSnapshotId: null,
        latestSnapshot: null,
        scratchpadContent: "",
        scratchpadVersion: 1,
        scratchpadUpdatedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning();
    if (!row) throw new AgentIsolationError("Failed to create agent workspace");
    await this.store
      .update(agentRuns)
      .set({ agentWorkspaceId: id })
      .where(eq(agentRuns.id, run.id));
    return mapWorkspace(row);
  }

  async getWorkspace(input: ScopedAgentWorkspaceInput): Promise<AgentWorkspace> {
    const row = await this.requireWorkspaceReadAccess(input);
    return mapWorkspace(row);
  }

  async listFiles(input: ListAgentFilesInput): Promise<AgentFileTree> {
    const row = await this.requireWorkspaceReadAccess(input);
    const files = await this.loadFiles(row.id);
    const base = normalizePath(input.path ?? "", true);
    const entries = listDirectory(row, files, base);
    const start = parseCursor(input.cursor);
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
    const page = entries.slice(start, start + limit);
    const next = start + page.length < entries.length ? String(start + page.length) : null;
    return { entries: page, next_cursor: next };
  }

  async readFile(input: ReadAgentFileInput): Promise<AgentFile> {
    await this.requireWorkspaceReadAccess(input);
    const path = await this.assertPathAllowed(input.access, input.path);
    const file = await this.findFile(input.agent_workspace_id, path);
    if (!file) throw new AgentIsolationError(`File '${path}' was not found`);
    return formatFile(path, file);
  }

  async writeFile(input: WriteAgentFileInput): Promise<AgentFile> {
    await this.requireWorkspaceMutableAccess(input, "operate", "write_file");
    const path = await this.assertPathAllowed(input.access, input.path);
    const current = await this.findFile(input.agent_workspace_id, path);

    if (current && input.expected_etag !== fileEtag(current)) {
      throw new AgentConflictError(
        `File '${path}' changed; fetch it and retry with its current ETag`,
      );
    }
    if (!current && input.expected_etag !== undefined && input.expected_etag !== null) {
      throw new AgentConflictError(`File '${path}' does not exist; create it without an ETag`);
    }

    const next = {
      content: input.content,
      version: (current?.version ?? 0) + 1,
      generated: input.generated ?? current?.generated ?? false,
      updated_at: this.timestamp(),
    };
    await this.assertWorkspaceQuota(input.agent_workspace_id, path, next.content);
    const digest = hash(next.content);
    if (current) {
      await this.store
        .update(agentWorkspaceFiles)
        .set({
          content: next.content,
          version: next.version,
          sha256: digest,
          generated: next.generated,
          updatedAt: this.now(),
        })
        .where(eq(agentWorkspaceFiles.id, current.id));
    } else {
      await this.store.insert(agentWorkspaceFiles).values({
        id: createId(PREFIX.agentWorkspaceFile),
        workspaceId: input.agent_workspace_id,
        path,
        content: next.content,
        encoding: "utf-8",
        version: next.version,
        sha256: digest,
        generated: next.generated,
        updatedAt: this.now(),
      });
    }
    await this.touchWorkspace(input.agent_workspace_id);
    return formatFile(path, next);
  }

  async deleteFile(input: DeleteAgentFileInput): Promise<void> {
    await this.requireWorkspaceMutableAccess(input, "operate", "delete_file");
    const path = await this.assertPathAllowed(input.access, input.path);
    const current = await this.findFile(input.agent_workspace_id, path);
    if (!current) throw new AgentIsolationError(`File '${path}' was not found`);
    if (input.expected_etag !== fileEtag(current)) {
      throw new AgentConflictError(
        `File '${path}' changed; fetch it and retry with its current ETag`,
      );
    }
    await this.store.delete(agentWorkspaceFiles).where(eq(agentWorkspaceFiles.id, current.id));
    await this.touchWorkspace(input.agent_workspace_id);
  }

  async getScratchpad(input: ScopedAgentWorkspaceInput): Promise<AgentScratchpad> {
    const row = await this.requireWorkspaceReadAccess(input);
    return formatScratchpad(row);
  }

  async updateScratchpad(input: UpdateAgentScratchpadInput): Promise<AgentScratchpad> {
    const row = await this.requireWorkspaceMutableAccess(input, "contribute", "update_scratchpad");
    const currentEtag = scratchpadEtag(row);
    if (
      input.expected_etag !== undefined &&
      input.expected_etag !== null &&
      input.expected_etag !== currentEtag
    ) {
      throw new AgentConflictError("Scratchpad changed; fetch it and retry with its current ETag");
    }
    const timestamp = this.now();
    const [updated] = await this.store
      .update(agentWorkspaces)
      .set({
        scratchpadContent: input.content,
        scratchpadVersion: row.scratchpadVersion + 1,
        scratchpadUpdatedAt: timestamp,
        updatedAt: timestamp,
      })
      .where(eq(agentWorkspaces.id, row.id))
      .returning();
    if (!updated) throw new AgentIsolationError("Agent workspace was not found");
    return formatScratchpad(updated);
  }

  async startRun(input: StartAgentRunInput): Promise<AgentRunWithLease> {
    return this.store.transaction(async (tx) => {
      if (input.resumed_from_handoff_id) {
        const handoff = await this.requireHandoffRow(
          tx,
          input.board_id,
          input.resumed_from_handoff_id,
        );
        if (!isResumable(parseHandoffState(handoff.state))) {
          throw new HandoffStateError(
            "A new lease requires an approved or changes-requested handoff",
          );
        }
      } else if (await this.hasFrozenHandoff(tx, input.board_id, input.agent_id)) {
        throw new AgentLeaseError(
          "The agent has an active handoff freeze for this board",
          "lease.handoff_frozen",
        );
      }

      if (input.agent_workspace_id) {
        const workspace = await this.requireWorkspaceRow(tx, input.agent_workspace_id);
        if (workspace.boardId !== input.board_id || workspace.agentId !== input.agent_id) {
          throw new AgentIsolationError(
            "Agent run cannot attach another board or agent's workspace",
          );
        }
      }

      const timestamp = this.now();
      const runId = createId(PREFIX.agentRun);
      const leaseId = createId(PREFIX.agentLease);
      const duration = clampLeaseDuration(input.lease_duration_ms ?? this.defaultLeaseDurationMs);
      const [runRow] = await tx
        .insert(agentRuns)
        .values({
          id: runId,
          boardId: input.board_id,
          agentId: input.agent_id,
          agentWorkspaceId: input.agent_workspace_id ?? null,
          mode: input.mode,
          state: "running",
          goal: input.goal,
          baseRevisionId: input.base_revision_id ?? null,
          startedAt: timestamp,
          endedAt: null,
          summary: null,
        })
        .returning();
      const [leaseRow] = await tx
        .insert(agentLeases)
        .values({
          id: leaseId,
          runId,
          capabilities: [...(input.requested_capabilities ?? [])],
          allowedPaths: normalizeAllowedPaths(input.allowed_paths ?? [""]),
          state: "active",
          issuedAt: timestamp,
          expiresAt: new Date(timestamp.getTime() + duration),
          revokedAt: null,
        })
        .returning();
      if (!runRow || !leaseRow) throw new AgentIsolationError("Failed to start agent run");
      return { run: mapRun(runRow), lease: mapLease(leaseRow) };
    });
  }

  async getRun(input: { board_id: string; run_id: string }): Promise<AgentRun> {
    return mapRun(await this.requireRunRow(this.store, input.board_id, input.run_id));
  }

  async heartbeat(input: RunMutationInput): Promise<AgentRun> {
    const run = await this.requireMutableRun(input.board_id, input.access);
    return copy(run);
  }

  async renewLease(input: RenewAgentLeaseInput): Promise<AgentLease> {
    await this.requireMutableRun(input.board_id, input.access);
    const lease = await this.requireLeaseRow(
      this.store,
      input.access.lease_id,
      input.access.run_id,
    );
    const duration = clampLeaseDuration(input.duration_ms ?? this.defaultLeaseDurationMs);
    const expiresAt = new Date(this.now().getTime() + duration);
    const [updated] = await this.store
      .update(agentLeases)
      .set({ expiresAt })
      .where(eq(agentLeases.id, lease.id))
      .returning();
    if (!updated) throw new AgentLeaseError("Lease does not belong to this run", "lease.invalid");
    return mapLease(updated);
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
    const run = await this.requireMutableRun(input.board_id, input.access);
    this.requireMode(run, "propose", "create_handoff");
    const workspaceId = input.agent_workspace_id ?? run.agent_workspace_id;
    if (workspaceId !== null && workspaceId !== undefined) {
      await this.assertRunWorkspace(run, workspaceId);
    }

    const timestamp = this.now();
    const packet = normalizePacket(input.packet);
    const [row] = await this.store
      .insert(handoffs)
      .values({
        id: createId(PREFIX.handoff),
        boardId: input.board_id,
        originatingRunId: run.id,
        agentWorkspaceId: workspaceId ?? null,
        revisionId: input.revision_id ?? input.packet.source_revision_id ?? run.base_revision_id,
        state: "draft",
        packet: toJsonRecord(packet),
        packetHash: null,
        beliefTraceHash: null,
        claimedById: null,
        submittedAt: null,
        decidedAt: null,
        resumedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning();
    if (!row) throw new AgentIsolationError("Failed to create handoff");
    return mapHandoff(row, []);
  }

  async getHandoff(input: GetHandoffInput): Promise<Handoff> {
    const row = await this.requireHandoffRow(this.store, input.board_id, input.handoff_id);
    return mapHandoff(row, await this.loadDecisions(row.id));
  }

  async listHandoffs(input: ListHandoffsInput): Promise<Handoff[]> {
    const rows = await this.store
      .select()
      .from(handoffs)
      .where(
        input.state === undefined
          ? eq(handoffs.boardId, input.board_id)
          : and(eq(handoffs.boardId, input.board_id), eq(handoffs.state, input.state)),
      )
      .orderBy(asc(handoffs.createdAt));
    const ids = rows.map((row) => row.id);
    const decisions =
      ids.length === 0
        ? []
        : await this.store
            .select()
            .from(handoffDecisions)
            .where(inArray(handoffDecisions.handoffId, ids))
            .orderBy(asc(handoffDecisions.createdAt));
    const byHandoff = new Map<string, DecisionRow[]>();
    for (const decision of decisions) {
      const list = byHandoff.get(decision.handoffId) ?? [];
      list.push(decision);
      byHandoff.set(decision.handoffId, list);
    }
    return rows.map((row) => mapHandoff(row, byHandoff.get(row.id) ?? []));
  }

  async submitHandoff(input: SubmitHandoffInput): Promise<Handoff> {
    return this.store.transaction(async (tx) => {
      const run = await this.requireMutableRun(input.board_id, input.access, tx);
      this.requireMode(run, "propose", "submit_handoff");
      const handoffRow = await this.requireHandoffRow(tx, input.board_id, input.handoff_id);
      if (handoffRow.originatingRunId !== run.id) {
        throw new AgentIsolationError("Only the originating run can submit this handoff");
      }
      if (handoffRow.state !== "draft") {
        throw new HandoffStateError("Only a draft handoff can be submitted");
      }

      const packet = mapPacket(handoffRow.packet);
      const trace = requireBeliefTraceForSubmit(packet);
      const snapshot = handoffRow.agentWorkspaceId
        ? await this.snapshotWorkspace(tx, handoffRow.agentWorkspaceId)
        : null;
      const sealed: HandoffPacket = {
        ...packet,
        belief_trace: trace,
        workspace_snapshot: snapshot,
        source_revision_id: handoffRow.revisionId,
      };
      const packetHash = checksum(sealed);
      const beliefTraceHash = hashBeliefTrace(trace);
      const submittedAt = this.now();

      const [updated] = await tx
        .update(handoffs)
        .set({
          packet: toJsonRecord(sealed),
          packetHash,
          beliefTraceHash,
          state: "awaiting_review",
          submittedAt,
          updatedAt: submittedAt,
        })
        .where(eq(handoffs.id, handoffRow.id))
        .returning();
      if (!updated) throw new AgentIsolationError("Handoff does not belong to this board");

      await tx
        .update(agentRuns)
        .set({ state: "waiting_for_human" })
        .where(eq(agentRuns.id, run.id));
      await tx
        .update(agentLeases)
        .set({ state: "revoked", revokedAt: submittedAt })
        .where(eq(agentLeases.id, input.access.lease_id));

      await this.emitBoardEvent(tx, {
        boardId: input.board_id,
        type: EventType.HANDOFF_SUBMITTED,
        actorType: "agent",
        actorId: run.agent_id,
        revisionId: updated.revisionId,
        payload: {
          handoff_id: updated.id,
          packet_hash: packetHash,
          belief_trace_hash: beliefTraceHash,
          revision_id: updated.revisionId,
        },
      });

      return mapHandoff(updated, []);
    });
  }

  async claimHandoff(input: ClaimHandoffInput): Promise<Handoff> {
    const handoffRow = await this.requireHandoffRow(this.store, input.board_id, input.handoff_id);
    if (handoffRow.state !== "awaiting_review" && handoffRow.state !== "in_review") {
      throw new HandoffStateError("Only a pending handoff can be claimed");
    }
    if (handoffRow.claimedById && handoffRow.claimedById !== input.reviewer_id) {
      throw new AgentConflictError("This handoff is already claimed by another reviewer");
    }
    const timestamp = this.now();
    const [updated] = await this.store
      .update(handoffs)
      .set({
        claimedById: input.reviewer_id,
        state: "in_review",
        updatedAt: timestamp,
      })
      .where(eq(handoffs.id, handoffRow.id))
      .returning();
    if (!updated) throw new AgentIsolationError("Handoff does not belong to this board");
    return mapHandoff(updated, await this.loadDecisions(updated.id));
  }

  async decideHandoff(input: DecideHandoffInput): Promise<Handoff> {
    return this.store.transaction(async (tx) => {
      const handoffRow = await this.requireHandoffRow(tx, input.board_id, input.handoff_id);
      if (handoffRow.state !== "awaiting_review" && handoffRow.state !== "in_review") {
        throw new HandoffStateError("Only a submitted handoff can receive a decision");
      }
      if (handoffRow.claimedById && handoffRow.claimedById !== input.reviewer_id) {
        throw new AgentIsolationError("Only the claimed reviewer can decide this handoff");
      }
      if (!handoffRow.packetHash) {
        throw new HandoffStateError("A decision cannot be made before packet sealing");
      }

      const timestamp = this.now();
      const [decisionRow] = await tx
        .insert(handoffDecisions)
        .values({
          id: createId(PREFIX.handoffDecision),
          handoffId: handoffRow.id,
          reviewerId: input.reviewer_id,
          outcome: input.outcome,
          rationale: input.rationale ?? null,
          conditions: input.conditions ?? {},
          packetHash: handoffRow.packetHash,
          createdAt: timestamp,
        })
        .returning();
      if (!decisionRow) throw new AgentIsolationError("Failed to record handoff decision");

      const nextState = decisionState(input.outcome);
      const [updated] = await tx
        .update(handoffs)
        .set({
          state: nextState,
          decidedAt: timestamp,
          updatedAt: timestamp,
        })
        .where(eq(handoffs.id, handoffRow.id))
        .returning();
      if (!updated) throw new AgentIsolationError("Handoff does not belong to this board");

      await this.emitBoardEvent(tx, {
        boardId: input.board_id,
        type: EventType.HANDOFF_DECIDED,
        actorType: "user",
        actorId: input.reviewer_id,
        revisionId: updated.revisionId,
        payload: {
          handoff_id: updated.id,
          outcome: input.outcome,
        },
      });

      const decisions = await tx
        .select()
        .from(handoffDecisions)
        .where(eq(handoffDecisions.handoffId, updated.id))
        .orderBy(asc(handoffDecisions.createdAt));
      return mapHandoff(updated, decisions);
    });
  }

  async resumeHandoff(input: ResumeHandoffInput): Promise<AgentRunWithLease> {
    const handoffRow = await this.requireHandoffRow(this.store, input.board_id, input.handoff_id);
    if (!isResumable(parseHandoffState(handoffRow.state))) {
      throw new HandoffStateError(
        "The handoff needs an eligible human decision before it can resume",
      );
    }
    const origin = await this.requireRunRow(
      this.store,
      input.board_id,
      handoffRow.originatingRunId,
    );
    if (origin.agentId !== input.agent_id) {
      throw new AgentIsolationError("A handoff can only resume its originating agent identity");
    }

    const next = await this.startRun({
      board_id: input.board_id,
      agent_id: input.agent_id,
      mode: input.mode ?? parseMode(origin.mode),
      goal: input.goal ?? origin.goal,
      base_revision_id: handoffRow.revisionId ?? origin.baseRevisionId ?? undefined,
      agent_workspace_id: handoffRow.agentWorkspaceId ?? undefined,
      requested_capabilities: input.requested_capabilities,
      allowed_paths: input.allowed_paths,
      lease_duration_ms: input.lease_duration_ms,
      resumed_from_handoff_id: handoffRow.id,
    });
    const resumedAt = this.now();
    await this.store
      .update(handoffs)
      .set({
        state: "resumed",
        resumedAt,
        updatedAt: resumedAt,
      })
      .where(eq(handoffs.id, handoffRow.id));
    return next;
  }

  private async finishRun(
    input: CompleteAgentRunInput | FailAgentRunInput | RunMutationInput,
    state: Extract<AgentRun["state"], "completed" | "failed" | "cancelled">,
    summary: string,
  ): Promise<AgentRun> {
    await this.requireMutableRun(input.board_id, input.access);
    const endedAt = this.now();
    const [runRow] = await this.store
      .update(agentRuns)
      .set({ state, summary, endedAt })
      .where(eq(agentRuns.id, input.access.run_id))
      .returning();
    await this.store
      .update(agentLeases)
      .set({ state: "revoked", revokedAt: endedAt })
      .where(eq(agentLeases.id, input.access.lease_id));
    if (!runRow) throw new AgentIsolationError("Run does not belong to this board");
    return mapRun(runRow);
  }

  private async requireWorkspaceReadAccess(
    input: ScopedAgentWorkspaceInput,
    store: Store = this.store,
  ): Promise<WorkspaceRow> {
    const run = await this.requireRunForAccess(input.board_id, input.access, store);
    const row = await this.requireWorkspaceRow(store, input.agent_workspace_id);
    this.assertRunWorkspaceIds(run, row);
    return row;
  }

  private async requireWorkspaceMutableAccess(
    input: ScopedAgentWorkspaceInput,
    minimumMode: keyof typeof MODE_RANK,
    operation: string,
    store: Store = this.store,
  ): Promise<WorkspaceRow> {
    const run = await this.requireMutableRun(input.board_id, input.access, store);
    this.requireMode(run, minimumMode, operation);
    const row = await this.requireWorkspaceRow(store, input.agent_workspace_id);
    this.assertRunWorkspaceIds(run, row);
    return row;
  }

  private async requireRunForAccess(
    boardId: string,
    access: AgentRunAccess,
    store: Store = this.store,
  ): Promise<AgentRun> {
    const run = mapRun(await this.requireRunRow(store, boardId, access.run_id));
    await this.requireLeaseRow(store, access.lease_id, run.id);
    return run;
  }

  private async requireMutableRun(
    boardId: string,
    access: AgentRunAccess,
    store: Store = this.store,
  ): Promise<AgentRun> {
    const run = await this.requireRunForAccess(boardId, access, store);
    const lease = await this.requireLeaseRow(store, access.lease_id, run.id);
    if (lease.state !== "active") {
      throw new AgentLeaseError("This run lease is no longer active", "lease.not_active");
    }
    if (lease.expiresAt.getTime() <= this.now().getTime()) {
      await store.update(agentLeases).set({ state: "expired" }).where(eq(agentLeases.id, lease.id));
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

  private async requireRunRow(store: Store, boardId: string, runId: string): Promise<RunRow> {
    const [row] = await store
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.id, runId), eq(agentRuns.boardId, boardId)));
    if (!row) throw new AgentIsolationError("Run does not belong to this board");
    return row;
  }

  private async requireLeaseRow(store: Store, leaseId: string, runId: string): Promise<LeaseRow> {
    const [row] = await store
      .select()
      .from(agentLeases)
      .where(and(eq(agentLeases.id, leaseId), eq(agentLeases.runId, runId)));
    if (!row) throw new AgentLeaseError("Lease does not belong to this run", "lease.invalid");
    return row;
  }

  private async requireWorkspaceRow(store: Store, workspaceId: string): Promise<WorkspaceRow> {
    const [row] = await store
      .select()
      .from(agentWorkspaces)
      .where(eq(agentWorkspaces.id, workspaceId));
    if (!row) throw new AgentIsolationError("Agent workspace was not found");
    return row;
  }

  private async requireHandoffRow(
    store: Store,
    boardId: string,
    handoffId: string,
  ): Promise<HandoffRow> {
    const [row] = await store
      .select()
      .from(handoffs)
      .where(and(eq(handoffs.id, handoffId), eq(handoffs.boardId, boardId)));
    if (!row) throw new AgentIsolationError("Handoff does not belong to this board");
    return row;
  }

  private async assertRunWorkspace(run: AgentRun, workspaceId: string): Promise<void> {
    const workspace = await this.requireWorkspaceRow(this.store, workspaceId);
    this.assertRunWorkspaceIds(run, workspace);
  }

  private assertRunWorkspaceIds(run: AgentRun, workspace: WorkspaceRow): void {
    if (
      run.agent_workspace_id !== workspace.id ||
      workspace.boardId !== run.board_id ||
      workspace.agentId !== run.agent_id
    ) {
      throw new AgentIsolationError("Run cannot access this agent workspace");
    }
  }

  private async assertPathAllowed(access: AgentRunAccess, candidate: string): Promise<string> {
    const path = normalizePath(candidate, false);
    const lease = await this.requireLeaseRow(this.store, access.lease_id, access.run_id);
    const allowed = (lease.allowedPaths ?? []).some(
      (root) => root === "" || path === root || path.startsWith(`${root}/`),
    );
    if (!allowed) {
      throw new AgentIsolationError(`Path '${path}' is outside the run lease roots`);
    }
    return path;
  }

  private async assertWorkspaceQuota(
    workspaceId: string,
    targetPath: string,
    nextContent: string,
  ): Promise<void> {
    const row = await this.requireWorkspaceRow(this.store, workspaceId);
    if (row.quotaBytes === null) return;
    const files = await this.loadFiles(workspaceId);
    let size = 0;
    let replaced = false;
    for (const file of files) {
      if (file.path === targetPath) {
        size += byteLength(nextContent);
        replaced = true;
      } else {
        size += byteLength(file.content);
      }
    }
    if (!replaced) size += byteLength(nextContent);
    if (size > row.quotaBytes) {
      throw new AgentLeaseError("Workspace storage quota exceeded", "quota.workspace_bytes");
    }
  }

  private async snapshotWorkspace(
    store: Store,
    workspaceId: string,
  ): Promise<AgentWorkspaceSnapshot> {
    const row = await this.requireWorkspaceRow(store, workspaceId);
    const files = await this.loadFiles(workspaceId, store);
    const manifest = files
      .slice()
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((file) => ({
        path: file.path,
        content: file.content,
        generated: file.generated,
        version: file.version,
      }));
    const timestamp = this.now();
    const snapshot: AgentWorkspaceSnapshot = {
      id: createId("awss"),
      workspace_id: workspaceId,
      kind: "filesystem_manifest",
      checksum: checksum({ files: manifest, scratchpad: row.scratchpadContent }),
      created_at: timestamp.toISOString(),
      file_count: manifest.length,
    };
    await store
      .update(agentWorkspaces)
      .set({
        latestSnapshotId: snapshot.id,
        latestSnapshot: toJsonRecord(snapshot),
        updatedAt: timestamp,
      })
      .where(eq(agentWorkspaces.id, workspaceId));
    return copy(snapshot);
  }

  private async hasFrozenHandoff(store: Store, boardId: string, agentId: string): Promise<boolean> {
    const rows = await store
      .select({
        state: handoffs.state,
        agentId: agentRuns.agentId,
      })
      .from(handoffs)
      .innerJoin(agentRuns, eq(handoffs.originatingRunId, agentRuns.id))
      .where(eq(handoffs.boardId, boardId));
    return rows.some(
      (row) =>
        row.agentId === agentId &&
        (row.state === "awaiting_review" ||
          row.state === "in_review" ||
          row.state === "approved" ||
          row.state === "changes_requested"),
    );
  }

  private async findActiveHandoff(boardId: string): Promise<string | null> {
    const [row] = await this.store
      .select({ id: handoffs.id })
      .from(handoffs)
      .where(
        and(
          eq(handoffs.boardId, boardId),
          inArray(handoffs.state, ["awaiting_review", "in_review"]),
        ),
      )
      .limit(1);
    return row?.id ?? null;
  }

  private async loadFiles(workspaceId: string, store: Store = this.store): Promise<FileRow[]> {
    return store
      .select()
      .from(agentWorkspaceFiles)
      .where(eq(agentWorkspaceFiles.workspaceId, workspaceId));
  }

  private async findFile(workspaceId: string, path: string): Promise<FileRow | undefined> {
    const [row] = await this.store
      .select()
      .from(agentWorkspaceFiles)
      .where(
        and(eq(agentWorkspaceFiles.workspaceId, workspaceId), eq(agentWorkspaceFiles.path, path)),
      );
    return row;
  }

  private async loadDecisions(handoffId: string): Promise<DecisionRow[]> {
    return this.store
      .select()
      .from(handoffDecisions)
      .where(eq(handoffDecisions.handoffId, handoffId))
      .orderBy(asc(handoffDecisions.createdAt));
  }

  private async touchWorkspace(workspaceId: string): Promise<void> {
    await this.store
      .update(agentWorkspaces)
      .set({ updatedAt: this.now() })
      .where(eq(agentWorkspaces.id, workspaceId));
  }

  private async emitBoardEvent(
    store: Store,
    input: {
      boardId: string;
      type: string;
      actorType: "user" | "agent" | "system";
      actorId: string;
      revisionId: string | null;
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    const [board] = await store.select().from(boards).where(eq(boards.id, input.boardId)).limit(1);
    if (!board) throw new AgentIsolationError("Board was not found");
    const sequence = (board.headSequence ?? 0) + 1;
    const timestamp = this.now();
    await store
      .update(boards)
      .set({ headSequence: sequence, updatedAt: timestamp })
      .where(eq(boards.id, input.boardId));
    await store.insert(boardEvents).values({
      id: createId(PREFIX.boardEvent),
      boardId: input.boardId,
      sequence,
      revisionId: input.revisionId,
      type: input.type,
      actorType: input.actorType,
      actorId: input.actorId,
      payload: input.payload,
      createdAt: timestamp,
    });
  }

  private timestamp(): string {
    return this.now().toISOString();
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

function fileEtag(file: { version: number; content: string }): string {
  return `W/"${file.version}-${hash(file.content).slice(0, 16)}"`;
}

function scratchpadEtag(row: WorkspaceRow): string {
  return `W/"${row.scratchpadVersion}-${hash(row.scratchpadContent).slice(0, 16)}"`;
}

function formatFile(
  path: string,
  file: {
    content: string;
    version: number;
    generated?: boolean;
    updated_at?: string;
    updatedAt?: Date;
  },
): AgentFile {
  const updatedAt =
    "updated_at" in file && typeof file.updated_at === "string"
      ? file.updated_at
      : iso(file.updatedAt ?? new Date());
  return {
    path,
    content: file.content,
    encoding: "utf-8",
    etag: fileEtag(file),
    sha256: hash(file.content),
    size_bytes: byteLength(file.content),
    updated_at: updatedAt,
  };
}

function formatFileEntry(path: string, file: FileRow): AgentFileEntry {
  return {
    path,
    kind: "file",
    size_bytes: byteLength(file.content),
    sha256: hash(file.content),
    etag: fileEtag(file),
    language: inferLanguage(path),
    generated: file.generated,
    updated_at: iso(file.updatedAt),
  };
}

function formatScratchpad(row: WorkspaceRow): AgentScratchpad {
  return {
    workspace_id: row.id,
    content: row.scratchpadContent,
    etag: scratchpadEtag(row),
    updated_at: iso(row.scratchpadUpdatedAt),
  };
}

function listDirectory(workspace: WorkspaceRow, files: FileRow[], base: string): AgentFileEntry[] {
  const entries = new Map<string, AgentFileEntry>();
  const prefix = base ? `${base}/` : "";
  for (const file of files) {
    const path = file.path;
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
        updated_at: iso(workspace.updatedAt),
      });
    }
  }
  return [...entries.values()].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
    return left.path.localeCompare(right.path);
  });
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

function mapWorkspace(row: WorkspaceRow): AgentWorkspace {
  return {
    id: row.id,
    board_id: row.boardId,
    agent_id: row.agentId,
    profile: parseProfile(row.profile),
    state: parseWorkspaceState(row.state),
    source: row.source,
    branch: row.branch,
    root_label: row.rootLabel,
    quota_bytes: row.quotaBytes,
    latest_snapshot_id: row.latestSnapshotId,
    created_at: iso(row.createdAt),
    updated_at: iso(row.updatedAt),
  };
}

function mapRun(row: RunRow): AgentRun {
  return {
    id: row.id,
    board_id: row.boardId,
    agent_id: row.agentId,
    agent_workspace_id: row.agentWorkspaceId,
    mode: parseMode(row.mode),
    state: parseRunState(row.state),
    goal: row.goal,
    base_revision_id: row.baseRevisionId,
    started_at: iso(row.startedAt),
    ended_at: row.endedAt ? iso(row.endedAt) : null,
    summary: row.summary,
  };
}

function mapLease(row: LeaseRow): AgentLease {
  return {
    id: row.id,
    run_id: row.runId,
    capabilities: [...(row.capabilities ?? [])],
    allowed_paths: [...(row.allowedPaths ?? [])],
    state: parseLeaseState(row.state),
    issued_at: iso(row.issuedAt),
    expires_at: iso(row.expiresAt),
    revoked_at: row.revokedAt ? iso(row.revokedAt) : null,
  };
}

function mapHandoff(row: HandoffRow, decisions: DecisionRow[]): Handoff {
  return {
    id: row.id,
    board_id: row.boardId,
    originating_run_id: row.originatingRunId,
    agent_workspace_id: row.agentWorkspaceId,
    revision_id: row.revisionId,
    state: parseHandoffState(row.state),
    packet: mapPacket(row.packet),
    packet_hash: row.packetHash,
    belief_trace_hash: row.beliefTraceHash,
    claimed_by_id: row.claimedById,
    submitted_at: row.submittedAt ? iso(row.submittedAt) : null,
    decided_at: row.decidedAt ? iso(row.decidedAt) : null,
    resumed_at: row.resumedAt ? iso(row.resumedAt) : null,
    decisions: decisions.map(mapDecision),
    created_at: iso(row.createdAt),
    updated_at: iso(row.updatedAt),
  };
}

function mapDecision(row: DecisionRow): HandoffDecision {
  return {
    id: row.id,
    handoff_id: row.handoffId,
    reviewer_id: row.reviewerId,
    outcome: parseOutcome(row.outcome),
    rationale: row.rationale,
    conditions: copy(row.conditions ?? {}),
    packet_hash: row.packetHash,
    created_at: iso(row.createdAt),
  };
}

function mapPacket(value: unknown): HandoffPacket {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HandoffStateError("Stored handoff packet is invalid");
  }
  return copy(value) as HandoffPacket;
}

function parseMode(value: string): AgentMode {
  if (value === "observe" || value === "propose" || value === "contribute" || value === "operate") {
    return value;
  }
  throw new AgentIsolationError(`Invalid stored agent mode '${value}'`);
}

function parseRunState(value: string): AgentRunState {
  if (
    value === "running" ||
    value === "waiting_for_human" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }
  throw new AgentIsolationError(`Invalid stored agent run state '${value}'`);
}

function parseLeaseState(value: string): AgentLease["state"] {
  if (value === "active" || value === "revoked" || value === "expired") return value;
  throw new AgentIsolationError(`Invalid stored lease state '${value}'`);
}

function parseWorkspaceState(value: string): AgentWorkspaceState {
  if (
    value === "provisioning" ||
    value === "ready" ||
    value === "suspended" ||
    value === "destroyed"
  ) {
    return value;
  }
  throw new AgentIsolationError(`Invalid stored workspace state '${value}'`);
}

function parseProfile(value: string): AgentWorkspace["profile"] {
  if (
    value === "external" ||
    value === "container" ||
    value === "git_worktree" ||
    value === "remote_runner"
  ) {
    return value;
  }
  throw new AgentIsolationError(`Invalid stored workspace profile '${value}'`);
}

function parseHandoffState(value: string): HandoffState {
  if (
    value === "draft" ||
    value === "awaiting_review" ||
    value === "in_review" ||
    value === "approved" ||
    value === "rejected" ||
    value === "changes_requested" ||
    value === "cancelled" ||
    value === "expired" ||
    value === "resumed"
  ) {
    return value;
  }
  throw new AgentIsolationError(`Invalid stored handoff state '${value}'`);
}

function parseOutcome(value: string): HandoffDecision["outcome"] {
  if (
    value === "approve" ||
    value === "approve_with_conditions" ||
    value === "request_changes" ||
    value === "reject" ||
    value === "delegate" ||
    value === "request_replan"
  ) {
    return value;
  }
  throw new AgentIsolationError(`Invalid stored handoff outcome '${value}'`);
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toJsonRecord(value: object): Record<string, unknown> {
  const copied: unknown = JSON.parse(JSON.stringify(value));
  if (typeof copied !== "object" || copied === null || Array.isArray(copied)) {
    throw new HandoffStateError("JSON payload must be an object");
  }
  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(copied)) {
    record[key] = entry;
  }
  return record;
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
