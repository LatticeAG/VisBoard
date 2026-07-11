'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AppHeader } from '@/components/app-header';
import { Sidebar, type SidebarTab } from '@/components/sidebar';
import { NoteEditor } from '@/components/note-editor';
import { ChecklistView } from '@/components/checklist-view';
import { FileList } from '@/components/file-list';
import { ActivityStream } from '@/components/activity-stream';
import { api } from '@/lib/api-client';
import type { Note, ChecklistWithItems, FileRecord } from '@visboard/sdk';

type CenterView = 'note' | 'checklist' | 'files';

export default function ProjectPage() {
  const params = useParams();
  const ws = params.ws as string;
  const project = params.p as string;

  const [activeTab, setActiveTab] = useState<SidebarTab>('notes');
  const [centerView, setCenterView] = useState<CenterView>('note');
  const [activityCollapsed, setActivityCollapsed] = useState(false);
  const [mock, setMock] = useState(false);

  const [notes, setNotes] = useState<Note[]>([]);
  const [checklists, setChecklists] = useState<ChecklistWithItems[]>([]);
  const [files, setFiles] = useState<FileRecord[]>([]);

  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [selectedChecklistId, setSelectedChecklistId] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [selectedChecklist, setSelectedChecklist] = useState<ChecklistWithItems | null>(null);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    const [notesResult, checklistsResult, filesResult] = await Promise.all([
      api.notes.list(ws, project),
      api.checklists.list(ws, project),
      api.files.list(ws, project),
    ]);

    if (notesResult.ok) {
      setNotes(notesResult.data);
      setMock(notesResult.mock);
      if (!selectedNoteId && notesResult.data.length > 0) {
        const firstNote = notesResult.data[0];
        if (firstNote) {
          setSelectedNoteId(firstNote.id);
          setSelectedNote(firstNote);
        }
      }
    }
    if (checklistsResult.ok) {
      setChecklists(checklistsResult.data);
    }
    if (filesResult.ok) {
      setFiles(filesResult.data);
    }
  }, [ws, project, selectedNoteId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSelectNote = (id: string) => {
    const note = notes.find((n) => n.id === id) ?? null;
    setSelectedNoteId(id);
    setSelectedNote(note);
    setCenterView('note');
    setActiveTab('notes');
  };

  const handleSelectChecklist = (id: string) => {
    const chk = checklists.find((c) => c.id === id) ?? null;
    setSelectedChecklistId(id);
    setSelectedChecklist(chk);
    setCenterView('checklist');
    setActiveTab('checklists');
  };

  const handleTabChange = (tab: SidebarTab) => {
    setActiveTab(tab);
    if (tab === 'notes') setCenterView('note');
    else if (tab === 'checklists') setCenterView('checklist');
    else if (tab === 'files') setCenterView('files');
  };

  const handleSaveNote = async (updates: {
    title: string;
    body: string;
    frontmatter: Record<string, unknown>;
  }) => {
    if (!selectedNote) return;
    setSaving(true);
    const result = await api.notes.update(
      ws,
      project,
      selectedNote.id,
      updates,
      selectedNote.version,
    );
    if (result.ok) {
      setSelectedNote(result.data);
      setNotes((prev) =>
        prev.map((n) => (n.id === result.data.id ? result.data : n)),
      );
    }
    setSaving(false);
  };

  const handleToggleItem = async (
    checklistId: string,
    itemId: string,
    done: boolean,
  ) => {
    const result = await api.checklists.updateItem(ws, project, checklistId, itemId, {
      done,
    });
    if (result.ok) {
      setChecklists((prev) =>
        prev.map((chk) =>
          chk.id === checklistId
            ? {
                ...chk,
                items: chk.items?.map((item) =>
                  item.id === itemId ? { ...item, done } : item,
                ),
              }
            : chk,
        ),
      );
      if (selectedChecklist?.id === checklistId) {
        setSelectedChecklist((prev) =>
          prev
            ? {
                ...prev,
                items: prev.items?.map((item) =>
                  item.id === itemId ? { ...item, done } : item,
                ),
              }
            : null,
        );
      }
    }
  };

  return (
    <>
      <AppHeader
        breadcrumb={[
          { label: ws, href: `/app/${ws}` },
          { label: project },
        ]}
      />

      {mock && (
        <div className="border-b border-accent-dim bg-surface px-4 py-1 font-mono text-xs text-muted">
          Mock data — connect API and set PAT in Settings for live data
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          activeTab={activeTab}
          onTabChange={handleTabChange}
          notes={notes}
          checklists={checklists}
          files={files}
          selectedNoteId={selectedNoteId}
          selectedChecklistId={selectedChecklistId}
          onSelectNote={handleSelectNote}
          onSelectChecklist={handleSelectChecklist}
        />

        <div className="flex flex-1 flex-col overflow-hidden">
          {centerView === 'note' && (
            <NoteEditor note={selectedNote} onSave={handleSaveNote} saving={saving} />
          )}
          {centerView === 'checklist' && (
            <ChecklistView
              checklist={selectedChecklist}
              onToggleItem={handleToggleItem}
            />
          )}
          {centerView === 'files' && (
            <FileList files={files} ws={ws} project={project} />
          )}
        </div>

        <ActivityStream
          ws={ws}
          project={project}
          collapsed={activityCollapsed}
          onToggle={() => setActivityCollapsed((c) => !c)}
        />
      </div>
    </>
  );
}
