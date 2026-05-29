"use client";
import { useSyncExternalStore } from "react";
import type { ModelKey } from "@/lib/llm.catalog";

export type ModelOverrides = Partial<Record<"planner" | "executor" | "critic", ModelKey>>;

const STORE_KEY = "delos.modelOverrides.v1";

function read(): ModelOverrides {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as ModelOverrides) : {};
  } catch {
    return {};
  }
}

function write(v: ModelOverrides) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(v));
    window.dispatchEvent(new CustomEvent("delos-models-changed"));
  } catch {}
}

export function getModelOverrides(): ModelOverrides {
  return read();
}

// Cache the parsed snapshot keyed on the raw localStorage string so
// useSyncExternalStore sees a stable reference until the value actually
// changes — returning a fresh object every call would infinite-loop.
const EMPTY: ModelOverrides = {};
let cachedRaw: string | null = null;
let cachedValue: ModelOverrides = EMPTY;

function getSnapshot(): ModelOverrides {
  if (typeof window === "undefined") return EMPTY;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORE_KEY);
  } catch {
    return EMPTY;
  }
  if (raw === cachedRaw) return cachedValue;
  cachedRaw = raw;
  try {
    cachedValue = raw ? (JSON.parse(raw) as ModelOverrides) : EMPTY;
  } catch {
    cachedValue = EMPTY;
  }
  return cachedValue;
}

function subscribe(cb: () => void) {
  window.addEventListener("delos-models-changed", cb);
  return () => window.removeEventListener("delos-models-changed", cb);
}

export function useModelOverrides(): [ModelOverrides, (next: ModelOverrides) => void] {
  const v = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
  return [v, write];
}
