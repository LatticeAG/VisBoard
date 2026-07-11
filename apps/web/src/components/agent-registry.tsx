'use client';

import type { Agent } from '@visboard/sdk';

interface AgentRegistryProps {
  agents: Agent[];
  loading?: boolean;
  error?: string | null;
}

export function AgentRegistry({ agents, loading, error }: AgentRegistryProps) {
  return (
    <div className="border-b border-border bg-surface px-4 py-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs uppercase tracking-wide text-muted">
          Agents
        </span>
        <span className="font-mono text-xs text-muted">
          {loading ? '…' : `${agents.length} registered`}
        </span>
      </div>

      {error && (
        <p className="mt-1 font-mono text-xs text-red-400">{error}</p>
      )}

      {!loading && !error && agents.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {agents.map((agent) => (
            <li
              key={agent.id}
              className="border border-border px-2 py-1 font-mono text-xs"
              title={agent.description || agent.id}
            >
              <span
                className={
                  agent.status === 'active' ? 'text-success' : 'text-muted'
                }
              >
                {agent.name}
              </span>
              <span className="ml-2 text-muted">{agent.token_prefix}…</span>
            </li>
          ))}
        </ul>
      )}

      {!loading && !error && agents.length === 0 && (
        <p className="mt-1 font-mono text-xs text-muted">
          No agents — register via{' '}
          <code className="text-accent">visboard agent create</code>
        </p>
      )}
    </div>
  );
}
