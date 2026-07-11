'use client';

import { useEffect, useState } from 'react';
import { SettingsModal } from './settings-modal';
import { hasToken } from '@/lib/auth';

interface AppHeaderProps {
  title?: string;
  breadcrumb?: { label: string; href?: string }[];
}

export function AppHeader({ title, breadcrumb }: AppHeaderProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    setAuthed(hasToken());
  }, []);

  return (
    <header className="flex h-12 shrink-0 items-center border-b border-border bg-surface px-4">
      <div className="flex items-center gap-3 font-mono text-sm">
        <a href="/app" className="font-semibold text-accent hover:underline">
          VisBoard
        </a>
        {breadcrumb?.map((crumb, i) => (
          <span key={crumb.label} className="flex items-center gap-3 text-muted">
            <span>/</span>
            {crumb.href ? (
              <a href={crumb.href} className="hover:text-text">
                {crumb.label}
              </a>
            ) : (
              <span className="text-text">{crumb.label}</span>
            )}
          </span>
        ))}
        {title && !breadcrumb && <span className="text-text">{title}</span>}
      </div>

      <div className="ml-auto flex items-center gap-3">
        <span
          className={`font-mono text-xs ${authed ? 'text-success' : 'text-muted'}`}
          title={authed ? 'Token configured' : 'No token'}
        >
          {authed ? '● authed' : '○ no token'}
        </span>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="border border-border px-3 py-1 font-mono text-xs text-muted hover:border-accent hover:text-text"
        >
          Settings
        </button>
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => setAuthed(hasToken())}
      />
    </header>
  );
}
