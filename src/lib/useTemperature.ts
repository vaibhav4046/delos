"use client";
import { useEffect, useState } from "react";

// Temperature persisted to localStorage. Sent with every /api/run + /api/quick-agent call.
// Default 0.7 — Vercel AI SDK default. Range 0.0–1.5.

const STORE_KEY = "delos.temperature.v1";
const DEFAULT_TEMP = 0.7;
const MIN_TEMP = 0;
const MAX_TEMP = 1.5;

export function getTemperature(): number {
  if (typeof window === "undefined") return DEFAULT_TEMP;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return DEFAULT_TEMP;
    const n = Number(raw);
    if (Number.isNaN(n) || n < MIN_TEMP || n > MAX_TEMP) return DEFAULT_TEMP;
    return n;
  } catch {
    return DEFAULT_TEMP;
  }
}

export function setTemperature(t: number) {
  if (typeof window === "undefined") return;
  const clamped = Math.min(MAX_TEMP, Math.max(MIN_TEMP, t));
  try {
    localStorage.setItem(STORE_KEY, String(clamped));
    window.dispatchEvent(new CustomEvent("delos-temperature-changed", { detail: { t: clamped } }));
  } catch {}
}

export function useTemperature(): [number, (t: number) => void] {
  const [t, setT] = useState<number>(DEFAULT_TEMP);
  useEffect(() => {
    setT(getTemperature());
    function onChange(e: Event) {
      const d = (e as CustomEvent).detail as { t: number };
      setT(d.t);
    }
    window.addEventListener("delos-temperature-changed", onChange as EventListener);
    return () => window.removeEventListener("delos-temperature-changed", onChange as EventListener);
  }, []);
  return [t, (next) => { setTemperature(next); setT(next); }];
}

export const TEMP_PRESETS: Array<{ label: string; value: number; tone: string }> = [
  { label: "Precise", value: 0.1, tone: "Deterministic. Best for code, math, structured output." },
  { label: "Balanced", value: 0.7, tone: "Default. Good mix of creativity and reliability." },
  { label: "Creative", value: 1.0, tone: "More varied. Best for writing, brainstorming." },
  { label: "Wild", value: 1.3, tone: "High variance. Experimental output." },
];

export { DEFAULT_TEMP, MIN_TEMP, MAX_TEMP };
