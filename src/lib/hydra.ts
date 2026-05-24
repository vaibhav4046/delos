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
      const transient = /TENANT_NOT_FOUND|provisioned|503|429|temporar|timeout|ECONNRESET/i.test(msg);
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
    console.warn("[hydra] addMemory failed after retries:", e instanceof Error ? e.message : e);
  }
  localFallback.push({
    id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    runId: (args.metadata?.runId as string) ?? "unknown",
    tenantId: args.tenantId,
    text: args.text,
    tags: (args.metadata?.tags as string[]) ?? [],
    createdAt: Date.now(),
  });
}

export async function safeRecall(args: Parameters<typeof recall>[0]): Promise<RecallHit[]> {
  try {
    const hits = await recall(args);
    if (hits.length > 0) return hits;
  } catch (e) {
    console.warn("[hydra] recall failed, using local fallback:", e instanceof Error ? e.message : e);
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
    return { mem: m, score: norm };
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
