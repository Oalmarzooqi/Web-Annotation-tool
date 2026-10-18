"use client";

import { useMemo } from "react";
import { OctCanvas, type Annotation, type ImagePoint, type OctCanvasFrame } from "./OctCanvas";
import { colorToAnnotationStyle } from "../../lib/surfaceLabels";

/** The only thing drawn over the projection is the slice indicator. */
const INDICATOR_STYLE = colorToAnnotationStyle("#facc15");

/**
 * Side panel showing the en-face (top-down) projection next to the B-scan —
 * a second view, not a swap. Reuses OctCanvas itself so it gets the same
 * contained-aspect-ratio rendering, zoom/pan controls and card styling as
 * the main view, instead of reinventing them. A yellow line marks the slice
 * currently shown in the main canvas; clicking the strip jumps to that slice.
 *
 * The indicator is drawn as a vector annotation rather than stamped into the
 * projection's pixels, which would mean re-cloning its whole buffer (megabytes)
 * on every slice change.
 */
export function EnFacePanel({
  frame,
  loading,
  error,
  progress,
  sliceIdx,
  sliceCount,
  onSliceSelect,
}: {
  frame: OctCanvasFrame | null;
  loading: boolean;
  error: string | null;
  /** Slices processed so far while building — lets the loading state show real progress. */
  progress?: { done: number; total: number } | null;
  sliceIdx: number;
  sliceCount: number;
  onSliceSelect: (idx: number) => void;
}) {
  const displayFrame = frame;

  const indicator = useMemo<Annotation[]>(() => {
    if (!displayFrame || sliceCount < 2) return [];
    const y = (sliceIdx / (sliceCount - 1)) * (displayFrame.height - 1);
    return [
      {
        id: "slice-indicator",
        labelId: "slice-indicator",
        type: "line",
        points: [
          { x: 0, y },
          { x: displayFrame.width - 1, y },
        ],
      },
    ];
  }, [displayFrame, sliceIdx, sliceCount]);

  // The projection is square but coarse; OctCanvas's default zoom leaves it
  // small in the card, so open it already filling the panel.
  const initialZoom = useMemo(() => {
    if (!displayFrame) return undefined;
    const baseMaxW = 1100;
    const baseMaxH = 650;
    const baseScale = Math.min(baseMaxW / displayFrame.width, baseMaxH / displayFrame.height, 1);
    const targetHeightPx = 420;
    return Math.max(0.2, Math.min(6, targetHeightPx / (displayFrame.height * baseScale)));
  }, [displayFrame]);

  return (
    <section
      className="flex min-w-0 flex-1 flex-col gap-2 border-l border-[color:var(--color-ocean-green)]/20 bg-[color:var(--color-surface)] p-4"
      aria-label="Top-down (en-face) view"
    >
      <p className="font-heading text-xs font-semibold uppercase tracking-wide text-[color:var(--color-muted)]">
        Top View (en-face)
      </p>
      {loading ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm text-[color:var(--color-muted)]">
            {progress ? `Building top view… ${progress.done}/${progress.total} slices` : "Building top view…"}
          </p>
          {progress ? (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--color-ocean-green)]/15">
              <div
                className="h-full rounded-full bg-[color:var(--color-ocean-green)] transition-[width]"
                style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }}
              />
            </div>
          ) : null}
        </div>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : displayFrame ? (
        <>
          <div className="flex min-h-0 flex-1">
            <OctCanvas
              frame={displayFrame}
              annotations={indicator}
              mode="point"
              draft={null}
              resolveAnnotationStyle={() => INDICATOR_STYLE}
              draftStyle={INDICATOR_STYLE}
              initialZoom={initialZoom}
              onClickImage={(p: ImagePoint) => {
                if (sliceCount < 2) return;
                const idx = Math.round((p.y / (displayFrame.height - 1)) * (sliceCount - 1));
                onSliceSelect(Math.max(0, Math.min(sliceCount - 1, idx)));
              }}
            />
          </div>
          <p className="text-[11px] text-[color:var(--color-muted)]">
            Average intensity across each slice&apos;s full depth. Click the strip to jump to that slice.
          </p>
        </>
      ) : (
        <p className="text-sm text-[color:var(--color-muted)]">No top view built yet.</p>
      )}
    </section>
  );
}
