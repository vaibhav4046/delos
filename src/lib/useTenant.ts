"use client";
import { useEffect, useState } from "react";

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

export function useTenantId(): [string, (next: string) => void] {
  const [v, setV] = useState("");
  useEffect(() => {
    setV(getTenantId() ?? "");
  }, []);
  return [
    v,
    (next) => {
      const t = next.trim();
      if (typeof window !== "undefined") {
        try {
          if (t) localStorage.setItem(STORE_KEY, t);
          else localStorage.removeItem(STORE_KEY);
        } catch {}
      }
      setV(t);
    },
  ];
}
