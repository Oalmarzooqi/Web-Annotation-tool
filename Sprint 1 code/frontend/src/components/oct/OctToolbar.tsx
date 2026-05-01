"use client";

import type { ReactNode } from "react";
import { IconLink, VerticalRule } from "../ui";
import { FolderKanban } from "lucide-react";

export function OctToolbar({
  projectName,
  right,
}: {
  projectName?: string;
  right?: ReactNode;
}) {
  return (
    <header className="flex min-h-14 items-center gap-3 border-b border-[color:var(--color-ocean-green)]/20 bg-[color:var(--color-surface-2)] px-4 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[color:var(--color-ocean-green)]/35 bg-[color:var(--color-surface)] p-1 shadow-sm shadow-black/[0.03]">
          <img src="/logo.png" alt="" className="h-8 w-8 object-contain" draggable={false} />
        </div>
        <div className="min-w-0">
          <p className="font-heading truncate text-sm font-semibold tracking-tight text-[color:var(--color-foreground)]">
            <span className="text-[color:var(--color-ocean-green)]">OCT</span> Annotator
          </p>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <p className="truncate text-xs text-[color:var(--color-muted)]">Project-scoped annotation</p>
            {projectName ? (
              <span className="hidden min-w-0 items-center gap-2 sm:inline-flex">
                <span className="shrink-0 rounded-full border border-[color:var(--color-ocean-green)]/40 bg-[color:var(--color-ocean-green)]/[0.08] px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-[color:var(--color-ocean-green)]">
                  Project
                </span>
                <span className="truncate text-xs font-medium text-[color:var(--color-foreground)]">
                  {projectName}
                </span>
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <nav className="flex items-center">
        {right ? (
          <>
            <div className="flex items-center gap-2">{right}</div>
            <VerticalRule />
          </>
        ) : null}
        <IconLink to="/projects" label="Projects">
          <FolderKanban className="h-5 w-5" aria-hidden="true" />
        </IconLink>
      </nav>
    </header>
  );
}

