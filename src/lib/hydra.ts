import { HydraDBClient } from "@hydradb/sdk";
import { env } from "./env";
import type { StoredMemory } from "./types";

const client = new HydraDBClient({ token: env.HYDRA_DB_API_KEY });

const G = globalThis as unknown as {
  __delrioLocalMem?: StoredMemory[];
  __delrioTenantsReady?: Set<string>;
  __delrioTenantsRequested?: Set<string>;
};
G.__delrioLocalMem ??= [];
G.__delrioTenantsReady ??= new Set();
G.__delrioTenantsRequested ??= new Set();
const localFallback: StoredMemory[] = G.__delrioLocalMem;
const tenantsReady = G.__delrioTenantsReady;
const tenantsRequested = G.__delrioTenantsRequested;

// Cap the in-process mirror so a long-lived warm Lambda with heavy write
// traffic can't grow it without bound (it persists on globalThis across
// requests). Oldest entries drop first; durable rows still live in HydraDB.
const LOCAL_FALLBACK_MAX = 5000;

// Guests + unauthenticated callers legitimately hit HydraDB 401 on every
// recall/write and fall back to local — that's by design, not an incident, so
// we don't spam the server log with it. Real outages (5xx, network, timeout)
// still get logged.
function isExpectedAuthError(msg: string): boolean {
  return /\b401\b|unauthorized/i.test(msg);
}

export async function ensureTenant(tenantId: string) {
  if (tenantsReady.has(tenantId)) return;
  if (tenantsRequested.has(tenantId)) return;
  tenantsRequested.add(tenantId);
  try {
    await client.tenant.create({ tenant_id: tenantId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/exist|already|409|422/i.test(msg)) {
      console.warn("[hydra] tenant create:", msg);
    }
  }
}

async function withRetry<T>(fn: () => Promise<T>, opts: { tries: number; baseMs: number }): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < opts.tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      // Word-boundary the status codes so a request id / count that merely
      // contains "429" or "503" (e.g. "req 50312…") isn't misread as transient
      // and retried — the write path (addMemory, tries:6) isn't idempotent, so
      // spurious retries risk a double-write.
      const transient = /TENANT_NOT_FOUND|provisioned|\b(?:429|503)\b|temporar|timeout|ECONNRESET/i.test(msg);
      if (!transient || i === opts.tries - 1) throw e;
      const delay = opts.baseMs * Math.pow(2, i) + Math.random() * 300;
      await new Promise((r) => setTimeout(r, Math.min(delay, 6000)));
    }
  }
  throw lastErr;
}

export async function addMemory(args: {
  tenantId: string;
  subTenantId?: string;
  text: string;
  metadata?: Record<string, unknown>;
}) {
  await withRetry(
    () =>
      client.upload.addMemory({
        tenant_id: args.tenantId,
        sub_tenant_id: args.subTenantId,
        memories: [{ text: args.text, infer: true, metadata: args.metadata ?? {} }],
      }),
    { tries: 6, baseMs: 1500 },
  );
  tenantsReady.add(args.tenantId);
}

type RecallHit = { text: string; score: number };

export async function recall(args: {
  tenantId: string;
  subTenantId?: string;
  query: string;
  topK?: number;
  mode?: "thinking" | "fast";
}): Promise<RecallHit[]> {
  const res = await client.recall.fullRecall({
    tenant_id: args.tenantId,
    sub_tenant_id: args.subTenantId,
    query: args.query,
    max_results: args.topK ?? 5,
    mode: args.mode ?? "fast",
  });
  const r = res as unknown as {
    results?: Array<{ text?: string; content?: string; score?: number; relevance?: number }>;
    sources?: Array<{ text?: string; content?: string; score?: number }>;
    memories?: Array<{ text?: string; content?: string; score?: number }>;
  };
  const arr = r.results ?? r.sources ?? r.memories ?? [];
  return arr.map((x) => ({
    text: x.text ?? x.content ?? "",
    score: x.score ?? (x as { relevance?: number }).relevance ?? 0,
  }));
}

export async function safeAddMemory(args: Parameters<typeof addMemory>[0]) {
  try {
    await addMemory(args);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!isExpectedAuthError(msg)) console.warn("[hydra] addMemory failed after retries:", msg);
  }
  localFallback.push({
    id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    runId: (args.metadata?.runId as string) ?? "unknown",
    tenantId: args.tenantId,
    text: args.text,
    tags: (args.metadata?.tags as string[]) ?? [],
    createdAt: Date.now(),
  });
  // Cap the in-process mirror so a warm Lambda can't grow it unbounded.
  if (localFallback.length > LOCAL_FALLBACK_MAX) {
    localFallback.splice(0, localFallback.length - LOCAL_FALLBACK_MAX);
  }
}

export async function safeRecall(args: Parameters<typeof recall>[0]): Promise<RecallHit[]> {
  try {
    const hits = await recall(args);
    if (hits.length > 0) return hits;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!isExpectedAuthError(msg)) console.warn("[hydra] recall failed, using local fallback:", msg);
  }
  // Local fallback — fuzzy word-overlap scoring against query
  const stop = new Set(["the", "a", "an", "and", "or", "for", "of", "in", "on", "to", "is", "are", "be", "what", "why", "how", "do", "does", "i", "me", "my", "you", "your", "with"]);
  const qWords = args.query
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w));
  const tenantMemories = localFallback.filter((m) => m.tenantId === args.tenantId);
  const scored = tenantMemories.map((m) => {
    const text = m.text.toLowerCase();
    let score = 0;
    for (const w of qWords) {
      if (text.includes(w)) score += 1;
    }
    // Length-normalize so very long texts don't dominate
    const norm = qWords.length > 0 ? score / qWords.length : 0;
    // Pinned exact-fact rows (memory_pin tool) boost 1.6x so they
    // outrank run-summary chatter when both match. Without this,
    // recall returned "Run completed for goal X" before the actual
    // "user_name = Varun" fact the user pinned — 2026-05-25 P0.
    const isPinned = m.tags.includes("pinned") || m.tags.includes("user-fact");
    return { mem: m, score: isPinned ? norm * 1.6 + 0.15 : norm };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored
    .filter((s) => s.score > 0)
    .slice(0, args.topK ?? 5)
    .map((s) => ({ text: s.mem.text, score: Math.min(1, 0.4 + s.score * 0.6) }));
}

export function getLocalFallback(tenantId?: string): StoredMemory[] {
  return tenantId ? localFallback.filter((m) => m.tenantId === tenantId) : [...localFallback];
}

// M4 · delete a single local-fallback memory by id, scoped to tenant so
// one tenant cannot remove another's memories. Returns true if removed.
export function deleteLocalMemory(args: { tenantId: string; id: string }): boolean {
  const idx = localFallback.findIndex(
    (m) => m.id === args.id && m.tenantId === args.tenantId,
  );
  if (idx === -1) return false;
  localFallback.splice(idx, 1);
  return true;
}

// M4 · clear all memories for a tenant (e.g. demo reset). Returns count.
export function clearLocalMemories(tenantId: string): number {
  let removed = 0;
  for (let i = localFallback.length - 1; i >= 0; i--) {
    if (localFallback[i].tenantId === tenantId) {
      localFallback.splice(i, 1);
      removed++;
    }
  }
  return removed;
}
