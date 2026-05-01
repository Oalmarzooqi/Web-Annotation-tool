"use client";

/** Thin vertical line between adjacent toolbar / icon-button controls. */
export function VerticalRule() {
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      className="mx-1.5 h-5 w-px shrink-0 bg-[color:var(--color-border)]"
      aria-hidden="true"
    />
  );
}

/** Full-width horizontal rule between stacked nav rows. */
export function HorizontalRule() {
  return (
    <div
      role="separator"
      className="h-px w-full bg-[color:var(--color-border)]"
      aria-hidden="true"
    />
  );
}
