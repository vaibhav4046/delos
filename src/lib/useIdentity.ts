"use client";
import { useSyncExternalStore } from "react";

// JarvisOS-style identity layer. Persisted to localStorage. Prepended to every agent
// prompt so output matches user's tone, role, format. Synced across DelOS surfaces.

export type Identity = {
  user: string;
  role: string;
  tone: string;
  format: string;
  banned: string;
  goals: string;
};

const STORE_KEY = "delos.identity.v1";

const DEFAULT_IDENTITY: Identity = {
  user: "",
  role: "",
  tone: "concise, direct, technical",
  format: "short paragraphs, fenced code blocks, no fluff",
  banned: "",
  goals: "",
};

export function getIdentity(): Identity {
  if (typeof window === "undefined") return DEFAULT_IDENTITY;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return DEFAULT_IDENTITY;
    const parsed = JSON.parse(raw) as Partial<Identity>;
    return { ...DEFAULT_IDENTITY, ...parsed };
  } catch {
    return DEFAULT_IDENTITY;
  }
}

export function setIdentity(i: Identity) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(i));
    window.dispatchEvent(new CustomEvent("delos-identity-changed", { detail: i }));
  } catch {}
}

// Cache the merged snapshot keyed on the raw localStorage string — getIdentity
// builds a fresh {...DEFAULT, ...parsed} object each call, which would
// infinite-loop useSyncExternalStore without a stable reference.
let cachedRaw: string | null = null;
let cachedValue: Identity = DEFAULT_IDENTITY;

function getSnapshot(): Identity {
  if (typeof window === "undefined") return DEFAULT_IDENTITY;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORE_KEY);
  } catch {
    return DEFAULT_IDENTITY;
  }
  if (raw === cachedRaw) return cachedValue;
  cachedRaw = raw;
  if (!raw) {
    cachedValue = DEFAULT_IDENTITY;
    return cachedValue;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Identity>;
    cachedValue = { ...DEFAULT_IDENTITY, ...parsed };
  } catch {
    cachedValue = DEFAULT_IDENTITY;
  }
  return cachedValue;
}

function subscribe(cb: () => void) {
  window.addEventListener("delos-identity-changed", cb);
  return () => window.removeEventListener("delos-identity-changed", cb);
}

export function useIdentity(): [Identity, (i: Identity) => void] {
  const identity = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_IDENTITY);
  return [identity, setIdentity];
}

// Render identity as ~/IDENTITY.md preamble for system prompts.
// Empty fields are skipped. Returns "" if no identity is set, so callers can no-op gracefully.
export function renderIdentityPreamble(i: Identity): string {
  const lines: string[] = [];
  if (i.user) lines.push(`user: ${i.user}`);
  if (i.role) lines.push(`role: ${i.role}`);
  if (i.tone) lines.push(`tone: ${i.tone}`);
  if (i.format) lines.push(`format: ${i.format}`);
  if (i.banned) lines.push(`banned: ${i.banned}`);
  if (i.goals) lines.push(`goals: ${i.goals}`);
  if (lines.length === 0) return "";
  return `~/IDENTITY.md (apply to every output)\n${lines.join("\n")}\n`;
}
