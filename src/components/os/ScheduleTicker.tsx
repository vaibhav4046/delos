"use client";
// F02 · OS-root client interval. POSTs /api/schedule/tick every 45s so
// scheduled actions fire even when no app window is open. Singleton-guarded
// so HMR doesn't double-install.
import { useEffect } from "react";

export function ScheduleTicker() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const G = window as unknown as { __delos_schedule_ticker?: boolean };
    if (G.__delos_schedule_ticker) return;
    G.__delos_schedule_ticker = true;
    const tick = () => fetch("/api/schedule/tick", { method: "POST" }).catch(() => {});
    tick();
    const iv = setInterval(tick, 45_000);
    const onVis = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
      G.__delos_schedule_ticker = false;
    };
  }, []);
  return null;
}
