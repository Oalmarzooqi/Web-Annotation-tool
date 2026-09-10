/**
 * Every keyboard shortcut on the annotate page, in one table.
 *
 * `matchShortcut` drives the key handler and `SHORTCUT_GROUPS` drives the help
 * dialog, so the popup cannot drift away from what the keys actually do.
 */

import type { DrawMode } from "../components/oct/OctCanvas";

export type ShortcutAction =
  | { kind: "tool"; mode: DrawMode }
  | { kind: "label"; index: number }
  | { kind: "slice"; to: "prev" | "next" | "first" | "last" }
  | { kind: "zoom"; to: "in" | "out" | "reset" }
  | { kind: "toggleActiveLabel" }
  | { kind: "toggleShowAll" }
  | { kind: "help" }
  | { kind: "save" }
  | { kind: "undo" }
  | { kind: "redo" }
  | { kind: "commit" }
  | { kind: "cancel" }
  | { kind: "delete" };

/** Toolbar order — index+1 is the digit that selects the tool. */
export const TOOL_ORDER: DrawMode[] = [
  "point",
  "polygon",
  "line",
  "layer",
  "spline",
  "freehand",
  "pan",
  "edit",
  "erase",
];

/** True when the event came from somewhere the user is typing. */
export function isTypingTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return !!el?.closest("input, textarea, select, [contenteditable=true]");
}

/**
 * Resolve a keydown to an action, or null if nothing is bound.
 *
 * Single-key bindings are suppressed while typing; the Ctrl/Cmd combos and
 * Escape still work so Ctrl+S from inside the label input saves as expected.
 */
export function matchShortcut(e: KeyboardEvent): ShortcutAction | null {
  const mod = e.ctrlKey || e.metaKey;
  const typing = isTypingTarget(e);

  if (mod && !e.altKey) {
    const k = e.key.toLowerCase();
    if (k === "s") return { kind: "save" };
    if (k === "z") return e.shiftKey ? { kind: "redo" } : { kind: "undo" };
    if (k === "y") return { kind: "redo" };
    return null;
  }
  if (mod || e.altKey) return null;

  if (e.key === "Escape") return { kind: "cancel" };
  if (typing) return null;

  // e.code keeps digits working on layouts where Shift+1 is not "!".
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (digit) {
    const n = Number(digit[1]);
    if (e.shiftKey) return { kind: "label", index: n - 1 };
    const mode = TOOL_ORDER[n - 1];
    return mode ? { kind: "tool", mode } : null;
  }

  if (e.key === "?" || e.key === "F1") return { kind: "help" };
  if (e.shiftKey && e.key.toLowerCase() === "a") return { kind: "toggleShowAll" };
  if (e.shiftKey) return null;

  switch (e.key) {
    case "ArrowLeft":
      return { kind: "slice", to: "prev" };
    case "ArrowRight":
      return { kind: "slice", to: "next" };
    case "Home":
      return { kind: "slice", to: "first" };
    case "End":
      return { kind: "slice", to: "last" };
    case "+":
    case "=":
      return { kind: "zoom", to: "in" };
    case "-":
      return { kind: "zoom", to: "out" };
    case "0":
      return { kind: "zoom", to: "reset" };
    case "h":
    case "H":
      return { kind: "toggleActiveLabel" };
    case "Enter":
      return { kind: "commit" };
    case "Delete":
    case "Backspace":
      return { kind: "delete" };
    default:
      return null;
  }
}

export type ShortcutRow = { keys: string; action: string };
export type ShortcutGroup = { title: string; rows: ShortcutRow[] };

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Tools",
    rows: [
      { keys: "1", action: "Point" },
      { keys: "2", action: "Polygon" },
      { keys: "3", action: "Line" },
      { keys: "4", action: "Layer — multi-point line across the whole image" },
      { keys: "5", action: "Spline — named smooth curve through your points" },
      { keys: "6", action: "Freehand" },
      { keys: "7", action: "Pan" },
      { keys: "8", action: "Edit" },
      { keys: "9", action: "Erase" },
    ],
  },
  {
    title: "Drawing",
    rows: [
      { keys: "Enter", action: "Finish polygon, layer line, or spline" },
      { keys: "Backspace", action: "Remove the last draft point" },
      { keys: "Esc", action: "Cancel draft · deselect · back to Point" },
      { keys: "Delete", action: "Delete selected annotation (Edit mode)" },
      { keys: "Double-click", action: "Finish polygon, layer line, or spline" },
    ],
  },
  {
    title: "Layers",
    rows: [
      { keys: "Shift + 1…9", action: "Select label 1–9" },
      { keys: "H", action: "Hide or show the active label" },
      { keys: "Shift + A", action: "Toggle Show all" },
    ],
  },
  {
    title: "Navigation",
    rows: [
      { keys: "← / →", action: "Previous / next slice" },
      { keys: "Home / End", action: "First / last slice" },
      { keys: "+ / −", action: "Zoom in / out" },
      { keys: "0", action: "Reset zoom" },
      { keys: "Ctrl + wheel", action: "Zoom at the cursor" },
      { keys: "Drag at edge", action: "Auto-pan while drawing near the left/right edge" },
    ],
  },
  {
    title: "File",
    rows: [
      { keys: "Ctrl + S", action: "Save now (auto-save runs 2s after each change)" },
      { keys: "Ctrl + Z", action: "Undo" },
      { keys: "Ctrl + Shift + Z", action: "Redo" },
      { keys: "? or F1", action: "Show this help" },
    ],
  },
];
