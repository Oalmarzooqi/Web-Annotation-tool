"use client";

import { useParams } from "react-router-dom";
import { Card, CardBody, CardHeader, IconLink, VerticalRule } from "../../components/ui";
import { useProject } from "../../lib/useProjects";
import { ArrowLeft, Pencil, RefreshCcw, ScanLine } from "lucide-react";

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function ProjectViewPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { project, loading, error, refresh } = useProject(id);

  if (loading) {
    return (
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6">
        <p className="text-sm text-[color:var(--color-muted)]">Loading…</p>
      </main>
    );
  }

  if (!project) {
    return (
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6">
        <Card>
          <CardHeader title="Project not found" />
          <CardBody>
            <p className="text-sm text-[color:var(--color-muted)]">
              {error ?? "This project does not exist."}
            </p>
            <div className="mt-4 flex items-center gap-2">
              <IconLink to="/projects" label="Back to projects">
                <ArrowLeft className="h-5 w-5" aria-hidden="true" />
              </IconLink>
            </div>
          </CardBody>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">{project.name}</h1>
          {project.description ? (
            <p className="mt-1 text-sm text-[color:var(--color-muted)]">{project.description}</p>
          ) : null}
        </div>
        <div className="flex items-center">
          <IconLink to={`/projects/${project.id}/annotate`} label="Annotate in this project" tone="accent">
            <ScanLine className="h-5 w-5" aria-hidden="true" />
          </IconLink>
          <VerticalRule />
          <IconLink to={`/projects/${project.id}/edit`} label="Edit project" tone="accent">
            <Pencil className="h-5 w-5" aria-hidden="true" />
          </IconLink>
          <VerticalRule />
          <IconLink to="/projects" label="Back">
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </IconLink>
          <VerticalRule />
          <IconLink
            to="#"
            label="Refresh"
            onClick={(e) => {
              e.preventDefault();
              void refresh();
            }}
          >
            <RefreshCcw className="h-5 w-5" aria-hidden="true" />
          </IconLink>
        </div>
      </header>

      <Card>
        <CardHeader title="Metadata" />
        <CardBody>
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[color:var(--color-muted)]">Project ID</dt>
              <dd className="mt-1 font-mono text-xs">{project.id}</dd>
            </div>
            <div>
              <dt className="text-[color:var(--color-muted)]">Storage</dt>
              <dd className="mt-1">SQLite (server) via Prisma</dd>
            </div>
            <div>
              <dt className="text-[color:var(--color-muted)]">Created</dt>
              <dd className="mt-1">{formatDate(project.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-[color:var(--color-muted)]">Updated</dt>
              <dd className="mt-1">{formatDate(project.updatedAt)}</dd>
            </div>
          </dl>
        </CardBody>
      </Card>
    </main>
  );
}

