"use client";

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Card, CardBody, CardHeader, IconButton, IconLink, Input, Textarea } from "../../components/ui";
import { updateProject } from "../../lib/projects";
import { useProject } from "../../lib/useProjects";
import { ArrowLeft, Save, X } from "lucide-react";

export function EditProjectPage() {
  const { id = "" } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { project, loading, error } = useProject(id);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!project) return;
    setName(project.name);
    setDescription(project.description ?? "");
  }, [project]);

  if (loading) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6">
        <p className="text-sm text-[color:var(--color-muted)]">Loading…</p>
      </main>
    );
  }

  if (!project) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6">
        <Card>
          <CardHeader title="Project not found" />
          <CardBody>
            <p className="text-sm text-[color:var(--color-muted)]">
              {error ?? "This project does not exist."}
            </p>
            <div className="mt-4">
              <IconLink to="/projects" label="Back">
                <ArrowLeft className="h-5 w-5" aria-hidden="true" />
              </IconLink>
            </div>
          </CardBody>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Edit project</h1>
        <IconLink to={`/projects/${project.id}`} label="Back">
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </IconLink>
      </header>

      <Card>
        <CardHeader title="Project details" />
        <CardBody>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void (async () => {
                try {
                  setSaving(true);
                  setSaveError(null);
                  await updateProject(project.id, { name: name.trim(), description });
                  nav(`/projects/${project.id}`);
                } catch (err) {
                  setSaveError(err instanceof Error ? err.message : "Failed to save project");
                } finally {
                  setSaving(false);
                }
              })();
            }}
          >
            <div>
              <label className="text-sm font-medium">Name</label>
              <div className="mt-2">
                <Input value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">Description</label>
              <div className="mt-2">
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
            </div>

            {saveError ? <p className="text-sm text-red-700">{saveError}</p> : null}

            <div className="flex items-center gap-2">
              <IconButton
                tone="accent"
                label="Save changes"
                disabled={saving || name.trim().length === 0}
                type="submit"
                className="h-10 w-10"
              >
                <Save className="h-5 w-5" aria-hidden="true" />
              </IconButton>
              <IconLink to={`/projects/${project.id}`} label="Cancel">
                <X className="h-5 w-5" aria-hidden="true" />
              </IconLink>
              {saving ? (
                <span className="text-sm text-[color:var(--color-muted)]">Saving…</span>
              ) : null}
            </div>
          </form>
        </CardBody>
      </Card>
    </main>
  );
}

