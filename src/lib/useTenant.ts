"use client";
import { useSyncExternalStore } from "react";

const STORE_KEY = "delos.tenantId.v1";

export function getTenantId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return localStorage.getItem(STORE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

// Used by OnboardingPortal + /api/me bootstrap to lock the signed-in user's
// per-tenant scope into localStorage on first load.
export function setTenantId(next: string) {
  if (typeof window === "undefined") return;
  try {
    if (next.trim()) localStorage.setItem(STORE_KEY, next.trim());
    else localStorage.removeItem(STORE_KEY);
    window.dispatchEvent(new CustomEvent("delos-tenant-changed", { detail: { tenantId: next.trim() } }));
  } catch {}
}

// Sync across windows · changing tenant in Settings must propagate to an
// open Cowork / Memory window. Module-level so the subscription is stable.
function subscribe(cb: () => void) {
  window.addEventListener("delos-tenant-changed", cb);
  return () => window.removeEventListener("delos-tenant-changed", cb);
}

export function useTenantId(): [string, (next: string) => void] {
  // Setter routes through setTenantId so the change is persisted AND
  // broadcast; the subscribe listener re-reads the snapshot on dispatch.
  const v = useSyncExternalStore(subscribe, () => getTenantId() ?? "", () => "");
  return [v, setTenantId];
}
