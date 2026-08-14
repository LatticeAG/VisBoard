"use client";

import { AppHeader } from "@/components/app-header";
import { BoardCanvas } from "@/components/board-canvas";
import { HandoffReview } from "@/components/handoff-review";
import { InlineAlert } from "@/components/toast";
import { getV2Client } from "@/lib/v2-client";
import type { BoardBlock, BoardRevision, BoardState } from "@visboard/sdk";
import { useEffect, useState } from "react";

type RouteParams = { workspace: string; board: string };

export default function BoardPage({ params }: { params: Promise<RouteParams> }) {
  const [route, setRoute] = useState<RouteParams | null>(null);
  const [state, setState] = useState<BoardState | null>(null);
  const [revisions, setRevisions] = useState<BoardRevision[]>([]);
  const [selectedBlock, setSelectedBlock] = useState<BoardBlock | null>(null);
  const [selectedRevision, setSelectedRevision] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void params.then(setRoute);
  }, [params]);

  const load = async () => {
    if (!route) return;
    setLoading(true);
    setError(null);
    try {
      const client = getV2Client();
      const [nextState, nextRevisions] = await Promise.all([
        client.boards.getState(route.workspace, route.board),
        client.boards.listRevisions(route.workspace, route.board),
      ]);
      setState(nextState);
      setRevisions(nextRevisions);
      setSelectedRevision(nextState.head_revision?.id ?? "");
      setSelectedBlock((current) =>
        current ? (nextState.blocks.find((block) => block.id === current.id) ?? null) : null,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load board");
    } finally {
      setLoading(false);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: load is recreated each render; route ids are the trigger
  useEffect(() => {
    void load();
  }, [route?.workspace, route?.board]);

  const capture = async () => {
    if (!route || !state) return;
    setBusy(true);
    try {
      await getV2Client().boards.captureRevision(
        route.workspace,
        route.board,
        { label: "Manual checkpoint" },
        { idempotencyKey: crypto.randomUUID(), expectedDocumentId: state.document.id },
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to capture revision");
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!route || !state || !selectedRevision) return;
    const confirmed = window.confirm(
      "Restore this revision into a new board document epoch? Current history remains available.",
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      await getV2Client().boards.restore(
        route.workspace,
        route.board,
        {
          revision_id: selectedRevision,
          expected_document_id: state.document.id,
          reason: "Restored from the V3 board timeline",
        },
        { idempotencyKey: crypto.randomUUID(), expectedDocumentId: state.document.id },
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to restore revision");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <>
        <AppHeader title="Board" />
        <main className="flex flex-1 items-center justify-center font-mono text-sm text-muted">
          Loading board
        </main>
      </>
    );
  }

  return (
    <>
      <AppHeader
        breadcrumb={[
          { label: "V3 boards", href: route ? `/app/v2/${route.workspace}` : undefined },
          { label: state?.board.name ?? "Board" },
        ]}
      />
      <main className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_18rem_320px]">
        <section className="min-h-0 overflow-y-auto p-4 md:p-6">
          {error && <InlineAlert message={error} variant="error" className="mb-4" />}
          {state && (
            <>
              <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
                <div>
                  <h1 className="font-mono text-xl text-text">{state.board.name}</h1>
                  <p className="mt-1 font-mono text-xs text-muted">
                    {state.board.description || "A shared board with durable revisions."}
                  </p>
                </div>
                <div className="font-mono text-[10px] text-muted">
                  Document epoch {state.document.epoch} - sequence {state.board.head_sequence}
                </div>
              </div>
              <BoardCanvas
                blocks={state.blocks}
                selectedBlockId={selectedBlock?.id}
                onSelectBlock={setSelectedBlock}
              />
            </>
          )}
        </section>

        <aside className="min-h-0 border-l border-border bg-surface p-4 lg:overflow-y-auto">
          <h2 className="font-mono text-xs uppercase tracking-wide text-muted">
            Revision timeline
          </h2>
          <p className="mt-2 font-mono text-xs leading-5 text-muted">
            Checkpoints preserve block topology and content before a restore creates a new epoch.
          </p>
          <button
            type="button"
            onClick={capture}
            disabled={busy || !state}
            className="mt-4 w-full border border-accent bg-accent-dim px-3 py-2 font-mono text-xs text-text hover:bg-accent disabled:opacity-50"
          >
            Capture checkpoint
          </button>

          <label className="mt-4 block font-mono text-xs text-muted" htmlFor="revision-select">
            Restore revision
          </label>
          <select
            id="revision-select"
            value={selectedRevision}
            onChange={(event) => setSelectedRevision(event.target.value)}
            className="mt-1 w-full border border-border bg-bg px-2 py-2 font-mono text-xs text-text outline-none focus:border-accent"
          >
            <option value="">Select a revision</option>
            {revisions.map((revision) => (
              <option key={revision.id} value={revision.id}>
                #{revision.revision_number} {revision.label || revision.trigger}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={restore}
            disabled={busy || !selectedRevision || !state}
            className="mt-2 w-full border border-border px-3 py-2 font-mono text-xs text-muted hover:border-accent hover:text-text disabled:opacity-50"
          >
            Restore selected revision
          </button>

          {selectedBlock && (
            <div className="mt-6 border-t border-border pt-4">
              <h2 className="font-mono text-xs uppercase tracking-wide text-muted">
                Selected block
              </h2>
              <p className="mt-2 break-all font-mono text-xs text-text">{selectedBlock.id}</p>
              <p className="mt-1 font-mono text-xs text-muted">{selectedBlock.type}</p>
              <p className="mt-3 font-mono text-xs leading-5 text-muted">
                Visibility: {selectedBlock.visibility}. Lifecycle: {selectedBlock.lifecycle_state}.
              </p>
            </div>
          )}
        </aside>
        {route && (
          <HandoffReview
            workspaceId={route.workspace}
            boardId={route.board}
            headRevisionId={state?.head_revision?.id ?? null}
            onChanged={() => void load()}
          />
        )}
      </main>
    </>
  );
}
