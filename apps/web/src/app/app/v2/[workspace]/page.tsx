'use client';

import { useEffect, useState } from 'react';
import type { Board } from '@visboard/sdk';
import { AppHeader } from '@/components/app-header';
import { InlineAlert } from '@/components/toast';
import { getV2Client } from '@/lib/v2-client';

export default function V2BoardListPage({ params }: { params: Promise<{ workspace: string }> }) {
  const [workspaceId, setWorkspaceId] = useState('');
  const [boards, setBoards] = useState<Board[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void params.then(({ workspace }) => setWorkspaceId(workspace));
  }, [params]);

  const load = async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      setBoards(await getV2Client().boards.list(workspaceId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load boards');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [workspaceId]);

  const createBoard = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !workspaceId) return;
    setCreating(true);
    setError(null);
    try {
      const board = await getV2Client().boards.create(
        workspaceId,
        { name: name.trim() },
        { idempotencyKey: crypto.randomUUID() },
      );
      setName('');
      window.location.assign(`/app/v2/${workspaceId}/boards/${board.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create board');
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <AppHeader breadcrumb={[{ label: 'V3 boards' }, { label: workspaceId || 'workspace' }]} />
      <main className="mx-auto w-full max-w-6xl flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mb-6 max-w-2xl">
          <h1 className="font-mono text-xl text-text">Boards</h1>
          <p className="mt-2 font-mono text-xs leading-5 text-muted">
            Versioned collaboration surfaces for people and agents. Workspace ID: {workspaceId || 'loading'}.
          </p>
        </div>

        {error && <InlineAlert message={error} variant="error" className="mb-4" />}

        <form onSubmit={createBoard} className="mb-6 flex max-w-xl gap-2">
          <label className="sr-only" htmlFor="board-name">Board name</label>
          <input
            id="board-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="New board name"
            className="min-w-0 flex-1 border border-border bg-surface px-3 py-2 font-mono text-sm text-text outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={creating || !name.trim()}
            className="border border-accent bg-accent-dim px-4 py-2 font-mono text-xs text-text hover:bg-accent disabled:opacity-50"
          >
            {creating ? 'Creating' : 'Create board'}
          </button>
        </form>

        {loading ? (
          <div className="grid gap-2">
            <div className="h-16 animate-pulse border border-border bg-surface" />
            <div className="h-16 animate-pulse border border-border bg-surface" />
          </div>
        ) : boards.length === 0 ? (
          <div className="border border-dashed border-border p-6 font-mono text-sm text-muted">
            Create a board to start a shared, versioned workspace.
          </div>
        ) : (
          <ul className="border border-border bg-surface">
            {boards.map((board) => (
              <li key={board.id} className="border-b border-border last:border-b-0">
                <a
                  href={`/app/v2/${workspaceId}/boards/${board.id}`}
                  className="block px-4 py-3 hover:bg-bg"
                >
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-mono text-sm text-text">{board.name}</span>
                    <span className="font-mono text-xs text-muted">{board.status}</span>
                  </div>
                  <p className="mt-1 font-mono text-xs text-muted">{board.description || board.slug}</p>
                </a>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
