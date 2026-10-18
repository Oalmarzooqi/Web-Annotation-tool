"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { SHORTCUT_GROUPS } from "../../lib/shortcuts";

/** Help popup listing every shortcut. Content comes from the same table the
 *  key handler uses, so it cannot go stale. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "?" || e.key === "F1") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px] animate-in fade-in duration-200"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-neutral-700/50 bg-neutral-900/95 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold leading-6 text-white">Keyboard shortcuts</h3>
            <p className="mt-1 text-xs text-neutral-400">
              Single-key shortcuts pause while you are typing in a field.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close shortcuts"
            className="rounded-lg p-1 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title}>
              <h4 className="mb-2 text-[10px] font-extrabold uppercase tracking-wider text-[color:var(--color-ocean-green)]">
                {group.title}
              </h4>
              <ul className="space-y-1.5">
                {group.rows.map((row) => (
                  <li key={row.keys} className="flex items-baseline gap-3 text-sm">
                    <kbd className="shrink-0 rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 font-mono text-[11px] text-neutral-200">
                      {row.keys}
                    </kbd>
                    <span className="text-neutral-300">{row.action}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
