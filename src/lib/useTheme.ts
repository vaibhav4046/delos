"use client";
import { useEffect, useState } from "react";

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

export function useTheme(): [Theme, (t: Theme) => void] {
  const [t, setT] = useState<Theme>("dark");
  useEffect(() => {
    const v = read();
    setT(v);
    apply(v);
    function onChange(e: Event) {
      const d = (e as CustomEvent).detail as { theme: Theme };
      setT(d.theme);
    }
    window.addEventListener("delos-theme-changed", onChange as EventListener);
    return () => window.removeEventListener("delos-theme-changed", onChange as EventListener);
  }, []);
  return [
    t,
    (next) => {
      setTheme(next);
      setT(next);
    },
  ];
}
