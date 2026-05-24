"use client";
import { useEffect, useState } from "react";

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

export function useIdentity(): [Identity, (i: Identity) => void] {
  const [identity, setI] = useState<Identity>(DEFAULT_IDENTITY);
  useEffect(() => {
    setI(getIdentity());
    function onChange(e: Event) {
      const d = (e as CustomEvent).detail as Identity;
      setI(d);
    }
    window.addEventListener("delos-identity-changed", onChange as EventListener);
    return () => window.removeEventListener("delos-identity-changed", onChange as EventListener);
  }, []);
  return [identity, (next) => { setIdentity(next); setI(next); }];
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
