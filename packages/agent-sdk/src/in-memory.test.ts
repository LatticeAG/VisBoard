import { describe, expect, it } from "vitest";
import {
  AgentConflictError,
  AgentIsolationError,
  AgentLeaseError,
  AgentModeError,
  AgentSession,
  HandoffStateError,
  InMemoryAgentTransport,
} from "./index.js";
import type { BeliefTrace } from "./types.js";

const boardId = "brd_launch";

function sampleBelief(runId: string): BeliefTrace {
  return {
    schema_version: 1,
    board_revision_id: null,
    run_id: runId,
    captured_at: "2026-08-14T04:00:00.000Z",
    summary: "Implementation is ready for human review",
    beliefs: [
      {
        id: "b1",
        statement: "Workspace isolation holds",
        evidence_refs: [],
        block_ids: [],
        source: "agent",
      },
    ],
    assumptions: [],
    overweighted: [],
    ignored: [],
    confidence: 0.8,
  };
}

async function operatingSession(
  transport: InMemoryAgentTransport,
  options: { board_id?: string; agent_id?: string; allowed_paths?: string[] } = {},
) {
  const session = await AgentSession.start(transport, {
    board_id: options.board_id ?? boardId,
    agent_id: options.agent_id ?? "agent_builder",
    mode: "operate",
    goal: "Implement the board workflow",
    base_revision_id: "rev_001",
    allowed_paths: options.allowed_paths,
  });
  const workspace = await session.createWorkspace({
    profile: "external",
    source: "git@example.test:org/repo.git",
    branch: "agent/builder",
  });
  return { session, workspace };
}

describe("InMemoryAgentTransport workspace isolation", () => {
  it("keeps each agent workspace isolated, exposes a directory tree, and versions scratchpads", async () => {
    const transport = new InMemoryAgentTransport();
    const first = await operatingSession(transport);
    const second = await operatingSession(transport, { agent_id: "agent_reviewer" });

    const file = await first.session.writeFile(first.workspace.id, {
      path: "src/index.ts",
      content: "export const answer = 42;\n",
    });
    await first.session.writeFile(first.workspace.id, {
      path: "README.md",
      content: "# Agent work\n",
    });

    const root = await first.session.listFiles(first.workspace.id);
    expect(root.entries.map((entry) => `${entry.kind}:${entry.path}`)).toEqual([
      "directory:src",
      "file:README.md",
    ]);
    const source = await first.session.listFiles(first.workspace.id, { path: "src" });
    expect(source.entries).toMatchObject([{ path: "src/index.ts", language: "typescript" }]);

    await expect(second.session.readFile(first.workspace.id, file.path)).rejects.toBeInstanceOf(
      AgentIsolationError,
    );

    const scratchpad = await first.session.getScratchpad(first.workspace.id);
    const updatedScratchpad = await first.session.updateScratchpad(
      first.workspace.id,
      "Need human confirmation on release scope.",
      scratchpad.etag,
    );
    expect(updatedScratchpad.content).toContain("human confirmation");
    await expect(
      first.session.updateScratchpad(first.workspace.id, "stale edit", scratchpad.etag),
    ).rejects.toBeInstanceOf(AgentConflictError);
  });

  it("rejects traversal, out-of-lease paths, and stale file writes", async () => {
    const transport = new InMemoryAgentTransport();
    const { session, workspace } = await operatingSession(transport, {
      allowed_paths: ["src"],
    });

    await expect(
      session.writeFile(workspace.id, { path: "../secrets.txt", content: "no" }),
    ).rejects.toBeInstanceOf(AgentIsolationError);
    await expect(
      session.writeFile(workspace.id, { path: "%2e%2e/secrets.txt", content: "no" }),
    ).rejects.toBeInstanceOf(AgentIsolationError);
    await expect(
      session.writeFile(workspace.id, { path: "docs/readme.md", content: "no" }),
    ).rejects.toBeInstanceOf(AgentIsolationError);

    const first = await session.writeFile(workspace.id, {
      path: "src/main.ts",
      content: "export {};\n",
    });
    const current = await session.writeFile(workspace.id, {
      path: "src/main.ts",
      content: "export const current = true;\n",
      expected_etag: first.etag,
    });
    expect(current.etag).not.toBe(first.etag);
    await expect(
      session.writeFile(workspace.id, {
        path: "src/main.ts",
        content: "export const stale = true;\n",
        expected_etag: first.etag,
      }),
    ).rejects.toBeInstanceOf(AgentConflictError);
  });

  it("does not let observe-mode sessions mutate a workspace", async () => {
    const transport = new InMemoryAgentTransport();
    const session = await AgentSession.start(transport, {
      board_id: boardId,
      agent_id: "agent_observer",
      mode: "observe",
      goal: "Observe board progress",
    });

    await expect(session.createWorkspace({ profile: "external" })).rejects.toBeInstanceOf(
      AgentModeError,
    );
    const context = await session.getContext({ purpose: "review" });
    expect(context.board_id).toBe(boardId);
  });

  it("enforces agent modes at the transport boundary as well as in the session helper", async () => {
    const transport = new InMemoryAgentTransport();
    const started = await transport.startRun({
      board_id: boardId,
      agent_id: "agent_contributor",
      mode: "contribute",
      goal: "Draft the implementation plan",
    });

    await expect(
      transport.createWorkspace({
        board_id: boardId,
        agent_id: "agent_contributor",
        profile: "external",
        access: { run_id: started.run.id, lease_id: started.lease.id },
      }),
    ).rejects.toBeInstanceOf(AgentModeError);
  });
});

describe("InMemoryAgentTransport handoff checkpoints", () => {
  it("pins an immutable revision and workspace snapshot, then freezes mutable authority", async () => {
    const transport = new InMemoryAgentTransport();
    const { session, workspace } = await operatingSession(transport);
    const file = await session.writeFile(workspace.id, {
      path: "src/release.ts",
      content: "export const ready = true;\n",
    });

    const packet = {
      goal: "Approve the release-ready implementation",
      source_revision_id: "rev_042",
      completed_work: ["Implemented workspace file isolation"],
      evidence: [
        { kind: "test" as const, title: "Unit suite", summary: "All checks pass", verified: true },
      ],
      risks: [
        { category: "deployment" as const, summary: "Production rollout still needs approval" },
      ],
      requested_decision: {
        kind: "release_approval",
        question: "May the agent prepare the release?",
        choices: [
          { id: "approve", label: "Approve" },
          { id: "changes", label: "Request changes" },
        ],
        resume_allowed: true,
      },
      belief_trace: sampleBelief(session.run.id),
    };
    const draft = await session.createHandoff(packet, {
      agent_workspace_id: workspace.id,
      revision_id: "rev_042",
    });
    packet.goal = "Mutated outside the SDK";

    const submitted = await session.submitHandoff(draft.id);
    expect(submitted.state).toBe("awaiting_review");
    expect(submitted.revision_id).toBe("rev_042");
    expect(submitted.packet.goal).toBe("Approve the release-ready implementation");
    expect(submitted.packet_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(submitted.packet.workspace_snapshot).toMatchObject({
      workspace_id: workspace.id,
      file_count: 1,
    });
    const callerCopy = await session.getHandoff(submitted.id);
    callerCopy.packet.goal = "Attempted post-submit mutation";
    expect((await session.getHandoff(submitted.id)).packet.goal).toBe(
      "Approve the release-ready implementation",
    );

    await expect(
      session.writeFile(workspace.id, {
        path: file.path,
        content: "export const ready = false;\n",
        expected_etag: file.etag,
      }),
    ).rejects.toBeInstanceOf(AgentLeaseError);

    await expect(
      AgentSession.start(transport, {
        board_id: boardId,
        agent_id: "agent_builder",
        mode: "operate",
        goal: "Attempt to bypass review",
      }),
    ).rejects.toBeInstanceOf(AgentLeaseError);

    const pending = await session.listHandoffs("awaiting_review");
    expect(pending.map((handoff) => handoff.id)).toEqual([submitted.id]);
  });

  it("records a structured human decision and resumes only with a fresh lease", async () => {
    const transport = new InMemoryAgentTransport();
    const { session, workspace } = await operatingSession(transport);
    const original = await session.writeFile(workspace.id, {
      path: "src/index.ts",
      content: "export const status = 'draft';\n",
    });
    const handoff = await session.createHandoff(
      {
        goal: "Review the implementation",
        requested_decision: {
          kind: "code_review",
          question: "Approve this patch?",
          choices: [{ id: "approve", label: "Approve" }],
        },
        belief_trace: sampleBelief(session.run.id),
      },
      { agent_workspace_id: workspace.id },
    );
    const submitted = await session.submitHandoff(handoff.id);
    const claimed = await transport.claimHandoff({
      board_id: boardId,
      handoff_id: submitted.id,
      reviewer_id: "user_reviewer",
    });
    expect(claimed.state).toBe("in_review");

    const decided = await transport.decideHandoff({
      board_id: boardId,
      handoff_id: submitted.id,
      reviewer_id: "user_reviewer",
      outcome: "approve_with_conditions",
      rationale: "Proceed only in staging.",
      conditions: { environment: "staging" },
    });
    expect(decided.state).toBe("approved");
    expect(decided.decisions).toHaveLength(1);
    expect(decided.decisions[0]).toMatchObject({
      packet_hash: submitted.packet_hash,
      conditions: { environment: "staging" },
    });

    await expect(
      AgentSession.start(transport, {
        board_id: boardId,
        agent_id: "agent_builder",
        mode: "operate",
        goal: "Try to restart without a causal handoff resume",
      }),
    ).rejects.toBeInstanceOf(AgentLeaseError);

    const resumed = await session.resumeHandoff(submitted.id, {
      goal: "Apply reviewed staging-only follow-up",
    });
    expect(resumed.run.id).not.toBe(session.run.id);
    expect(resumed.lease.id).not.toBe(session.lease.id);
    expect(resumed.run.base_revision_id).toBe(submitted.revision_id);
    const updated = await resumed.writeFile(workspace.id, {
      path: original.path,
      content: "export const status = 'reviewed';\n",
      expected_etag: original.etag,
    });
    expect(updated.content).toContain("reviewed");
    const completedHandoff = await resumed.getHandoff(submitted.id);
    expect(completedHandoff.state).toBe("resumed");
  });

  it("refuses to submit a draft without a belief_trace", async () => {
    const transport = new InMemoryAgentTransport();
    const { session, workspace } = await operatingSession(transport);
    const draft = await session.createHandoff(
      {
        goal: "Review without a theory",
        requested_decision: {
          kind: "code_review",
          question: "Approve this patch?",
          choices: [{ id: "approve", label: "Approve" }],
        },
      },
      { agent_workspace_id: workspace.id },
    );
    await expect(session.submitHandoff(draft.id)).rejects.toMatchObject({
      name: "HandoffStateError",
      code: "handoff.belief_trace_required",
    });
    await expect(session.submitHandoff(draft.id)).rejects.toBeInstanceOf(HandoffStateError);
  });
});
