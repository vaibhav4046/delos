"use client";
import type { RunEvent } from "./types";

export type Achievement = { id: string; label: string; icon?: string };

const ACHIEVEMENTS: Record<string, Achievement> = {
  first_run: { id: "first_run", label: "First Mission", icon: "Trophy" },
  first_app: { id: "first_app", label: "First App Built", icon: "Sparkles" },
  recovered: { id: "recovered", label: "1-UP — Recovered from Chaos", icon: "ShieldCheck" },
  warped: { id: "warped", label: "Warp Zone Reached", icon: "Zap" },
  subagent: { id: "subagent", label: "Sub-agent Spawned", icon: "GitBranch" },
  ten_tools: { id: "ten_tools", label: "10 Tool Calls Across Runs", icon: "Wrench" },
  hundred_tokens: { id: "hundred_tokens", label: "1k Tokens Streamed", icon: "Coins" },
};

const STORE_KEY = "delos.achievements.v1";
const COUNT_KEY = "delos.counters.v1";

function load(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try { return new Set(JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]")); } catch { return new Set(); }
}
function save(s: Set<string>) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(STORE_KEY, JSON.stringify([...s])); } catch {}
}
function loadCounters(): { tools: number; tokens: number } {
  if (typeof window === "undefined") return { tools: 0, tokens: 0 };
  try { return JSON.parse(localStorage.getItem(COUNT_KEY) ?? '{"tools":0,"tokens":0}'); } catch { return { tools: 0, tokens: 0 }; }
}
function saveCounters(c: { tools: number; tokens: number }) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(COUNT_KEY, JSON.stringify(c)); } catch {}
}

export function processEventsForAchievements(events: RunEvent[]): Achievement[] {
  const got = load();
  const fresh: Achievement[] = [];
  const counters = loadCounters();
  function award(id: keyof typeof ACHIEVEMENTS) {
    if (got.has(id)) return;
    got.add(id);
    fresh.push(ACHIEVEMENTS[id]);
  }
  let toolCount = 0;
  let tokenCount = 0;
  let hadAnswer = false;
  for (const e of events) {
    if (e.t === "tool_call") toolCount += 1;
    if (e.t === "recover") award("recovered");
    if (e.t === "adapt") award("warped");
    if (e.t === "subagent" && e.status === "done") award("subagent");
    if (e.t === "usage") tokenCount += e.promptTokens + e.completionTokens;
    if (e.t === "answer") hadAnswer = true;
  }
  if (hadAnswer) award("first_run");
  counters.tools += toolCount;
  counters.tokens += tokenCount;
  if (counters.tools >= 10) award("ten_tools");
  if (counters.tokens >= 1000) award("hundred_tokens");
  saveCounters(counters);
  if (fresh.length) save(got);
  return fresh;
}

export function awardAppBuilt() {
  const got = load();
  if (got.has("first_app")) return null;
  got.add("first_app");
  save(got);
  return ACHIEVEMENTS.first_app;
}
