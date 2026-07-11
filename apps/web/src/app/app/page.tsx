'use client';

import { useEffect, useState } from 'react';
import { AppHeader } from '@/components/app-header';
import { api } from '@/lib/api-client';
import type { Workspace } from '@visboard/sdk';

export default function WorkspaceListPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [mock, setMock] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.workspaces.list().then((result) => {
      if (result.ok) {
        setWorkspaces(result.data);
        setMock(result.mock);
      } else {
        setError(result.error);
      }
      setLoading(false);
    });
  }, []);

  return (
    <>
      <AppHeader title="Workspaces" />
      <main className="flex-1 overflow-y-auto p-6">
        {mock && (
          <div className="mb-4 border border-accent-dim bg-surface px-4 py-3 font-mono text-xs text-muted">
            API unavailable — showing mock data. Set your PAT in Settings and ensure the API is running.
          </div>
        )}

        {error && (
          <div className="mb-4 border border-red-900 bg-surface px-4 py-3 font-mono text-xs text-red-400">
            {error}
          </div>
        )}

        {loading ? (
          <p className="font-mono text-sm text-muted">Loading workspaces…</p>
        ) : workspaces.length === 0 ? (
          <div className="border border-border bg-surface p-6">
            <h2 className="mb-2 font-mono text-sm text-text">No workspaces yet</h2>
            <p className="mb-4 font-mono text-xs text-muted">
              Bootstrap your first workspace with the CLI:
            </p>
            <pre className="overflow-x-auto border border-border bg-bg p-4 font-mono text-xs text-accent">
              visboard auth bootstrap --name &quot;My Workspace&quot;
            </pre>
            <p className="mt-4 font-mono text-xs text-muted">
              Then paste the returned token in Settings (top right).
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border border border-border bg-surface">
            {workspaces.map((ws) => (
              <li key={ws.id}>
                <a
                  href={`/app/${ws.slug}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-bg"
                >
                  <div>
                    <span className="font-mono text-sm text-text">{ws.name}</span>
                    <span className="ml-3 font-mono text-xs text-muted">{ws.slug}</span>
                  </div>
                  <span className="font-mono text-xs text-accent">→</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
