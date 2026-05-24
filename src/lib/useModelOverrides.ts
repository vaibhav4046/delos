"use client";
import { useEffect, useState } from "react";
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

export function useModelOverrides(): [ModelOverrides, (next: ModelOverrides) => void] {
  const [v, setV] = useState<ModelOverrides>({});
  useEffect(() => {
    setV(read());
    function onChange() {
      setV(read());
    }
    window.addEventListener("delos-models-changed", onChange);
    return () => window.removeEventListener("delos-models-changed", onChange);
  }, []);
  function update(next: ModelOverrides) {
    write(next);
    setV(next);
  }
  return [v, update];
}
