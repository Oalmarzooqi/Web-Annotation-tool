"use client";

import { useMemo } from "react";
import { Card, CardBody, CardHeader, IconButton, IconLink, VerticalRule } from "../../components/ui";
import { deleteProject } from "../../lib/projects";
import { useProjects } from "../../lib/useProjects";
import { Eye, Pencil, Plus, ScanLine, Trash2 } from "lucide-react";

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function ProjectsPage() {
  const { projects, loading, error, refresh } = useProjects();
  const empty = useMemo(() => !loading && projects.length === 0, [loading, projects.length]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-[color:var(--color-muted)]">
            Create a project to organize volumes, labels, and exported annotations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <IconLink to="/projects/new" label="New project" tone="accent">
            <Plus className="h-5 w-5" aria-hidden="true" />
          </IconLink>
        </div>
      </header>

      <Card>
        <CardHeader title="Your projects" subtitle="Stored in SQLite (no login)." />
        <CardBody>
          {error ? (
            <div className="flex flex-col gap-3 py-4">
              <p className="text-sm text-red-700">{error}</p>
              <button
                className="text-left text-sm text-[color:var(--color-accent-strong)] underline"
                onClick={() => void refresh()}
              >
                Retry
              </button>
            </div>
          ) : null}

          {loading ? (
            <p className="py-6 text-sm text-[color:var(--color-muted)]">Loading…</p>
          ) : empty ? (
            <div className="flex flex-col items-start gap-3 py-6">
              <p className="text-sm text-[color:var(--color-muted)]">No projects yet.</p>
              <IconLink to="/projects/new" label="Create your first project" tone="accent">
                <Plus className="h-5 w-5" aria-hidden="true" />
              </IconLink>
            </div>
          ) : (
            <ul className="divide-y divide-[color:var(--color-border)]">
              {projects.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-semibold">{p.name}</h3>
                      <span className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface-2)] px-2 py-0.5 font-mono text-[11px] text-[color:var(--color-muted)]">
                        sqlite
                      </span>
                    </div>
                    {p.description ? (
                      <p className="mt-1 line-clamp-2 text-sm text-[color:var(--color-muted)]">
                        {p.description}
                      </p>
                    ) : null}
                    <p className="mt-2 text-xs text-[color:var(--color-muted)]">
                      Updated {formatDate(p.updatedAt)}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center">
                    <IconLink to={`/projects/${p.id}`} label="View project">
                      <Eye className="h-5 w-5" aria-hidden="true" />
                    </IconLink>
                    <VerticalRule />
                    <IconLink
                      to={`/projects/${p.id}/annotate`}
                      label="Open in annotation"
                      tone="accent"
                    >
                      <ScanLine className="h-5 w-5" aria-hidden="true" />
                    </IconLink>
                    <VerticalRule />
                    <IconLink to={`/projects/${p.id}/edit`} label="Edit project">
                      <Pencil className="h-5 w-5" aria-hidden="true" />
                    </IconLink>
                    <VerticalRule />
                    <IconButton
                      tone="danger"
                      label="Delete project"
                      onClick={() => {
                        const ok = window.confirm(`Delete project “${p.name}”?`);
                        if (!ok) return;
                        void (async () => {
                          await deleteProject(p.id);
                          await refresh();
                        })();
                      }}
                    >
                      <Trash2 className="h-5 w-5" aria-hidden="true" />
                    </IconButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </main>
  );
}

