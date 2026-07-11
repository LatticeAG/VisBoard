'use client';

import type { ChecklistWithItems } from '@visboard/sdk';

interface ChecklistViewProps {
  checklist: ChecklistWithItems | null;
  onToggleItem: (checklistId: string, itemId: string, done: boolean) => void;
}

export function ChecklistView({ checklist, onToggleItem }: ChecklistViewProps) {
  if (!checklist) {
    return (
      <div className="flex flex-1 items-center justify-center font-mono text-sm text-muted">
        Select a checklist
      </div>
    );
  }

  const items = [...(checklist.items ?? [])].sort((a, b) => a.sort_order - b.sort_order);

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
                  item.done ? 'text-muted line-through' : 'text-text'
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
        {items.length === 0 && (
          <li className="px-4 py-6 font-mono text-xs text-muted">No items</li>
        )}
      </ul>
    </div>
  );
}
