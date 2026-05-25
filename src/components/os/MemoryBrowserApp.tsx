"use client";
// In-OS Memory Browser window. Thin wrapper around the shared
// MemoryDashboard component that reads the current tenant from the
// global helper so the window stays in sync with the rest of DelOS.

import { useEffect, useState } from "react";
import { MemoryDashboard } from "@/components/memory/MemoryDashboard";

// `getTenantId` lives in systemApps and is set at OS boot. We read it
// after mount to avoid SSR hydration mismatch.
function readTenant(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const G = window as unknown as { __delos_tenant?: string };
    if (G.__delos_tenant) return G.__delos_tenant;
    const raw = window.localStorage.getItem("delos.tenant");
    if (raw) return raw;
  } catch {}
  return null;
}

export function MemoryBrowserApp() {
  const [tenant, setTenant] = useState<string | null>(null);
  useEffect(() => {
    setTenant(readTenant());
  }, []);
  return (
    <div style={{ height: "100%", overflow: "auto", background: "var(--surface)" }}>
      <MemoryDashboard tenant={tenant} compact autoRefreshMs={8000} defaultQuery="" />
    </div>
  );
}
