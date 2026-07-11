'use client';

import { useEffect, useState } from 'react';
import { AppHeader } from '@/components/app-header';
import { InlineAlert } from '@/components/toast';
import { api, isDemoMode } from '@/lib/api-client';
import { hasToken } from '@/lib/auth';
import type { Workspace } from '@visboard/sdk';

type OnboardingState =
  | 'loading'
  | 'demo'
  | 'error'
  | 'no-token'
  | 'create-workspace'
  | 'list';

export default function WorkspaceListPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [state, setState] = useState<OnboardingState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<'auth' | 'network' | 'api' | null>(null);
  const [apiReachable, setApiReachable] = useState(false);

  const [wsName, setWsName] = useState('');
  const [wsSlug, setWsSlug] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const loadWorkspaces = async () => {
    setState('loading');
    setError(null);
    setErrorKind(null);

    if (isDemoMode()) {
      const result = await api.workspaces.list();
      if (result.ok) {
        setWorkspaces(result.data);
        setState('demo');
      }
      return;
    }

    const health = await api.health.check();
    setApiReachable(health.ok);

    const result = await api.workspaces.list();
    if (!result.ok) {
      setError(result.error);
      setErrorKind(result.kind ?? null);
      setState('error');
      return;
    }

    setWorkspaces(result.data);

    if (result.data.length === 0) {
      if (hasToken()) {
        setState('create-workspace');
      } else if (health.ok) {
        setState('no-token');
      } else {
        setState('no-token');
      }
      return;
    }

    setState('list');
  };

  useEffect(() => {
    loadWorkspaces();
  }, []);

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wsName.trim()) {
      setCreateError('Name is required');
      return;
    }

    setCreating(true);
    setCreateError(null);

    const input = { name: wsName.trim() };
    const body = wsSlug.trim()
      ? { ...input, slug: wsSlug.trim() }
      : input;

    const result = await api.workspaces.create(body);
    setCreating(false);

    if (!result.ok) {
      setCreateError(result.error);
      return;
    }

    setWsName('');
    setWsSlug('');
    await loadWorkspaces();
  };

  return (
    <>
      <AppHeader title="Workspaces" />
      <main className="flex-1 overflow-y-auto p-6">
        {state === 'demo' && (
          <InlineAlert
            message="Demo mode — add ?demo=1 to explore with mock data. Remove the query param and set your PAT for live data."
            variant="info"
            className="mb-4"
          />
        )}

        {state === 'error' && error && (
          <InlineAlert
            message={error}
            variant="error"
            className="mb-4"
          />
        )}

        {state === 'loading' && (
          <p className="font-mono text-sm text-muted">Loading workspaces…</p>
        )}

        {state === 'no-token' && (
          <div className="border border-border bg-surface p-6">
            <h2 className="mb-2 font-mono text-sm text-text">Get started with VisBoard</h2>
            {apiReachable ? (
              <>
                <p className="mb-4 font-mono text-xs text-muted">
                  API is reachable but no workspaces exist yet. Bootstrap your first workspace
                  with the CLI:
                </p>
                <pre className="overflow-x-auto border border-border bg-bg p-4 font-mono text-xs text-accent">
                  visboard auth bootstrap --name &quot;My Workspace&quot;
                </pre>
                <p className="mt-4 font-mono text-xs text-muted">
                  Then paste the returned token in Settings (top right).
                </p>
              </>
            ) : (
              <>
                <p className="mb-4 font-mono text-xs text-muted">
                  Cannot reach the API. Start the server and verify the API URL in Settings.
                </p>
                <p className="font-mono text-xs text-muted">
                  Default: <code className="text-accent">http://localhost:8080/v1</code>
                </p>
              </>
            )}
          </div>
        )}

        {state === 'create-workspace' && (
          <div className="border border-border bg-surface p-6">
            <h2 className="mb-2 font-mono text-sm text-text">Create your first workspace</h2>
            <p className="mb-4 font-mono text-xs text-muted">
              You are authenticated but have no workspaces yet.
            </p>

            <form onSubmit={handleCreateWorkspace} className="max-w-md">
              <label className="mb-1 block font-mono text-xs text-muted" htmlFor="ws-name">
                Name
              </label>
              <input
                id="ws-name"
                type="text"
                value={wsName}
                onChange={(e) => setWsName(e.target.value)}
                className="mb-3 w-full border border-border bg-bg px-3 py-2 font-mono text-sm text-text outline-none focus:border-accent"
                placeholder="My Workspace"
              />

              <label className="mb-1 block font-mono text-xs text-muted" htmlFor="ws-slug">
                Slug (optional)
              </label>
              <input
                id="ws-slug"
                type="text"
                value={wsSlug}
                onChange={(e) => setWsSlug(e.target.value)}
                className="mb-4 w-full border border-border bg-bg px-3 py-2 font-mono text-sm text-text outline-none focus:border-accent"
                placeholder="my-workspace"
              />

              {createError && (
                <p className="mb-3 font-mono text-xs text-red-400">{createError}</p>
              )}

              <button
                type="submit"
                disabled={creating}
                className="border border-accent bg-accent-dim px-4 py-1.5 font-mono text-xs text-text hover:bg-accent disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create workspace'}
              </button>
            </form>

            <p className="mt-6 font-mono text-xs text-muted">
              Or bootstrap via CLI:{' '}
              <code className="text-accent">visboard auth bootstrap --name &quot;My Workspace&quot;</code>
            </p>
          </div>
        )}

        {(state === 'list' || state === 'demo') && workspaces.length > 0 && (
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

        {state === 'list' && workspaces.length === 0 && !error && (
          <p className="font-mono text-sm text-muted">No workspaces found.</p>
        )}

        {errorKind === 'auth' && (
          <p className="mt-4 font-mono text-xs text-muted">
            Open Settings to paste your personal access token.
          </p>
        )}
      </main>
    </>
  );
}
