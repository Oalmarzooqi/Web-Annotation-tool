"use client";

import React, { useState } from "react";
import type { SurfaceLabel } from "../../lib/surfaceLabels";
import { IconButton } from "../ui";
import { Input } from "../ui/Input";
import { Eye, EyeOff, Plus, Trash2, ChevronRight, ChevronLeft } from "lucide-react";

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
  /** Labels hidden from the canvas (session only — never persisted). */
  hiddenLabelIds: Set<string>;
  onToggleLabelVisibility: (id: string) => void;
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
  hiddenLabelIds,
  onToggleLabelVisibility,
}: Props) {
  const [newName, setNewName] = useState("");
  const [isCollapsed, setIsCollapsed] = useState(false);

  const submitAdd = () => {
    const t = newName.trim();
    if (!t) return;
    onAddLabel(t);
    setNewName("");
  };

  if (isCollapsed) {
    return (
      <aside className="hidden lg:flex flex-col h-full w-14 shrink-0 border-l border-slate-200/80 dark:border-slate-800/80 bg-[color:var(--color-surface)] items-center py-3 transition-all duration-300">
        {/* Collapse / Expand Toggle Button */}
        <div className="flex items-center justify-center h-10 w-full px-2">
          <button
            type="button"
            onClick={() => setIsCollapsed(false)}
            className="flex items-center justify-center h-9 w-9 rounded-xl text-slate-500 hover:text-[color:var(--color-ocean-green)] hover:bg-[color:var(--color-ocean-green)]/10 transition-all duration-200"
            title="Expand Labels Panel"
            aria-label="Expand Labels Panel"
          >
            <ChevronLeft className="h-5 w-5 stroke-[2]" />
          </button>
        </div>

        {/* 80% Light Grey Separation Line */}
        <div className="h-px w-[80%] bg-slate-200 dark:bg-slate-700/60 mx-auto my-2" aria-hidden />

        {/* Collapsed Labels list with light grey separation lines */}
        <div className="flex flex-col items-center flex-1 overflow-y-auto w-full px-2 py-1 gap-1">
          {labels.map((lab, index) => {
            const active = lab.id === activeLabelId;
            const hidden = hiddenLabelIds.has(lab.id);
            return (
              <React.Fragment key={lab.id}>
                {index > 0 && (
                  <div className="h-px w-[65%] bg-slate-200/80 dark:bg-slate-700/50 mx-auto my-0.5" aria-hidden />
                )}
                <button
                  type="button"
                  onClick={() => (active ? onClearActiveLabel() : onSelectLabel(lab.id))}
                  className={
                    "group relative flex items-center justify-center h-9 w-9 rounded-xl transition-all duration-200 " +
                    (active
                      ? "bg-[color:var(--color-ocean-green)]/12 border border-[color:var(--color-ocean-green)]/50 shadow-xs"
                      : "hover:bg-slate-100 dark:hover:bg-slate-800/60")
                  }
                  title={`${lab.name}${active ? " (Active)" : ""}${hidden ? " (Hidden)" : ""}`}
                >
                  <span
                    className={
                      "h-3.5 w-3.5 rounded-full transition-all duration-200 " +
                      (hidden ? "opacity-30 scale-75" : "opacity-100 group-hover:scale-110")
                    }
                    style={{ backgroundColor: lab.color }}
                  />
                  {active && (
                    <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-[color:var(--color-ocean-green)] ring-2 ring-white dark:ring-slate-900" />
                  )}
                </button>
              </React.Fragment>
            );
          })}
        </div>
      </aside>
    );
  }

  return (
    <aside className="hidden lg:flex flex-col h-full w-72 shrink-0 border-l border-slate-200/80 dark:border-slate-800/80 bg-[color:var(--color-surface)] transition-all duration-300">
      {/* Header Section */}
      <div className="flex items-center justify-between p-4 pb-3">
        <div className="flex items-center gap-2">
          <p className="min-w-0 font-heading text-sm font-semibold tracking-tight">
            <span className="text-[color:var(--color-grey)]">Labels</span>
          </p>
          <span className="rounded-full bg-[color:var(--color-ocean-green)]/10 px-2 py-0.5 text-xs font-semibold text-[color:var(--color-ocean-green)]">
            {labels.length}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setIsCollapsed(true)}
          className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-ocean-green)] hover:bg-[color:var(--color-ocean-green)]/10 transition-colors"
          title="Collapse Panel"
          aria-label="Collapse Panel"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* 80% Light Grey Separation Line */}
      <div className="h-px w-[80%] bg-slate-200 dark:bg-slate-700/60 mx-auto" aria-hidden />

      {/* Show All Layers Toggle Switch */}
      <div className="px-4 py-3 flex items-center justify-between">
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

      <div className="px-4 pb-3">
        <p className="text-xs text-[color:var(--color-muted)]">
          Choose the active layer; new shapes use its color.
        </p>
      </div>

      {/* 80% Light Grey Separation Line */}
      <div className="h-px w-[80%] bg-slate-200 dark:bg-slate-700/60 mx-auto" aria-hidden />

      {/* Scrollable Label List */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto min-h-0 py-1">
          <ul className="w-full" aria-label="Surface labels">
            {labels.map((lab, index) => {
              const active = lab.id === activeLabelId;
              const hidden = hiddenLabelIds.has(lab.id);
              return (
                <React.Fragment key={lab.id}>
                  {index > 0 && (
                    <li aria-hidden="true" className="list-none flex justify-center py-0">
                      <div className="h-px w-[80%] bg-slate-200 dark:bg-slate-700/60" />
                    </li>
                  )}
                  <li
                    className={
                      "flex w-full items-center gap-2 px-4 py-2.5 transition-colors " +
                      (active ? "bg-[color:var(--color-ocean-green)]/4" : "")
                    }
                  >
                    <button
                      type="button"
                      onClick={() => (active ? onClearActiveLabel() : onSelectLabel(lab.id))}
                      className={
                        "flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--color-surface)] " +
                        (active ? "" : "hover:bg-black/[0.03]")
                      }
                      aria-pressed={active}
                    >
                      <span
                        className={"h-3.5 w-3.5 shrink-0 rounded-full " + (hidden ? "opacity-30" : "")}
                        style={{ backgroundColor: lab.color }}
                        aria-hidden
                      />
                      <span
                        className={
                          "truncate " +
                          (hidden ? "line-through opacity-50 " : "") +
                          (active
                            ? "font-semibold text-[color:var(--color-ocean-green)]"
                            : "font-medium text-neutral-600 dark:text-neutral-300")
                        }
                      >
                        {lab.name}
                      </span>
                    </button>
                    <IconButton
                      label={`${hidden ? "Show" : "Hide"} label ${lab.name}`}
                      className="!h-8 !w-8 focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--color-surface)]"
                      onClick={() => onToggleLabelVisibility(lab.id)}
                    >
                      {hidden ? (
                        <EyeOff className="h-4 w-4 text-slate-400" aria-hidden />
                      ) : (
                        <Eye className="h-4 w-4 text-slate-500" aria-hidden />
                      )}
                    </IconButton>
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
                </React.Fragment>
              );
            })}
          </ul>
        </div>

        {/* 80% Light Grey Separation Line */}
        <div className="h-px w-[80%] bg-slate-200 dark:bg-slate-700/60 mx-auto" aria-hidden />
      </div>

      {/* Footer Add Form */}
      <div className="p-4 bg-[color:var(--color-surface-2)] shrink-0">
        <div className="flex gap-2">
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



