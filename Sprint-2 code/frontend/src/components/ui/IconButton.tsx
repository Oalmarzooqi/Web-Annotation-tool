"use client";

import { Link } from "react-router-dom";
import type { ComponentProps, ReactNode } from "react";

type Tone = "default" | "danger" | "accent";

function toneClasses(tone: Tone) {
  switch (tone) {
    case "danger":
      return "text-red-600 hover:text-red-700";
    case "accent":
      return "text-[color:var(--color-accent-strong)] hover:opacity-90";
    case "default":
    default:
      return "text-[color:var(--color-muted)] hover:text-[color:var(--color-foreground)]";
  }
}

const base =
  "inline-grid h-9 w-9 place-items-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]";

export function IconButton({
  tone = "default",
  label,
  children,
  ...props
}: ComponentProps<"button"> & {
  tone?: Tone;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      {...props}
      className={
        base +
        " " +
        toneClasses(tone) +
        " hover:bg-black/5" +
        (props.className ? ` ${props.className}` : "")
      }
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

export function IconLink({
  tone = "default",
  label,
  children,
  ...props
}: ComponentProps<typeof Link> & {
  tone?: Tone;
  label: string;
  children: ReactNode;
}) {
  return (
    <Link
      {...props}
      className={
        base +
        " " +
        toneClasses(tone) +
        " hover:bg-black/5" +
        (props.className ? ` ${props.className}` : "")
      }
      aria-label={label}
      title={label}
    >
      {children}
    </Link>
  );
}

