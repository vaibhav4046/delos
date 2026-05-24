"use client";
import { useEffect, useState } from "react";
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

export function useMcpServers(): [MCPServerConfig[], (next: MCPServerConfig[]) => void] {
  const [v, setV] = useState<MCPServerConfig[]>([]);
  useEffect(() => {
    setV(read());
    function onChange() { setV(read()); }
    window.addEventListener("delos-mcp-changed", onChange);
    return () => window.removeEventListener("delos-mcp-changed", onChange);
  }, []);
  return [v, (next) => { write(next); setV(next); }];
}
