"use client";

import { useState } from "react";
import type { SurfaceLabel } from "../../lib/surfaceLabels";
import { IconButton } from "../ui";
import { Input } from "../ui/Input";
import { Plus, Trash2 } from "lucide-react";

type Props = {
  labels: SurfaceLabel[];
  activeLabelId: string | null;
  onSelectLabel: (id: string) => void;
  /** Clear selection so no label is active (annotations require a label). */
  onClearActiveLabel: () => void;
  onAddLabel: (name: string) => void;
  onDeleteLabel: (id: string) => void;
  showAllLayers: boolean;
  onToggleShowAll: () => void;
};

export function OctLabelPanel({
  labels,
  activeLabelId,
  onSelectLabel,
  onClearActiveLabel,
  onAddLabel,
  onDeleteLabel,
  showAllLayers,
  onToggleShowAll,
}: Props) {
  const [newName, setNewName] = useState("");

  const submitAdd = () => {
    const t = newName.trim();
    if (!t) return;
    onAddLabel(t);
    setNewName("");
  };

  return (
    <aside className="hidden w-72 shrink-0 border-l border-[color:var(--color-ocean-green)]/20 bg-[color:var(--color-surface-2)] p-4 lg:block">
      <div className="rounded-lg border border-[color:var(--color-ocean-green)]/25 bg-[color:var(--color-surface)] p-4 shadow-sm shadow-black/[0.03]">
        <div className="flex items-center gap-2">
          <p className="min-w-0 font-heading text-sm font-semibold tracking-tight">
            <span className="text-[color:var(--color-grey)]">Labels</span>
          </p>
        </div>

        {/* Modern Show All Layers Toggle Switch */}
        <div className="mt-3.5 mb-2 flex items-center justify-between px-1">
          <span className="text-sm font-medium text-[color:var(--color-ocean-green)]">Show all</span>
          <button
            type="button"
            onClick={() => onToggleShowAll()}
            className={
              "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none " +
              (showAllLayers
                ? "bg-[color:var(--color-ocean-green)]"
                : "bg-slate-200 dark:bg-slate-700")
            }
            role="switch"
            aria-checked={showAllLayers}
          >
            <span
              className={
                "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out " +
                (showAllLayers ? "translate-x-4" : "translate-x-0")
              }
            />
          </button>
        </div>

        <div className="border-t border-slate-200 dark:border-slate-800/80 my-2.5" aria-hidden />

        <p className="mt-2 text-xs text-[color:var(--color-muted)]">
          Choose the active layer; new shapes use its color.
        </p>

        {/* Full-width rules (100% of card); internal dividers: light grey @ 90% opacity */}
        <div className="-mx-4 mt-4">
          <div className="h-px w-full bg-neutral-300/90" aria-hidden />
          <ul className="w-full divide-y divide-neutral-300/90" aria-label="Surface labels">
            {labels.map((lab) => {
              const active = lab.id === activeLabelId;
              return (
                <li
                  key={lab.id}
                  className={
                    "flex w-full items-center gap-2 px-4 py-2.5 transition-colors " +
                    (active ? "bg-[color:var(--color-ocean-green)]/4" : "")
                  }
                >
                  <button
                    type="button"
                    onClick={() => active ? onClearActiveLabel() : onSelectLabel(lab.id)}
                    className={
                      "flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--color-surface)] " +
                      (active ? "" : "hover:bg-black/[0.03]")
                    }
                    aria-pressed={active}
                  >
                    <span
                      className="h-3.5 w-3.5 shrink-0 rounded-full"
                      style={{ backgroundColor: lab.color }}
                      aria-hidden
                    />
                    <span
                      className={
                        "truncate " +
                        (active
                          ? "font-semibold text-[color:var(--color-ocean-green)]"
                          : "font-medium text-neutral-500")
                      }
                    >
                      {lab.name}
                    </span>
                  </button>
                  <IconButton
                    tone="danger"
                    label={`Delete label ${lab.name}`}
                    className="!h-8 !w-8 focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--color-surface)]"
                    disabled={labels.length <= 1}
                    onClick={() => onDeleteLabel(lab.id)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </IconButton>
                </li>
              );
            })}
          </ul>
          <div className="h-px w-full bg-neutral-300/90" aria-hidden />
        </div>

        <div className="mt-4 flex gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitAdd();
              }
            }}
            placeholder="New label name"
            aria-label="New label name"
            className="min-w-0 flex-1 text-sm focus-visible:border-[color:var(--color-ocean-green)]/45 focus-visible:ring-[color:var(--color-ocean-green)]"
          />
          <button
            type="button"
            onClick={submitAdd}
            className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-[color:var(--color-ocean-green)]/35 bg-[color:var(--color-surface-2)] px-3 py-2 text-sm font-medium text-[color:var(--color-ocean-green)] transition-colors hover:bg-[color:var(--color-ocean-green)]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add
          </button>
        </div>
      </div>
    </aside>
  );
}
