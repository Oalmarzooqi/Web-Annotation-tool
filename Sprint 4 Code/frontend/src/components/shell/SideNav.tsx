"use client";

import { Link, useLocation } from "react-router-dom";
import { Folder, Pencil } from "lucide-react";
import { HorizontalRule } from "../ui";

type NavItem = { href: string; label: string };

const items: NavItem[] = [
  { href: "/projects", label: "Projects" },
  { href: "/annotate", label: "Annotate" },
];

function isActive(pathname: string, href: string) {
  if (href === "/projects") return pathname === "/projects" || pathname.startsWith("/projects/");
  if (href === "/annotate") return pathname === "/annotate" || pathname.startsWith("/projects/") && pathname.endsWith("/annotate");
  return pathname === href || pathname.startsWith(href + "/");
}

function Icon({ kind }: { kind: "projects" | "annotate" }) {
  if (kind === "projects") return <Folder className="h-[18px] w-[18px]" aria-hidden="true" />;
  return <Pencil className="h-[18px] w-[18px]" aria-hidden="true" />;
}

export function SideNav({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { pathname } = useLocation();

  return (
    <aside
      className={
        "pointer-events-none fixed left-4 top-4 z-40 hidden h-[calc(100vh-2rem)] lg:block " +
        (collapsed ? "w-24" : "w-80")
      }
    >
      <div className="pointer-events-auto flex h-full flex-col rounded-2xl border-2 border-slate-200 dark:border-slate-300 bg-[color:var(--color-surface)] shadow-lg shadow-black/5">
        <div
          className={
            "border-b border-slate-200 dark:border-slate-200 " +
            (collapsed ? "px-2 py-3" : "px-4 py-4")
          }
        >
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={onToggle}
              className="flex h-14 w-14 items-center justify-center border-0 bg-transparent p-0 shadow-none outline-none transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-ocean-green)]/50"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <img
                src="/logo.png"
                alt=""
                className="h-12 w-12 object-contain"
                draggable={false}
              />
            </button>
          </div>
        </div>

        <nav className={"flex flex-col gap-1 p-2 " + (collapsed ? "items-center" : "")}>
          {items.map((it, index) => {
            const active = isActive(pathname, it.href);
            const kind = it.label === "Projects" ? "projects" : "annotate";
            return (
              <div key={it.label} className={"flex flex-col gap-1 " + (collapsed ? "items-center" : "w-full")}>
                {index > 0 ? (
                  <div className={"w-full px-1 " + (collapsed ? "max-w-[3.25rem]" : "")}>
                    <HorizontalRule />
                  </div>
                ) : null}
                <Link
                  to={it.href}
                  className={
                    "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-ocean-green)]/40 " +
                    (collapsed ? " w-16 justify-center px-0" : " w-full") +
                    (active
                      ? "bg-slate-100/65 dark:bg-white/10 text-[color:var(--color-ocean-green)] font-bold"
                      : "text-slate-400 dark:text-slate-500 hover:bg-slate-100/30 dark:hover:bg-white/5 hover:text-slate-700 dark:hover:text-slate-300")
                  }
                >
                  <span
                    className={
                      "grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-transparent " +
                      (active
                        ? "text-[color:var(--color-ocean-green)]"
                        : "text-slate-400 dark:text-slate-500")
                    }
                    aria-hidden="true"
                  >
                    <Icon kind={kind} />
                  </span>
                  {!collapsed ? (
                    <span className="min-w-0 flex-1 font-semibold">{it.label}</span>
                  ) : (
                    <span className="sr-only">{it.label}</span>
                  )}
                </Link>
              </div>
            );
          })}
        </nav>

        {!collapsed ? (
          <div className="mt-auto border-t border-[color:var(--color-border)] p-3">
            <p className="text-xs text-[color:var(--color-muted)]">
              Next: attach volumes to projects.
            </p>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

