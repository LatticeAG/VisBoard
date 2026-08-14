"use client";

import type { CreateChecklistInput } from "@visboard/sdk";
import { useEffect, useRef, useState } from "react";

interface CreateChecklistModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (input: CreateChecklistInput) => Promise<{ ok: boolean; error?: string }>;
}

export function CreateChecklistModal({ open, onClose, onCreate }: CreateChecklistModalProps) {
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      titleInputRef.current?.focus();
    }
  }, [open]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title is required");
      return;
    }

    setSubmitting(true);
    setError(null);

    const result = await onCreate({ title: title.trim() });
    setSubmitting(false);

    if (result.ok) {
      setTitle("");
      onClose();
    } else {
      setError(result.error ?? "Failed to create checklist");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      role="presentation"
    >
      <dialog
        open
        className="w-full max-w-md border border-border bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        aria-labelledby="create-checklist-title"
      >
        <h2
          id="create-checklist-title"
          className="mb-4 font-mono text-sm font-semibold uppercase tracking-wider text-muted"
        >
          New Checklist
        </h2>

        <form onSubmit={handleSubmit}>
          <label className="mb-1 block font-mono text-xs text-muted" htmlFor="checklist-title">
            Title
          </label>
          <input
            ref={titleInputRef}
            id="checklist-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mb-4 w-full border border-border bg-bg px-3 py-2 font-mono text-sm text-text outline-none focus:border-accent"
            placeholder="Checklist title"
          />

          {error && <p className="mb-3 font-mono text-xs text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="border border-accent bg-accent-dim px-4 py-1.5 font-mono text-xs text-text hover:bg-accent disabled:opacity-50"
            >
              {submitting ? "Creating…" : "Create"}
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
      </dialog>
    </div>
  );
}
