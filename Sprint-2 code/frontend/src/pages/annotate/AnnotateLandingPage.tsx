"use client";

import { Card, CardBody, CardHeader, IconLink } from "../../components/ui";
import { FolderKanban } from "lucide-react";

export function AnnotateLandingPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Annotate</h1>
        <IconLink to="/projects" label="Projects" tone="accent">
          <FolderKanban className="h-5 w-5" aria-hidden="true" />
        </IconLink>
      </header>

      <Card>
        <CardHeader title="Pick a project first" subtitle="Annotation is always done inside a project." />
        <CardBody>
          <p className="text-sm text-[color:var(--color-muted)]">
            Go to Projects, open a project, then click the Annotate icon to enter
            <span className="font-mono"> /projects/&lt;id&gt;/annotate</span>.
          </p>
          <div className="mt-4">
            <IconLink to="/projects" label="Go to Projects" tone="accent">
              <FolderKanban className="h-5 w-5" aria-hidden="true" />
            </IconLink>
          </div>
        </CardBody>
      </Card>
    </main>
  );
}

