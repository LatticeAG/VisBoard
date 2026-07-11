'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AppHeader } from '@/components/app-header';
import { api } from '@/lib/api-client';
import type { Project, EventRecord } from '@visboard/sdk';

export default function WorkspaceDashboardPage() {
  const params = useParams();
  const ws = params.ws as string;

  const [projects, setProjects] = useState<Project[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [mock, setMock] = useState(false);

  useEffect(() => {
    async function load() {
      const projectsResult = await api.projects.list(ws);
      if (projectsResult.ok) {
        setProjects(projectsResult.data);
        setMock(projectsResult.mock);

        const firstProject = projectsResult.data[0];
        if (firstProject) {
          const eventsResult = await api.events.list(ws, firstProject.slug, {
            limit: 10,
          });
          if (eventsResult.ok) {
            setEvents(eventsResult.data.data);
          }
        }
      }
      setLoading(false);
    }
    load();
  }, [ws]);

  return (
    <>
      <AppHeader
        breadcrumb={[{ label: ws, href: `/app/${ws}` }]}
      />
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-y-auto p-6">
          {mock && (
            <div className="mb-4 border border-accent-dim bg-surface px-4 py-2 font-mono text-xs text-muted">
              Mock data — API unavailable
            </div>
          )}

          <h2 className="mb-4 font-mono text-xs uppercase tracking-wider text-muted">
            Projects
          </h2>

          {loading ? (
            <p className="font-mono text-sm text-muted">Loading…</p>
          ) : projects.length === 0 ? (
            <p className="font-mono text-sm text-muted">
              No projects. Create one with{' '}
              <code className="text-accent">visboard project create</code>.
            </p>
          ) : (
            <ul className="divide-y divide-border border border-border bg-surface">
              {projects.map((project) => (
                <li key={project.id}>
                  <a
                    href={`/app/${ws}/projects/${project.slug}`}
                    className="block px-4 py-3 hover:bg-bg"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm text-text">{project.name}</span>
                      <span
                        className={`font-mono text-xs ${
                          project.status === 'active'
                            ? 'text-success'
                            : project.status === 'archived'
                              ? 'text-muted'
                              : 'text-accent'
                        }`}
                      >
                        {project.status}
                      </span>
                    </div>
                    {project.description && (
                      <p className="mt-1 font-mono text-xs text-muted line-clamp-2">
                        {project.description}
                      </p>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </main>

        <aside className="w-activity shrink-0 border-l border-border bg-surface">
          <div className="border-b border-border px-3 py-2 font-mono text-xs uppercase tracking-wide text-muted">
            Recent Activity
          </div>
          <div className="overflow-y-auto">
            {events.map((evt) => (
              <div
                key={evt.id}
                className="border-b border-border px-3 py-2 font-mono text-xs"
              >
                <span className="text-accent">{evt.type}</span>
                <span className="ml-2 text-muted">
                  {new Date(evt.created_at).toLocaleTimeString()}
                </span>
              </div>
            ))}
            {events.length === 0 && (
              <p className="px-3 py-4 font-mono text-xs text-muted">No recent events</p>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
