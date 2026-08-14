"use client";

import type { Note } from "@visboard/sdk";
import { useEffect, useState } from "react";
import { MarkdownPreview } from "./markdown-preview";

interface NoteEditorProps {
  note: Note | null;
  onSave: (updates: {
    title: string;
    body: string;
    frontmatter: Record<string, unknown>;
  }) => void;
  saving?: boolean;
  saveMessage?: { type: "success" | "error"; text: string } | null;
}

export function NoteEditor({ note, onSave, saving, saveMessage }: NoteEditorProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [frontmatterText, setFrontmatterText] = useState("{}");
  const [frontmatterError, setFrontmatterError] = useState<string | null>(null);

  useEffect(() => {
    if (note) {
      setTitle(note.title);
      setBody(note.body);
      setFrontmatterText(JSON.stringify(note.frontmatter ?? {}, null, 2));
      setFrontmatterError(null);
    }
  }, [note]);

  if (!note) {
    return (
      <div className="flex flex-1 items-center justify-center font-mono text-sm text-muted">
        Select a note to edit
      </div>
    );
  }

  const handleSave = () => {
    let frontmatter: Record<string, unknown>;
    try {
      frontmatter = JSON.parse(frontmatterText);
      setFrontmatterError(null);
    } catch {
      setFrontmatterError("Invalid JSON in frontmatter");
      return;
    }
    onSave({ title, body, frontmatter });
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="flex-1 bg-transparent font-mono text-sm text-text outline-none"
          placeholder="Note title"
        />
        <span className="font-mono text-xs text-muted">v{note.version}</span>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="border border-accent bg-accent-dim px-3 py-1 font-mono text-xs text-text hover:bg-accent disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saveMessage && (
          <span
            className={`font-mono text-xs ${
              saveMessage.type === "success" ? "text-success" : "text-red-400"
            }`}
          >
            {saveMessage.text}
          </span>
        )}
      </div>

      <div className="border-b border-border px-4 py-2">
        <label className="mb-1 block font-mono text-xs text-muted" htmlFor="frontmatter">
          Frontmatter (JSON)
        </label>
        <textarea
          id="frontmatter"
          value={frontmatterText}
          onChange={(e) => setFrontmatterText(e.target.value)}
          rows={3}
          className="w-full resize-none border border-border bg-bg px-2 py-1 font-mono text-xs text-text outline-none focus:border-accent"
        />
        {frontmatterError && (
          <p className="mt-1 font-mono text-xs text-red-400">{frontmatterError}</p>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="w-1/2 resize-none border-r border-border bg-bg p-4 font-mono text-sm text-text outline-none"
          placeholder="Write markdown…"
          spellCheck={false}
        />
        <div className="w-1/2 overflow-hidden">
          <MarkdownPreview content={body} className="h-full" />
        </div>
      </div>
    </div>
  );
}
