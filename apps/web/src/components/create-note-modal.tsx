'use client';

import { useState } from 'react';
import type { CreateNoteInput } from '@visboard/sdk';

interface CreateNoteModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (input: CreateNoteInput) => Promise<{ ok: boolean; error?: string }>;
}

export function CreateNoteModal({ open, onClose, onCreate }: CreateNoteModalProps) {
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    setSubmitting(true);
    setError(null);

    const input: CreateNoteInput = {
      title: title.trim(),
      body: body || undefined,
    };
    if (slug.trim()) {
      input.slug = slug.trim();
    }

    const result = await onCreate(input);
    setSubmitting(false);

    if (result.ok) {
      setTitle('');
      setSlug('');
      setBody('');
      onClose();
    } else {
      setError(result.error ?? 'Failed to create note');
    }
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
        aria-labelledby="create-note-title"
      >
        <h2
          id="create-note-title"
          className="mb-4 font-mono text-sm font-semibold uppercase tracking-wider text-muted"
        >
          New Note
        </h2>

        <form onSubmit={handleSubmit}>
          <label className="mb-1 block font-mono text-xs text-muted" htmlFor="note-title">
            Title
          </label>
          <input
            id="note-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mb-3 w-full border border-border bg-bg px-3 py-2 font-mono text-sm text-text outline-none focus:border-accent"
            placeholder="Note title"
            autoFocus
          />

          <label className="mb-1 block font-mono text-xs text-muted" htmlFor="note-slug">
            Slug (optional)
          </label>
          <input
            id="note-slug"
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="mb-3 w-full border border-border bg-bg px-3 py-2 font-mono text-sm text-text outline-none focus:border-accent"
            placeholder="auto-generated if empty"
          />

          <label className="mb-1 block font-mono text-xs text-muted" htmlFor="note-body">
            Body (optional)
          </label>
          <textarea
            id="note-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            className="mb-4 w-full resize-none border border-border bg-bg px-3 py-2 font-mono text-sm text-text outline-none focus:border-accent"
            placeholder="Markdown content…"
          />

          {error && (
            <p className="mb-3 font-mono text-xs text-red-400">{error}</p>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="border border-accent bg-accent-dim px-4 py-1.5 font-mono text-xs text-text hover:bg-accent disabled:opacity-50"
            >
              {submitting ? 'Creating…' : 'Create'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="ml-auto border border-border px-4 py-1.5 font-mono text-xs text-muted hover:text-text"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
