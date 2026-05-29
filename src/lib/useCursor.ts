"use client";
import { useEffect, useSyncExternalStore } from "react";

export type CursorStyle = "delos" | "classic" | "neon" | "system";

const STORE_KEY = "delos.cursor.v1";

export const CURSORS: Array<{ id: CursorStyle; label: string; desc: string }> = [
  { id: "delos", label: "DelOS", desc: "Cream + gold pixel arrow (default)." },
  { id: "classic", label: "Classic", desc: "Win95 white arrow with black border." },
  { id: "neon", label: "Neon", desc: "Cyan + magenta synthwave glow." },
  { id: "system", label: "System", desc: "Use your OS native cursor (no override)." },
];

export function getCursor(): CursorStyle {
  if (typeof window === "undefined") return "delos";
  try {
    return (localStorage.getItem(STORE_KEY) as CursorStyle) ?? "delos";
  } catch {
    return "delos";
  }
}

function apply(c: CursorStyle) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-cursor", c);
}

export function setCursor(c: CursorStyle) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORE_KEY, c);
    apply(c);
    window.dispatchEvent(new CustomEvent("delos-cursor-changed", { detail: { cursor: c } }));
  } catch {}
}

function subscribe(cb: () => void) {
  window.addEventListener("delos-cursor-changed", cb);
  return () => window.removeEventListener("delos-cursor-changed", cb);
}

export function useCursor(): [CursorStyle, (c: CursorStyle) => void] {
  const c = useSyncExternalStore(subscribe, getCursor, (): CursorStyle => "delos");
  // apply() is a DOM write (not setState) so it can live in an effect keyed on
  // the snapshot; covers first-mount hydration + cross-window broadcasts.
  useEffect(() => {
    apply(c);
  }, [c]);
  return [c, setCursor];
}
