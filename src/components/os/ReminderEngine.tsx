"use client";
// VP-2 · Reminders fire from OS root, not from WidgetsApp. WidgetsApp can
// be closed and reminders must still pop a notification when due. Reads
// the same localStorage key WidgetsApp uses.
import { useEffect } from "react";
import { pushNotif } from "@/lib/notifications";

type Reminder = { id: string; text: string; dueAt: number; done: boolean };
const STORAGE_KEY = "delos.reminders.v1";

export function ReminderEngine() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Singleton guard · prevents double-fire if HMR remounts.
    const G = window as unknown as { __delos_reminder_engine?: boolean };
    if (G.__delos_reminder_engine) return;
    G.__delos_reminder_engine = true;

    function tick() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const list = JSON.parse(raw) as Reminder[];
        const now = Date.now();
        let mutated = false;
        const next = list.map((r) => {
          // Fire when dueAt has passed AND not yet marked done AND not stale (>5min past).
          if (!r.done && r.dueAt <= now && r.dueAt > now - 5 * 60_000) {
            pushNotif({ text: `⏰ ${r.text}`, tone: "warn", source: "reminder" });
            mutated = true;
            return { ...r, done: true };
          }
          return r;
        });
        if (mutated) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore corrupt JSON · WidgetsApp re-saves on next interaction
      }
    }

    tick();
    const iv = setInterval(tick, 20_000);
    const onVis = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVis);
    // Also tick when a new reminder is added (custom event from VoiceApp / WidgetsApp)
    const onAdded = () => tick();
    window.addEventListener("delos-reminder-added", onAdded as EventListener);
    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("delos-reminder-added", onAdded as EventListener);
      G.__delos_reminder_engine = false;
    };
  }, []);
  return null;
}
