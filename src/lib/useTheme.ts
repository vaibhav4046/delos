"use client";
import { useEffect, useSyncExternalStore } from "react";

const STORE_KEY = "delos.theme.v1";
export type Theme = "dark" | "light";

function read(): Theme {
  if (typeof window === "undefined") return "dark";
  try {
    return (localStorage.getItem(STORE_KEY) as Theme) ?? "dark";
  } catch {
    return "dark";
  }
}

function apply(t: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", t);
}

export function setTheme(t: Theme) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORE_KEY, t);
    apply(t);
    window.dispatchEvent(new CustomEvent("delos-theme-changed", { detail: { theme: t } }));
  } catch {}
}

function subscribe(cb: () => void) {
  window.addEventListener("delos-theme-changed", cb);
  return () => window.removeEventListener("delos-theme-changed", cb);
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const t = useSyncExternalStore(subscribe, read, (): Theme => "dark");
  // apply() is a DOM write (not setState) so it can live in an effect keyed on
  // the snapshot; covers first-mount hydration + cross-window broadcasts.
  useEffect(() => {
    apply(t);
  }, [t]);
  return [t, setTheme];
}
