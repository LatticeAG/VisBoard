"use client";

import { getV2Client } from "@/lib/v2-client";
import type { HandoffSummary } from "@visboard/sdk";
import { useCallback, useEffect, useMemo, useState } from "react";

export interface HandoffReviewProps {
  workspaceId: string;
  boardId: string;
  headRevisionId?: string | null;
  handoffs?: HandoffSummary[];
  onChanged?: () => void;
}

type Entry = {
  id: string;
  statement: string;
  weight?: number;
};

function listEntries(items: Entry[] | undefined): Entry[] {
  return Array.isArray(items) ? items : [];
}

export function HandoffReview({
  workspaceId,
  boardId,
  headRevisionId,
  handoffs: injected,
  onChanged,
}: HandoffReviewProps) {
  const [items, setItems] = useState<HandoffSummary[]>(injected ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rationale, setRationale] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (injected) {
      setItems(injected);
      return;
    }
    try {
      const client = getV2Client();
      const [awaiting, reviewing] = await Promise.all([
        client.handoffs.list(workspaceId, boardId, "awaiting_review"),
        client.handoffs.list(workspaceId, boardId, "in_review"),
      ]);
      const next = [...awaiting, ...reviewing];
      setItems(next);
      setSelectedId((current) => current ?? next[0]?.id ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load handoffs");
    }
  }, [boardId, injected, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (injected) {
      setItems(injected);
      setSelectedId((current) => current ?? injected[0]?.id ?? null);
    }
  }, [injected]);

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? items[0] ?? null,
    [items, selectedId],
  );

  const stale =
    Boolean(selected) &&
    Boolean(headRevisionId) &&
    selected?.packet.source_revision_id !== undefined &&
    selected?.packet.source_revision_id !== null &&
    selected.packet.source_revision_id !== headRevisionId;

  const canDecide = rationale.trim().length > 0 && !busy && Boolean(selected);

  async function run(action: () => Promise<unknown>): Promise<void> {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      setRationale("");
      onChanged?.();
      if (!injected) await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Handoff action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex h-full min-h-0 w-[320px] shrink-0 flex-col border-l border-border bg-surface">
      <div className="border-b border-border p-4">
        <h2 className="font-mono text-xs uppercase tracking-wide text-muted">Handoff review</h2>
        <p className="mt-2 font-mono text-xs leading-5 text-muted">
          Decide on submitted agent work without leaving the board.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {error && <p className="mb-3 font-mono text-xs text-red-400">{error}</p>}

        {items.length === 0 && (
          <p className="font-mono text-xs text-muted">No handoffs awaiting review.</p>
        )}

        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={`w-full border px-2 py-2 text-left font-mono text-xs ${
                  selected?.id === item.id
                    ? "border-accent bg-accent-dim text-text"
                    : "border-border text-muted hover:border-accent hover:text-text"
                }`}
              >
                <span className="block text-text">{item.packet.goal}</span>
                <span className="mt-1 block text-[10px] uppercase">{item.state}</span>
              </button>
            </li>
          ))}
        </ul>

        {selected && (
          <div className="mt-4 space-y-4">
            <div>
              <h3 className="font-mono text-[10px] uppercase tracking-wide text-muted">Goal</h3>
              <p className="mt-1 font-mono text-xs text-text">{selected.packet.goal}</p>
            </div>
            <div>
              <h3 className="font-mono text-[10px] uppercase tracking-wide text-muted">Decision</h3>
              <p className="mt-1 font-mono text-xs text-text">
                {selected.packet.requested_decision?.question ?? "No question provided"}
              </p>
            </div>
            {selected.packet.change_summary?.length ? (
              <div>
                <h3 className="font-mono text-[10px] uppercase tracking-wide text-muted">
                  Changes
                </h3>
                <ul className="mt-1 list-disc pl-4 font-mono text-xs text-text">
                  {selected.packet.change_summary.map((change) => (
                    <li key={change.summary}>{change.summary}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {selected.packet.evidence?.length ? (
              <div>
                <h3 className="font-mono text-[10px] uppercase tracking-wide text-muted">
                  Evidence
                </h3>
                <ul className="mt-1 space-y-1 font-mono text-xs">
                  {selected.packet.evidence.map((item) => (
                    <li key={item.title} className={item.verified ? "text-success" : "text-muted"}>
                      {item.title}
                      {item.verified ? " (verified)" : " (unverified)"}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {selected.packet.risks?.length ? (
              <div>
                <h3 className="font-mono text-[10px] uppercase tracking-wide text-muted">Risks</h3>
                <ul className="mt-1 list-disc pl-4 font-mono text-xs text-text">
                  {selected.packet.risks.map((risk) => (
                    <li key={risk.summary}>{risk.summary}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <BeliefLists trace={selected.packet.belief_trace} />

            <p className="font-mono text-[10px] text-muted">
              Pinned revision:{" "}
              {selected.packet.source_revision_id ?? selected.revision_id ?? "none"}
            </p>
            {stale && (
              <p className="border border-accent bg-accent-dim px-2 py-2 font-mono text-xs text-text">
                Board has moved since this handoff. Restore or diff before approving.
              </p>
            )}

            <label className="block font-mono text-[10px] uppercase text-muted" htmlFor="rationale">
              Rationale
            </label>
            <textarea
              id="rationale"
              value={rationale}
              onChange={(event) => setRationale(event.target.value)}
              className="mt-1 h-20 w-full border border-border bg-bg px-2 py-2 font-mono text-xs text-text outline-none focus:border-accent"
            />

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy || !selected}
                onClick={() =>
                  run(() => getV2Client().handoffs.claim(workspaceId, boardId, selected.id))
                }
                className="border border-border px-2 py-2 font-mono text-[10px] text-muted hover:border-accent hover:text-text disabled:opacity-50"
              >
                Claim
              </button>
              <button
                type="button"
                disabled={!canDecide}
                onClick={() =>
                  run(() =>
                    getV2Client().handoffs.decide(workspaceId, boardId, selected.id, {
                      outcome: "approve",
                      rationale: rationale.trim(),
                    }),
                  )
                }
                className="border border-accent bg-accent-dim px-2 py-2 font-mono text-[10px] text-text hover:bg-accent disabled:opacity-50"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={!canDecide}
                onClick={() =>
                  run(() =>
                    getV2Client().handoffs.decide(workspaceId, boardId, selected.id, {
                      outcome: "request_changes",
                      rationale: rationale.trim(),
                    }),
                  )
                }
                className="border border-border px-2 py-2 font-mono text-[10px] text-muted hover:border-accent hover:text-text disabled:opacity-50"
              >
                Request changes
              </button>
              <button
                type="button"
                disabled={!canDecide}
                onClick={() =>
                  run(() =>
                    getV2Client().handoffs.decide(workspaceId, boardId, selected.id, {
                      outcome: "reject",
                      rationale: rationale.trim(),
                    }),
                  )
                }
                className="border border-border px-2 py-2 font-mono text-[10px] text-muted hover:border-accent hover:text-text disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function BeliefLists({
  trace,
}: {
  trace?: {
    beliefs?: Entry[];
    assumptions?: Entry[];
    overweighted?: Entry[];
    ignored?: Entry[];
  };
}) {
  const groups: Array<{ label: string; items: Entry[] }> = [
    { label: "Beliefs", items: listEntries(trace?.beliefs) },
    { label: "Assumptions", items: listEntries(trace?.assumptions) },
    { label: "Overweighted", items: listEntries(trace?.overweighted) },
    { label: "Ignored", items: listEntries(trace?.ignored) },
  ];
  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.label}>
          <h3 className="font-mono text-[10px] uppercase tracking-wide text-muted">
            {group.label}
          </h3>
          {group.items.length === 0 ? (
            <p className="mt-1 font-mono text-xs text-muted">None</p>
          ) : (
            <ul className="mt-1 space-y-1 font-mono text-xs text-text">
              {group.items.map((item) => (
                <li key={item.id}>
                  {item.statement}
                  {typeof item.weight === "number" ? ` (${item.weight})` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
