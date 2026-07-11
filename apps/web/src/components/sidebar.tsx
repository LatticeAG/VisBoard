'use client';

import { useRef } from 'react';
import type { Note, ChecklistWithItems, FileRecord } from '@visboard/sdk';

export type SidebarTab = 'notes' | 'checklists' | 'files';

interface SidebarProps {
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  notes: Note[];
  checklists: ChecklistWithItems[];
  files: FileRecord[];
  selectedNoteId: string | null;
  selectedChecklistId: string | null;
  onSelectNote: (id: string) => void;
  onSelectChecklist: (id: string) => void;
  onNewNote?: () => void;
  onNewChecklist?: () => void;
  onUploadFile?: (file: File) => void;
  uploading?: boolean;
}

export function Sidebar({
  activeTab,
  onTabChange,
  notes,
  checklists,
  files,
  selectedNoteId,
  selectedChecklistId,
  onSelectNote,
  onSelectChecklist,
  onNewNote,
  onNewChecklist,
  onUploadFile,
  uploading,
}: SidebarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const tabs: { id: SidebarTab; label: string }[] = [
    { id: 'notes', label: 'Notes' },
    { id: 'checklists', label: 'Checklists' },
    { id: 'files', label: 'Files' },
  ];

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onUploadFile) {
      onUploadFile(file);
    }
    e.target.value = '';
  };

  return (
    <aside className="flex w-sidebar shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={`flex-1 px-2 py-2 font-mono text-xs uppercase tracking-wide ${
              activeTab === tab.id
                ? 'border-b-2 border-accent text-text'
                : 'text-muted hover:text-text'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="border-b border-border px-2 py-2">
        {activeTab === 'notes' && onNewNote && (
          <button
            type="button"
            onClick={onNewNote}
            className="w-full border border-border px-2 py-1 font-mono text-xs text-muted hover:border-accent hover:text-text"
          >
            + New note
          </button>
        )}
        {activeTab === 'checklists' && onNewChecklist && (
          <button
            type="button"
            onClick={onNewChecklist}
            className="w-full border border-border px-2 py-1 font-mono text-xs text-muted hover:border-accent hover:text-text"
          >
            + New checklist
          </button>
        )}
        {activeTab === 'files' && onUploadFile && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileChange}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full border border-border px-2 py-1 font-mono text-xs text-muted hover:border-accent hover:text-text disabled:opacity-50"
            >
              {uploading ? 'Uploading…' : '+ Upload file'}
            </button>
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'notes' && (
          <ul>
            {notes.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  onClick={() => onSelectNote(note.id)}
                  className={`w-full border-b border-border px-3 py-2 text-left font-mono text-xs hover:bg-bg ${
                    selectedNoteId === note.id ? 'bg-bg text-accent' : 'text-text'
                  }`}
                >
                  <span className="block truncate">{note.title}</span>
                  <span className="text-muted">{note.slug}</span>
                  {note.is_system && (
                    <span className="ml-1 text-accent-dim">[sys]</span>
                  )}
                </button>
              </li>
            ))}
            {notes.length === 0 && (
              <p className="px-3 py-4 font-mono text-xs text-muted">No notes</p>
            )}
          </ul>
        )}

        {activeTab === 'checklists' && (
          <ul>
            {checklists.map((chk) => (
              <li key={chk.id}>
                <button
                  type="button"
                  onClick={() => onSelectChecklist(chk.id)}
                  className={`w-full border-b border-border px-3 py-2 text-left font-mono text-xs hover:bg-bg ${
                    selectedChecklistId === chk.id ? 'bg-bg text-accent' : 'text-text'
                  }`}
                >
                  <span className="block truncate">{chk.title}</span>
                  <span className="text-muted">
                    {chk.items?.filter((i) => i.done).length ?? 0}/
                    {chk.items?.length ?? 0} done
                  </span>
                </button>
              </li>
            ))}
            {checklists.length === 0 && (
              <p className="px-3 py-4 font-mono text-xs text-muted">No checklists</p>
            )}
          </ul>
        )}

        {activeTab === 'files' && (
          <ul>
            {files.map((file) => (
              <li
                key={file.id}
                className="border-b border-border px-3 py-2 font-mono text-xs text-text"
              >
                <span className="block truncate">{file.name}</span>
                <span className="text-muted">
                  {formatBytes(file.size_bytes)} · {file.mime_type}
                </span>
              </li>
            ))}
            {files.length === 0 && (
              <p className="px-3 py-4 font-mono text-xs text-muted">No files</p>
            )}
          </ul>
        )}
      </div>
    </aside>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
