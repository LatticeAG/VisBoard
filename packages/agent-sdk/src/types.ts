/**
 * Framework-neutral contracts for the governed Agent SDK. IDs deliberately
 * remain opaque strings so an application can use the V2 board identifiers
 * while a local test adapter can use generated IDs.
 */

export type AgentMode = "observe" | "propose" | "contribute" | "operate";

export type AgentWorkspaceProfile = "external" | "container" | "git_worktree" | "remote_runner";

export type AgentWorkspaceState = "provisioning" | "ready" | "suspended" | "destroyed";

export type AgentRunState = "running" | "waiting_for_human" | "completed" | "failed" | "cancelled";

export type AgentLeaseState = "active" | "revoked" | "expired";

export type HandoffState =
  | "draft"
  | "awaiting_review"
  | "in_review"
  | "approved"
  | "rejected"
  | "changes_requested"
  | "cancelled"
  | "expired"
  | "resumed";

export type HandoffDecisionOutcome =
  | "approve"
  | "approve_with_conditions"
  | "request_changes"
  | "reject"
  | "delegate"
  | "request_replan";

export interface AgentRunAccess {
  run_id: string;
  lease_id: string;
}

export interface AgentLease {
  id: string;
  run_id: string;
  capabilities: string[];
  allowed_paths: string[];
  state: AgentLeaseState;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export interface AgentWorkspace {
  id: string;
  board_id: string;
  agent_id: string;
  profile: AgentWorkspaceProfile;
  state: AgentWorkspaceState;
  source: string | null;
  branch: string | null;
  root_label: string;
  quota_bytes: number | null;
  latest_snapshot_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentFileEntry {
  path: string;
  kind: "file" | "directory";
  size_bytes: number;
  sha256: string | null;
  etag: string | null;
  language: string | null;
  generated: boolean;
  updated_at: string;
}

export interface AgentFileTree {
  entries: AgentFileEntry[];
  next_cursor: string | null;
}

export interface AgentFile {
  path: string;
  content: string;
  encoding: "utf-8";
  etag: string;
  sha256: string;
  size_bytes: number;
  updated_at: string;
}

export interface AgentScratchpad {
  workspace_id: string;
  content: string;
  etag: string;
  updated_at: string;
}

export interface AgentWorkspaceSnapshot {
  id: string;
  workspace_id: string;
  kind: "filesystem_manifest" | "git_ref" | "external_checkpoint";
  checksum: string;
  created_at: string;
  file_count: number;
}

export interface AgentRun {
  id: string;
  board_id: string;
  agent_id: string;
  agent_workspace_id: string | null;
  mode: AgentMode;
  state: AgentRunState;
  goal: string;
  base_revision_id: string | null;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
}

export interface AgentRunWithLease {
  run: AgentRun;
  lease: AgentLease;
}

export interface AgentContextBlock {
  id: string;
  type: string;
  title?: string;
  summary?: string;
  content?: string;
  provenance?: "trusted" | "untrusted" | "redacted";
}

export interface AgentContext {
  board_id: string;
  revision_id: string | null;
  document_id: string | null;
  purpose:
    | "planning"
    | "implementation"
    | "review"
    | "incident_response"
    | "sync_resolution"
    | "handoff_follow_up";
  blocks: AgentContextBlock[];
  agents_md: string | null;
  active_handoff_id: string | null;
  allowed_capabilities: string[];
  token_estimate: number | null;
  omitted: Array<{ reason: string; count?: number }>;
}

export interface HandoffDecisionRequest {
  kind: string;
  question: string;
  choices: Array<{
    id: string;
    label: string;
    description?: string;
  }>;
  required_approver_roles?: string[];
  required_approver_count?: number;
  deadline_at?: string;
  resume_allowed?: boolean;
}

export interface HandoffChange {
  kind: "block" | "file" | "workspace" | "external" | "other";
  summary: string;
  resource_id?: string;
  diff_url?: string;
}

export interface HandoffEvidence {
  kind: "test" | "artifact" | "command" | "citation" | "screenshot" | "other";
  title: string;
  summary?: string;
  reference?: string;
  verified?: boolean;
}

export interface HandoffRisk {
  category: "data" | "security" | "deployment" | "customer" | "assumption" | "other";
  summary: string;
  mitigation?: string;
  severity?: "low" | "medium" | "high" | "critical";
}

export interface HandoffNextAction {
  summary: string;
  required_capabilities?: string[];
  estimated_minutes?: number;
  external_effect?: boolean;
}

export interface BeliefEntry {
  id: string;
  statement: string;
  weight?: number;
  evidence_refs: string[];
  block_ids: string[];
  source: "agent" | "human" | "retrieved" | "inferred";
}

export interface BeliefTrace {
  schema_version: 1;
  board_revision_id: string | null;
  run_id: string;
  captured_at: string;
  summary: string;
  beliefs: BeliefEntry[];
  assumptions: BeliefEntry[];
  overweighted: BeliefEntry[];
  ignored: BeliefEntry[];
  confidence: number;
}

/** The mutable input used while a handoff is still a draft. */
export interface HandoffPacketInput {
  goal: string;
  completed_work?: string[];
  excluded_work?: string[];
  requested_decision: HandoffDecisionRequest;
  change_summary?: HandoffChange[];
  evidence?: HandoffEvidence[];
  risks?: HandoffRisk[];
  proposed_next_actions?: HandoffNextAction[];
  source_revision_id?: string | null;
  target_branch?: string | null;
  rollback_plan?: string | null;
  belief_trace?: BeliefTrace;
}

/** A packet as seen after submit: snapshot and checksum anchors are immutable. */
export interface HandoffPacket
  extends Required<
    Pick<
      HandoffPacketInput,
      | "goal"
      | "requested_decision"
      | "completed_work"
      | "excluded_work"
      | "change_summary"
      | "evidence"
      | "risks"
      | "proposed_next_actions"
    >
  > {
  source_revision_id: string | null;
  target_branch: string | null;
  rollback_plan: string | null;
  workspace_snapshot: AgentWorkspaceSnapshot | null;
  /** Required after submit. Drafts may omit it. */
  belief_trace?: BeliefTrace;
}

export interface HandoffDecision {
  id: string;
  handoff_id: string;
  reviewer_id: string;
  outcome: HandoffDecisionOutcome;
  rationale: string | null;
  conditions: Record<string, unknown>;
  packet_hash: string;
  created_at: string;
}

export interface Handoff {
  id: string;
  board_id: string;
  originating_run_id: string;
  agent_workspace_id: string | null;
  revision_id: string | null;
  state: HandoffState;
  packet: HandoffPacket;
  packet_hash: string | null;
  belief_trace_hash: string | null;
  claimed_by_id: string | null;
  submitted_at: string | null;
  decided_at: string | null;
  resumed_at: string | null;
  decisions: HandoffDecision[];
  created_at: string;
  updated_at: string;
}

export interface GetAgentContextInput {
  board_id: string;
  purpose: AgentContext["purpose"];
  at_revision?: string;
  block_ids?: string[];
  include_agents_md?: boolean;
}

export interface CreateAgentWorkspaceInput {
  board_id: string;
  agent_id: string;
  profile: AgentWorkspaceProfile;
  source?: string;
  branch?: string;
  root_label?: string;
  quota_bytes?: number;
  access?: AgentRunAccess;
}

export interface ScopedAgentWorkspaceInput {
  board_id: string;
  agent_workspace_id: string;
  access: AgentRunAccess;
}

export interface ListAgentFilesInput extends ScopedAgentWorkspaceInput {
  path?: string;
  cursor?: string;
  limit?: number;
}

export interface ReadAgentFileInput extends ScopedAgentWorkspaceInput {
  path: string;
}

export interface WriteAgentFileInput extends ScopedAgentWorkspaceInput {
  path: string;
  content: string;
  expected_etag?: string | null;
  generated?: boolean;
}

export interface DeleteAgentFileInput extends ScopedAgentWorkspaceInput {
  path: string;
  expected_etag: string;
}

export interface UpdateAgentScratchpadInput extends ScopedAgentWorkspaceInput {
  content: string;
  expected_etag?: string | null;
}

export interface StartAgentRunInput {
  board_id: string;
  agent_id: string;
  mode: AgentMode;
  goal: string;
  base_revision_id?: string;
  agent_workspace_id?: string;
  requested_capabilities?: string[];
  allowed_paths?: string[];
  lease_duration_ms?: number;
  resumed_from_handoff_id?: string;
}

export interface RunMutationInput {
  board_id: string;
  access: AgentRunAccess;
}

export interface CompleteAgentRunInput extends RunMutationInput {
  summary: string;
}

export interface FailAgentRunInput extends RunMutationInput {
  summary: string;
}

export interface RenewAgentLeaseInput extends RunMutationInput {
  duration_ms?: number;
}

export interface CreateHandoffInput extends RunMutationInput {
  agent_workspace_id?: string;
  revision_id?: string;
  packet: HandoffPacketInput;
}

export interface SubmitHandoffInput extends RunMutationInput {
  handoff_id: string;
}

export interface GetHandoffInput {
  board_id: string;
  handoff_id: string;
}

export interface ListHandoffsInput {
  board_id: string;
  state?: HandoffState;
}

export interface ClaimHandoffInput extends GetHandoffInput {
  reviewer_id: string;
}

export interface DecideHandoffInput extends GetHandoffInput {
  reviewer_id: string;
  outcome: HandoffDecisionOutcome;
  rationale?: string;
  conditions?: Record<string, unknown>;
}

export interface ResumeHandoffInput extends GetHandoffInput {
  agent_id: string;
  mode?: AgentMode;
  goal?: string;
  requested_capabilities?: string[];
  allowed_paths?: string[];
  lease_duration_ms?: number;
}

export interface AgentTransport {
  getContext(input: GetAgentContextInput): Promise<AgentContext>;

  createWorkspace(input: CreateAgentWorkspaceInput): Promise<AgentWorkspace>;
  getWorkspace(input: ScopedAgentWorkspaceInput): Promise<AgentWorkspace>;
  listFiles(input: ListAgentFilesInput): Promise<AgentFileTree>;
  readFile(input: ReadAgentFileInput): Promise<AgentFile>;
  writeFile(input: WriteAgentFileInput): Promise<AgentFile>;
  deleteFile(input: DeleteAgentFileInput): Promise<void>;
  getScratchpad(input: ScopedAgentWorkspaceInput): Promise<AgentScratchpad>;
  updateScratchpad(input: UpdateAgentScratchpadInput): Promise<AgentScratchpad>;

  startRun(input: StartAgentRunInput): Promise<AgentRunWithLease>;
  getRun(input: { board_id: string; run_id: string }): Promise<AgentRun>;
  heartbeat(input: RunMutationInput): Promise<AgentRun>;
  renewLease(input: RenewAgentLeaseInput): Promise<AgentLease>;
  completeRun(input: CompleteAgentRunInput): Promise<AgentRun>;
  failRun(input: FailAgentRunInput): Promise<AgentRun>;
  cancelRun(input: RunMutationInput): Promise<AgentRun>;

  createHandoff(input: CreateHandoffInput): Promise<Handoff>;
  listHandoffs(input: ListHandoffsInput): Promise<Handoff[]>;
  getHandoff(input: GetHandoffInput): Promise<Handoff>;
  submitHandoff(input: SubmitHandoffInput): Promise<Handoff>;
  claimHandoff(input: ClaimHandoffInput): Promise<Handoff>;
  decideHandoff(input: DecideHandoffInput): Promise<Handoff>;
  resumeHandoff(input: ResumeHandoffInput): Promise<AgentRunWithLease>;
}
