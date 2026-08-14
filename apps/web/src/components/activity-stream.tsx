"use client";

import { api, getEventsStreamUrl } from "@/lib/api-client";
import type { EventRecord } from "@visboard/sdk";
import { useEffect, useRef, useState } from "react";

interface ActivityStreamProps {
  ws: string;
  project: string;
  collapsed: boolean;
  onToggle: () => void;
}

export function ActivityStream({ ws, project, collapsed, onToggle }: ActivityStreamProps) {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [mock, setMock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usingSse, setUsingSse] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let mounted = true;

    const applyEvents = (data: EventRecord[], isMock: boolean) => {
      if (!mounted) return;
      setEvents(data);
      setMock(isMock);
      setError(null);
    };

    const startPolling = () => {
      if (pollRef.current) return;

      const poll = async () => {
        const result = await api.events.list(ws, project, { limit: 50 });
        if (!mounted) return;
        if (result.ok) {
          applyEvents(result.data.data, result.mock);
        } else {
          setError(result.error);
        }
      };

      poll();
      pollRef.current = setInterval(poll, 3000);
    };

    const stopPolling = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };

    const trySse = () => {
      if (typeof EventSource === "undefined") {
        startPolling();
        return;
      }

      const url = getEventsStreamUrl(ws, project);
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => {
        if (!mounted) return;
        setUsingSse(true);
        stopPolling();
      };

      es.onmessage = (event) => {
        if (!mounted) return;
        try {
          const record = JSON.parse(event.data) as EventRecord;
          setEvents((prev) => {
            const exists = prev.some((e) => e.id === record.id);
            if (exists) return prev;
            return [record, ...prev].slice(0, 50);
          });
          setError(null);
        } catch {
          // ignore malformed events
        }
      };

      es.onerror = () => {
        if (!mounted) return;
        es.close();
        eventSourceRef.current = null;
        setUsingSse(false);
        startPolling();
      };
    };

    trySse();

    return () => {
      mounted = false;
      stopPolling();
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [ws, project]);

  if (collapsed) {
    return (
      <aside className="flex w-8 shrink-0 flex-col border-l border-border bg-surface">
        <button
          type="button"
          onClick={onToggle}
          className="flex h-full items-center justify-center font-mono text-xs text-muted hover:text-text"
          title="Expand activity"
        >
          ◀
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex w-activity shrink-0 flex-col border-l border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="font-mono text-xs uppercase tracking-wide text-muted">
          Activity
          {mock && <span className="ml-2 text-accent-dim">(demo)</span>}
          {usingSse && <span className="ml-2 text-success">(live)</span>}
        </span>
        <button
          type="button"
          onClick={onToggle}
          className="font-mono text-xs text-muted hover:text-text"
          title="Collapse"
        >
          ▶
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {error && <p className="px-3 py-2 font-mono text-xs text-red-400">{error}</p>}
        {events.map((evt) => (
          <div key={evt.id} className="border-b border-border px-3 py-2 font-mono text-xs">
            <div className="flex items-center gap-2">
              <span className="text-accent">{evt.type}</span>
              <span className="text-muted">{formatTime(evt.created_at)}</span>
            </div>
            <div className="mt-0.5 text-muted">
              {evt.actor_type}:{evt.actor_id.slice(0, 12)}
            </div>
            {Object.keys(evt.payload).length > 0 && (
              <pre className="mt-1 overflow-x-auto text-[10px] text-muted">
                {JSON.stringify(evt.payload, null, 0)}
              </pre>
            )}
          </div>
        ))}
        {events.length === 0 && !error && (
          <p className="px-3 py-4 font-mono text-xs text-muted">No events yet</p>
        )}
      </div>
    </aside>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
