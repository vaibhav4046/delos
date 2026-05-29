"use client";
import { useSyncExternalStore } from "react";
import type { MCPServerConfig } from "@/lib/mcp/types";

const STORE_KEY = "delos.mcpServers.v1";

const DEFAULTS: MCPServerConfig[] = [
  { id: "demo", name: "DelOS Demo MCP", url: "/api/mcp/demo", enabled: true },
];

function read(): MCPServerConfig[] {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return DEFAULTS;
    const v = JSON.parse(raw) as MCPServerConfig[];
    return v.length === 0 ? DEFAULTS : v;
  } catch {
    return DEFAULTS;
  }
}

function write(v: MCPServerConfig[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(v));
    window.dispatchEvent(new CustomEvent("delos-mcp-changed"));
  } catch {}
}

export function getMcpServers(): MCPServerConfig[] {
  return read().map((s) => ({ ...s, url: resolveUrl(s.url) }));
}

function resolveUrl(url: string): string {
  if (typeof window === "undefined") return url;
  if (url.startsWith("/")) return new URL(url, window.location.origin).toString();
  return url;
}

// Cache the parsed snapshot keyed on the raw localStorage string so
// useSyncExternalStore sees a stable reference; returns the RAW config (no
// url resolution) to match the hook's original behavior — getMcpServers()
// stays the resolveUrl path for non-hook callers.
const EMPTY_ARR: MCPServerConfig[] = [];
let cachedRaw: string | null = null;
let cachedValue: MCPServerConfig[] = DEFAULTS;

function getSnapshot(): MCPServerConfig[] {
  if (typeof window === "undefined") return EMPTY_ARR;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORE_KEY);
  } catch {
    return DEFAULTS;
  }
  if (raw === cachedRaw) return cachedValue;
  cachedRaw = raw;
  if (!raw) {
    cachedValue = DEFAULTS;
    return cachedValue;
  }
  try {
    const v = JSON.parse(raw) as MCPServerConfig[];
    cachedValue = v.length === 0 ? DEFAULTS : v;
  } catch {
    cachedValue = DEFAULTS;
  }
  return cachedValue;
}

function subscribe(cb: () => void) {
  window.addEventListener("delos-mcp-changed", cb);
  return () => window.removeEventListener("delos-mcp-changed", cb);
}

export function useMcpServers(): [MCPServerConfig[], (next: MCPServerConfig[]) => void] {
  const v = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_ARR);
  return [v, write];
}
