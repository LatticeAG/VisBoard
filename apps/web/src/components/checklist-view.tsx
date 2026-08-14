"use client";

import type { ChecklistWithItems } from "@visboard/sdk";
import { useState } from "react";

interface ChecklistViewProps {
  checklist: ChecklistWithItems | null;
  onToggleItem: (checklistId: string, itemId: string, done: boolean) => void;
  onAddItem?: (checklistId: string, text: string) => Promise<{ ok: boolean; error?: string }>;
}

export function ChecklistView({ checklist, onToggleItem, onAddItem }: ChecklistViewProps) {
  const [newItemText, setNewItemText] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  if (!checklist) {
    return (
      <div className="flex flex-1 items-center justify-center font-mono text-sm text-muted">
        Select a checklist
      </div>
    );
  }

  const items = [...(checklist.items ?? [])].sort((a, b) => a.sort_order - b.sort_order);

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onAddItem || !newItemText.trim()) return;

    setAdding(true);
    setAddError(null);
    const result = await onAddItem(checklist.id, newItemText.trim());
    setAdding(false);

    if (result.ok) {
      setNewItemText("");
    } else {
      setAddError(result.error ?? "Failed to add item");
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <h2 className="font-mono text-sm text-text">{checklist.title}</h2>
        <p className="font-mono text-xs text-muted">{checklist.id}</p>
      </div>

      <ul className="flex-1 overflow-y-auto">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-start gap-3 border-b border-border px-4 py-2 hover:bg-bg"
          >
            <input
              type="checkbox"
              checked={item.done}
              onChange={(e) => onToggleItem(checklist.id, item.id, e.target.checked)}
              className="mt-0.5 accent-accent"
            />
            <div className="flex-1">
              <span
                className={`font-mono text-sm ${
                  item.done ? "text-muted line-through" : "text-text"
                }`}
              >
                {item.text}
              </span>
              {item.assignee_id && (
                <span className="ml-2 font-mono text-xs text-accent-dim">
                  @{item.assignee_type}:{item.assignee_id.slice(0, 8)}
                </span>
              )}
            </div>
          </li>
        ))}
        {items.length === 0 && <li className="px-4 py-6 font-mono text-xs text-muted">No items</li>}
      </ul>

      {onAddItem && (
        <form onSubmit={handleAddItem} className="border-t border-border px-4 py-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={newItemText}
              onChange={(e) => setNewItemText(e.target.value)}
              placeholder="Add item…"
              className="flex-1 border border-border bg-bg px-3 py-1.5 font-mono text-sm text-text outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={adding || !newItemText.trim()}
              className="border border-accent bg-accent-dim px-3 py-1.5 font-mono text-xs text-text hover:bg-accent disabled:opacity-50"
            >
              {adding ? "…" : "Add"}
            </button>
          </div>
          {addError && <p className="mt-2 font-mono text-xs text-red-400">{addError}</p>}
        </form>
      )}
    </div>
  );
}
