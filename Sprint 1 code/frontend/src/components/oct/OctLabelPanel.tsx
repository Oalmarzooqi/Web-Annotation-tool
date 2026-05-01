"use client";

export function OctLabelPanel() {
  return (
    <aside className="hidden w-72 border-l border-[color:var(--color-ocean-green)]/20 bg-[color:var(--color-surface-2)] p-4 lg:block">
      <div className="rounded-2xl border border-[color:var(--color-ocean-green)]/25 bg-[color:var(--color-surface)] p-4 shadow-sm shadow-black/[0.03]">
        <p className="font-heading text-sm font-semibold tracking-tight">
          <span className="text-[color:var(--color-ocean-green)]">Labels</span>
        </p>
        <p className="mt-1 text-sm text-[color:var(--color-muted)]">
          Click the slice to place points (image coordinates). Polygon / labels / export come next.
        </p>
      </div>
    </aside>
  );
}

