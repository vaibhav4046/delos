"use client";
// In-OS Memory Browser window. Thin wrapper around the shared
// MemoryDashboard component that reads the current tenant from the
// global helper so the window stays in sync with the rest of DelOS.

import { useEffect, useState } from "react";
import { MemoryDashboard } from "@/components/memory/MemoryDashboard";

// `getTenantId` lives in systemApps and is set at OS boot. We read it
// after mount to avoid SSR hydration mismatch.
// R11b · default to `delrio_demo` so guest mode never sees an empty
// dashboard. Server-side autoSeedIfEmpty fires for guest-prefixed tenants
// and the EmptyState's useEffect-seed branch will hit before the user
// even notices the initial render.
function readTenant(): string {
  if (typeof window === "undefined") return "delrio_demo";
  try {
    const G = window as unknown as { __delos_tenant?: string };
    if (G.__delos_tenant) return G.__delos_tenant;
    const raw = window.localStorage.getItem("delos.tenant");
    if (raw) return raw;
  } catch {}
  return "delrio_demo";
}

export function MemoryBrowserApp() {
  // Set the default tenant SYNCHRONOUSLY (not after mount) so the
  // dashboard's first load() fires against `delrio_demo`, triggering
  // server-side auto-seed + populating local on the first paint. Was:
  // null on first render then setTenant() in useEffect, which produced
  // a 0/0 flash before the second render kicked in.
  const [tenant, setTenant] = useState<string>(() => {
    if (typeof window === "undefined") return "delrio_demo";
    return readTenant();
  });
  useEffect(() => {
    // Re-sync after mount in case __delos_tenant was set between SSR and
    // the first effect tick (e.g. boot script populated it just after
    // hydration). Cheap idempotent · falls back to the same default.
    setTenant(readTenant());
  }, []);
  return (
    <div style={{ height: "100%", overflow: "auto", background: "var(--surface)" }}>
      <MemoryDashboard tenant={tenant} compact autoRefreshMs={8000} defaultQuery="" />
    </div>
  );
}
