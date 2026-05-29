"use client";

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardBody, CardHeader, IconButton, IconLink, Input, Textarea } from "../../components/ui";
import { createProject } from "../../lib/projects";
import { ArrowLeft, Plus, X } from "lucide-react";

export function NewProjectPage() {
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">New project</h1>
        <IconLink to="/projects" label="Back">
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </IconLink>
      </header>

      <Card>
        <CardHeader title="Project details" subtitle="This will be stored in SQLite on your machine." />
        <CardBody>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void (async () => {
                try {
                  setSaving(true);
                  setError(null);
                  const p = await createProject({ name: name.trim(), description });
                  nav(`/projects/${p.id}`);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Failed to create project");
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

            {error ? <p className="text-sm text-red-700">{error}</p> : null}

            <div className="flex items-center gap-2">
              <IconButton
                tone="accent"
                label="Create project"
                disabled={saving || name.trim().length === 0}
                type="submit"
                className="h-10 w-10"
              >
                <Plus className="h-5 w-5" aria-hidden="true" />
              </IconButton>
              <IconLink to="/projects" label="Cancel">
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

