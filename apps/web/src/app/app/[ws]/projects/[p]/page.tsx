"use client";

import { ActivityStream } from "@/components/activity-stream";
import { AgentRegistry } from "@/components/agent-registry";
import { AppHeader } from "@/components/app-header";
import { ChecklistView } from "@/components/checklist-view";
import { CreateChecklistModal } from "@/components/create-checklist-modal";
import { CreateNoteModal } from "@/components/create-note-modal";
import { FileList } from "@/components/file-list";
import { NoteEditor } from "@/components/note-editor";
import { Sidebar, type SidebarTab } from "@/components/sidebar";
import { InlineAlert, ToastContainer, useToast } from "@/components/toast";
import { api } from "@/lib/api-client";
import type {
  Agent,
  ChecklistWithItems,
  CreateChecklistInput,
  CreateNoteInput,
  FileRecord,
  Note,
} from "@visboard/sdk";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type CenterView = "note" | "checklist" | "files";

export default function ProjectPage() {
  const params = useParams();
  const ws = params.ws as string;
  const project = params.p as string;

  const { toasts, show, dismiss } = useToast();

  const [activeTab, setActiveTab] = useState<SidebarTab>("notes");
  const [centerView, setCenterView] = useState<CenterView>("note");
  const [activityCollapsed, setActivityCollapsed] = useState(false);
  const [mock, setMock] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [notes, setNotes] = useState<Note[]>([]);
  const [checklists, setChecklists] = useState<ChecklistWithItems[]>([]);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentsError, setAgentsError] = useState<string | null>(null);

  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [selectedChecklistId, setSelectedChecklistId] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [selectedChecklist, setSelectedChecklist] = useState<ChecklistWithItems | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [syncingAgentsMd, setSyncingAgentsMd] = useState(false);

  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [checklistModalOpen, setChecklistModalOpen] = useState(false);

  const loadData = useCallback(async () => {
    const [notesResult, checklistsResult, filesResult] = await Promise.all([
      api.notes.list(ws, project),
      api.checklists.list(ws, project),
      api.files.list(ws, project),
    ]);

    if (!notesResult.ok && !checklistsResult.ok && !filesResult.ok) {
      setLoadError(notesResult.error);
    } else {
      setLoadError(null);
    }

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

  const loadAgents = useCallback(async () => {
    setAgentsLoading(true);
    const result = await api.agents.list(ws);
    if (result.ok) {
      setAgents(result.data);
      setAgentsError(null);
    } else {
      setAgentsError(result.error);
    }
    setAgentsLoading(false);
  }, [ws]);

  useEffect(() => {
    loadData();
    loadAgents();
  }, [loadData, loadAgents]);

  const handleSelectNote = (id: string) => {
    const note = notes.find((n) => n.id === id) ?? null;
    setSelectedNoteId(id);
    setSelectedNote(note);
    setCenterView("note");
    setActiveTab("notes");
    setSaveMessage(null);
  };

  const handleSelectChecklist = (id: string) => {
    const chk = checklists.find((c) => c.id === id) ?? null;
    setSelectedChecklistId(id);
    setSelectedChecklist(chk);
    setCenterView("checklist");
    setActiveTab("checklists");
  };

  const handleTabChange = (tab: SidebarTab) => {
    setActiveTab(tab);
    if (tab === "notes") {
      setCenterView("note");
    } else if (tab === "checklists") {
      setCenterView("checklist");
      if (!selectedChecklistId && checklists.length > 0) {
        const first = checklists[0];
        if (!first) return;
        setSelectedChecklistId(first.id);
        setSelectedChecklist(first);
      }
    } else if (tab === "files") {
      setCenterView("files");
    }
  };

  const handleSaveNote = async (updates: {
    title: string;
    body: string;
    frontmatter: Record<string, unknown>;
  }) => {
    if (!selectedNote) return;
    setSaving(true);
    setSaveMessage(null);

    const result = await api.notes.update(
      ws,
      project,
      selectedNote.id,
      updates,
      selectedNote.version,
    );

    if (result.ok) {
      setSelectedNote(result.data);
      setNotes((prev) => prev.map((n) => (n.id === result.data.id ? result.data : n)));
      setSaveMessage({ type: "success", text: "Note saved" });
      show("Note saved", "success");
    } else {
      setSaveMessage({ type: "error", text: result.error });
      show(result.error, "error");
    }
    setSaving(false);
  };

  const handleCreateNote = async (input: CreateNoteInput) => {
    const result = await api.notes.create(ws, project, input);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    setNotes((prev) => [...prev, result.data]);
    handleSelectNote(result.data.id);
    show("Note created", "success");
    return { ok: true };
  };

  const handleCreateChecklist = async (input: CreateChecklistInput) => {
    const result = await api.checklists.create(ws, project, input);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    setChecklists((prev) => [...prev, result.data]);
    handleSelectChecklist(result.data.id);
    show("Checklist created", "success");
    return { ok: true };
  };

  const handleUploadFile = async (file: File) => {
    setUploading(true);
    const result = await api.files.upload(ws, project, file);
    setUploading(false);

    if (!result.ok) {
      show(result.error, "error");
      return;
    }

    setFiles((prev) => [...prev, result.data]);
    setActiveTab("files");
    setCenterView("files");
    show(`Uploaded ${file.name}`, "success");
  };

  const handleAddItem = async (checklistId: string, text: string) => {
    const chk = checklists.find((c) => c.id === checklistId);
    const sortOrder = chk?.items?.length ?? 0;

    const result = await api.checklists.addItem(ws, project, checklistId, {
      text,
      sort_order: sortOrder,
    });

    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    const updateChecklist = (c: ChecklistWithItems): ChecklistWithItems => ({
      ...c,
      items: [...(c.items ?? []), result.data],
    });

    setChecklists((prev) => prev.map((c) => (c.id === checklistId ? updateChecklist(c) : c)));
    if (selectedChecklist?.id === checklistId) {
      setSelectedChecklist((prev) => (prev ? updateChecklist(prev) : null));
    }
    show("Item added", "success");
    return { ok: true };
  };

  const handleToggleItem = async (checklistId: string, itemId: string, done: boolean) => {
    const result = await api.checklists.updateItem(ws, project, checklistId, itemId, {
      done,
    });
    if (result.ok) {
      setChecklists((prev) =>
        prev.map((chk) =>
          chk.id === checklistId
            ? {
                ...chk,
                items: chk.items?.map((item) => (item.id === itemId ? { ...item, done } : item)),
              }
            : chk,
        ),
      );
      if (selectedChecklist?.id === checklistId) {
        setSelectedChecklist((prev) =>
          prev
            ? {
                ...prev,
                items: prev.items?.map((item) => (item.id === itemId ? { ...item, done } : item)),
              }
            : null,
        );
      }
    } else {
      show(result.error, "error");
    }
  };

  const handleSyncAgentsMd = async () => {
    setSyncingAgentsMd(true);
    const result = await api.agentsMd.sync(ws, project);
    setSyncingAgentsMd(false);

    if (result.ok) {
      show("AGENTS.md synced", "success");
      await loadData();
    } else {
      show(result.error, "error");
    }
  };

  return (
    <>
      <AppHeader breadcrumb={[{ label: ws, href: `/app/${ws}` }, { label: project }]} />

      {mock && (
        <InlineAlert
          message="Demo mode: add ?demo=1 to explore with mock data"
          variant="info"
          className="border-x-0 border-t-0"
        />
      )}

      {loadError && (
        <InlineAlert message={loadError} variant="error" className="border-x-0 border-t-0" />
      )}

      <AgentRegistry agents={agents} loading={agentsLoading} error={agentsError} />

      <div className="flex items-center gap-2 border-b border-border bg-surface px-4 py-2">
        <button
          type="button"
          onClick={handleSyncAgentsMd}
          disabled={syncingAgentsMd}
          className="border border-border px-3 py-1 font-mono text-xs text-muted hover:border-accent hover:text-text disabled:opacity-50"
        >
          {syncingAgentsMd ? "Syncing…" : "Sync AGENTS.md"}
        </button>
        <a href={`/app/${ws}`} className="ml-auto font-mono text-xs text-accent hover:underline">
          View all agents in workspace →
        </a>
      </div>

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
          onNewNote={() => setNoteModalOpen(true)}
          onNewChecklist={() => setChecklistModalOpen(true)}
          onUploadFile={handleUploadFile}
          uploading={uploading}
        />

        <div className="flex flex-1 flex-col overflow-hidden">
          {centerView === "note" && (
            <NoteEditor
              note={selectedNote}
              onSave={handleSaveNote}
              saving={saving}
              saveMessage={saveMessage}
            />
          )}
          {centerView === "checklist" && (
            <ChecklistView
              checklist={selectedChecklist}
              onToggleItem={handleToggleItem}
              onAddItem={handleAddItem}
            />
          )}
          {centerView === "files" && <FileList files={files} ws={ws} project={project} />}
        </div>

        <ActivityStream
          ws={ws}
          project={project}
          collapsed={activityCollapsed}
          onToggle={() => setActivityCollapsed((c) => !c)}
        />
      </div>

      <CreateNoteModal
        open={noteModalOpen}
        onClose={() => setNoteModalOpen(false)}
        onCreate={handleCreateNote}
      />
      <CreateChecklistModal
        open={checklistModalOpen}
        onClose={() => setChecklistModalOpen(false)}
        onCreate={handleCreateChecklist}
      />
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </>
  );
}
