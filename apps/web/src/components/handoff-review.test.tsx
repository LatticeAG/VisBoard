import { cleanup, render, screen } from "@testing-library/react";
import type { HandoffSummary } from "@visboard/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { HandoffReview } from "./handoff-review";

const pending: HandoffSummary = {
  id: "hof_pending",
  board_id: "brd_01",
  state: "awaiting_review",
  packet: {
    goal: "Ship the isolation patch",
    requested_decision: { question: "May the agent continue?" },
    change_summary: [{ summary: "Added scoped file writes" }],
    evidence: [{ title: "Unit suite", verified: true }],
    risks: [{ summary: "Production still gated" }],
    source_revision_id: "rev_old",
    belief_trace: {
      beliefs: [{ id: "b1", statement: "Isolation holds", weight: 0.9 }],
      assumptions: [{ id: "a1", statement: "Reviewer is online", weight: 0.4 }],
      overweighted: [],
      ignored: [{ id: "i1", statement: "Legacy V1 notes" }],
    },
  },
  packet_hash: "abc",
  belief_trace_hash: "def",
  claimed_by_id: null,
  revision_id: "rev_old",
};

afterEach(() => {
  cleanup();
});

describe("HandoffReview", () => {
  it("renders the pending handoff summary", () => {
    render(
      <HandoffReview
        workspaceId="ws_01"
        boardId="brd_01"
        headRevisionId="rev_old"
        handoffs={[pending]}
      />,
    );
    expect(screen.getAllByText("Ship the isolation patch").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Isolation holds/).length).toBeGreaterThan(0);
  });

  it("warns when the board revision has moved", () => {
    render(
      <HandoffReview
        workspaceId="ws_01"
        boardId="brd_01"
        headRevisionId="rev_new"
        handoffs={[pending]}
      />,
    );
    expect(
      screen.getByText("Board has moved since this handoff. Restore or diff before approving."),
    ).toBeTruthy();
  });

  it("disables approve without a rationale", () => {
    render(
      <HandoffReview
        workspaceId="ws_01"
        boardId="brd_01"
        headRevisionId="rev_old"
        handoffs={[pending]}
      />,
    );
    const approve = screen.getAllByRole("button", { name: "Approve" })[0];
    expect(approve).toHaveProperty("disabled", true);
  });
});
