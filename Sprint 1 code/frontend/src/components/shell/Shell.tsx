"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { Outlet } from "react-router-dom";
import { SideNav } from "./SideNav";

const KEY = "oct.shell.navCollapsed.v1";
const EVENT_NAME = "oct-shell";

// Keep first render deterministic.
let cachedSnapshot = "0";

function getSnapshot(): string {
  if (typeof window === "undefined") return "0";
  return cachedSnapshot;
}

function writeCollapsed(v: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, v ? "1" : "0");
  cachedSnapshot = v ? "1" : "0";
  window.dispatchEvent(new Event(EVENT_NAME));
}

function subscribe(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  window.addEventListener(EVENT_NAME, handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(EVENT_NAME, handler);
  };
}

export function Shell() {
  const raw = useSyncExternalStore(subscribe, getSnapshot, () => "0");
  const collapsed = raw === "1";

  useEffect(() => {
    const v = window.localStorage.getItem(KEY) ?? "0";
    if (v !== cachedSnapshot) {
      cachedSnapshot = v;
      window.dispatchEvent(new Event(EVENT_NAME));
    }
  }, []);

  const navW = useMemo(() => (collapsed ? "6rem" : "20rem"), [collapsed]);
  const contentPad = useMemo(() => (collapsed ? "8rem" : "22rem"), [collapsed]);

  return (
    <>
      <SideNav
        collapsed={collapsed}
        onToggle={() => {
          writeCollapsed(!collapsed);
        }}
      />

      <div
        className="min-h-screen"
        style={
          {
            ["--shell-nav-w"]: navW,
            ["--shell-content-pl"]: contentPad,
          } as CSSProperties & Record<string, string>
        }
      >
        <div className="min-h-screen lg:pl-[var(--shell-content-pl)]">
          <div className="min-h-screen px-6 py-8">
            <Outlet />
          </div>
        </div>
      </div>
    </>
  );
}

