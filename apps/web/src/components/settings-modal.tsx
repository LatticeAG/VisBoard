'use client';

import { useEffect, useState } from 'react';
import {
  setToken,
  clearToken,
  getToken,
  getApiUrl,
  setApiUrl,
  getDefaultApiUrl,
} from '@/lib/auth';
import { refreshClient } from '@/lib/api-client';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export function SettingsModal({ open, onClose, onSaved }: SettingsModalProps) {
  const [token, setTokenValue] = useState('');
  const [apiUrl, setApiUrlValue] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (open) {
      setTokenValue(getToken() ?? '');
      setApiUrlValue(getApiUrl());
      setSaved(false);
    }
  }, [open]);

  if (!open) return null;

  const handleSave = () => {
    if (token.trim()) {
      setToken(token.trim());
    }
    if (apiUrl.trim()) {
      setApiUrl(apiUrl.trim());
    }
    refreshClient();
    setSaved(true);
    onSaved?.();
  };

  const handleClear = () => {
    clearToken();
    setTokenValue('');
    refreshClient();
    setSaved(true);
    onSaved?.();
  };

  const handleResetApiUrl = () => {
    setApiUrlValue(getDefaultApiUrl());
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      role="presentation"
    >
      <div
        className="w-full max-w-md border border-border bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="settings-title"
      >
        <h2
          id="settings-title"
          className="mb-4 font-mono text-sm font-semibold uppercase tracking-wider text-muted"
        >
          Settings
        </h2>

        <label className="mb-1 block font-mono text-xs text-muted" htmlFor="api-url-input">
          API Endpoint URL
        </label>
        <input
          id="api-url-input"
          type="url"
          value={apiUrl}
          onChange={(e) => setApiUrlValue(e.target.value)}
          placeholder={getDefaultApiUrl()}
          className="mb-1 w-full border border-border bg-bg px-3 py-2 font-mono text-sm text-text outline-none focus:border-accent"
        />
        <p className="mb-4 font-mono text-xs text-muted">
          Overrides <code className="text-accent">NEXT_PUBLIC_API_URL</code> via
          localStorage (<code className="text-accent">visboard_api_url</code>).
          <button
            type="button"
            onClick={handleResetApiUrl}
            className="ml-2 text-accent hover:underline"
          >
            Reset to default
          </button>
        </p>

        <label className="mb-1 block font-mono text-xs text-muted" htmlFor="pat-input">
          Personal Access Token
        </label>
        <input
          id="pat-input"
          type="password"
          value={token}
          onChange={(e) => setTokenValue(e.target.value)}
          placeholder="vb_pat_..."
          className="mb-4 w-full border border-border bg-bg px-3 py-2 font-mono text-sm text-text outline-none focus:border-accent"
        />

        <p className="mb-4 text-xs text-muted">
          Paste your PAT from{' '}
          <code className="font-mono text-accent">visboard auth bootstrap</code>.
          Stored in localStorage as <code className="font-mono">visboard_token</code>.
        </p>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleSave}
            className="border border-accent bg-accent-dim px-4 py-1.5 font-mono text-xs text-text hover:bg-accent"
          >
            Save
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="border border-border px-4 py-1.5 font-mono text-xs text-muted hover:border-muted hover:text-text"
          >
            Clear Token
          </button>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto border border-border px-4 py-1.5 font-mono text-xs text-muted hover:text-text"
          >
            Close
          </button>
        </div>

        {saved && (
          <p className="mt-3 font-mono text-xs text-success">Settings updated.</p>
        )}
      </div>
    </div>
  );
}
