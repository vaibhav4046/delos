"use client";
// Notification store · single source of truth for the OS notif center +
// dock badge + system tray. Hooks the existing `toast` custom event so
// every toast in the OS lands as a persistent notification with read state.
//
// Storage: in-memory + localStorage mirror so notifications survive a refresh.
// Cap: 100 most-recent items per tenant. Older entries evicted LRU.

import { useEffect, useSyncExternalStore } from "react";

export type NotifTone = "ok" | "info" | "warn" | "bad" | "system";

export type Notif = {
  id: string;
  text: string;
  tone: NotifTone;
  at: number;
  read: boolean;
  source?: string;       // e.g. "schedule", "agent", "system"
  actionLabel?: string;
  actionUrl?: string;
  actionAppId?: string;  // open this app on click
};

const STORAGE_KEY = "delos.notifs.v1";
const MAX = 100;

type Listener = () => void;

class NotifStore {
  private items: Notif[] = [];
  private listeners = new Set<Listener>();

  constructor() {
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) this.items = JSON.parse(raw) as Notif[];
      } catch {}
    }
  }

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = () => this.items;
  // SSR snapshot must be referentially stable so React 19 doesn't bail on
  // an "infinite render" warning. Same empty array reused.
  private readonly emptySnap: Notif[] = [];
  getServerSnapshot = () => this.emptySnap;

  private persist() {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items));
    } catch {}
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  push(input: Omit<Notif, "id" | "at" | "read">) {
    const n: Notif = {
      ...input,
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: Date.now(),
      read: false,
    };
    this.items = [n, ...this.items].slice(0, MAX);
    this.persist();
    this.emit();
    return n.id;
  }

  markRead(id: string) {
    this.items = this.items.map((n) => (n.id === id ? { ...n, read: true } : n));
    this.persist();
    this.emit();
  }

  markAllRead() {
    this.items = this.items.map((n) => ({ ...n, read: true }));
    this.persist();
    this.emit();
  }

  remove(id: string) {
    this.items = this.items.filter((n) => n.id !== id);
    this.persist();
    this.emit();
  }

  clear() {
    this.items = [];
    this.persist();
    this.emit();
  }

  unreadCount() {
    return this.items.filter((n) => !n.read).length;
  }
}

const G = globalThis as unknown as { __delos_notifs?: NotifStore };
G.__delos_notifs ??= new NotifStore();
export const notifStore = G.__delos_notifs;

export function useNotifs(): Notif[] {
  return useSyncExternalStore(
    notifStore.subscribe,
    notifStore.getSnapshot,
    notifStore.getServerSnapshot,
  );
}

export function useUnreadCount(): number {
  const items = useNotifs();
  return items.filter((n) => !n.read).length;
}

// Hook the OS-wide `toast` event so every toast also persists as a notif.
// Mount once at the OS root.
export function useNotifBridge() {
  useEffect(() => {
    function onToast(e: Event) {
      const ce = e as CustomEvent<{ text?: string; tone?: NotifTone; source?: string }>;
      if (!ce.detail?.text) return;
      notifStore.push({
        text: ce.detail.text,
        tone: ce.detail.tone ?? "info",
        source: ce.detail.source ?? "toast",
      });
    }
    window.addEventListener("toast", onToast as EventListener);
    return () => window.removeEventListener("toast", onToast as EventListener);
  }, []);
}

// Convenience: programmatic push without going through the toast event.
export function pushNotif(input: Omit<Notif, "id" | "at" | "read">) {
  notifStore.push(input);
}
