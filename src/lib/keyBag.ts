// Per-tenant BYOK provider key store. In-process Map for now (Vercel-Edge
// would need Upstash / KV) — survives a Lambda lifetime, persists via
// HydraDB so cross-Lambda reads work after the first save.
//
// Public surface deliberately never returns the plaintext key. Callers
// learn { hasKey, lastVerified, roles } and the orchestrator gets the
// key just-in-time via getKeyForRole().

import { encryptBag, decryptBag } from "@/lib/cryptoBag";
import { safeAddMemory, safeRecall } from "@/lib/hydra";

export type ProviderId = "groq" | "mistral" | "gemini" | "openai" | "anthropic" | "together" | "openrouter";
export type RoleId = "planner" | "executor" | "critic" | "voice" | "image";

export const PROVIDERS: ProviderId[] = ["groq", "mistral", "gemini", "openai", "anthropic", "together", "openrouter"];
export const ROLES: RoleId[] = ["planner", "executor", "critic", "voice", "image"];

export type KeyBagEntry = {
  provider: ProviderId;
  enc: string;          // encrypted via cryptoBag
  roles: RoleId[];
  savedAt: number;
  lastVerified?: number;
};

type Slot = Record<ProviderId, KeyBagEntry | undefined>;
const MEM: Map<string, Slot> = new Map();

function emptySlot(): Slot {
  return PROVIDERS.reduce((acc, p) => { acc[p] = undefined; return acc; }, {} as Slot);
}

function slot(tenantId: string): Slot {
  let s = MEM.get(tenantId);
  if (!s) { s = emptySlot(); MEM.set(tenantId, s); }
  return s;
}

export async function saveKey(tenantId: string, provider: ProviderId, key: string, roles: RoleId[]): Promise<void> {
  const entry: KeyBagEntry = {
    provider,
    enc: encryptBag(key),
    roles: roles.length ? roles : ["planner", "executor", "critic"],
    savedAt: Date.now(),
  };
  slot(tenantId)[provider] = entry;
  // Best-effort persist a tiny breadcrumb so a different Lambda can warm-
  // cache after a cold start. The encrypted blob is the only "key" data
  // stored. Tag with "keybag" so it doesn't show up in normal recalls.
  try {
    await safeAddMemory({
      tenantId,
      text: `keybag:${provider} saved at ${new Date().toISOString()}`,
      metadata: { tags: ["keybag", `keybag:${provider}`], roles: entry.roles, enc: entry.enc },
    });
  } catch {}
}

export function deleteKey(tenantId: string, provider: ProviderId): void {
  const s = slot(tenantId);
  s[provider] = undefined;
}

export async function statusForTenant(tenantId: string): Promise<Record<ProviderId, { hasKey: boolean; lastVerified: number | null; roles: RoleId[] }>> {
  // Lazy-rehydrate from HydraDB so cross-Lambda reads work.
  const s = slot(tenantId);
  if (PROVIDERS.every((p) => !s[p])) {
    try {
      const hits = await safeRecall({ tenantId, query: "keybag", topK: 16 });
      for (const h of hits as Array<{ text?: string; metadata?: { tags?: string[]; roles?: RoleId[]; enc?: string }; tags?: string[] }>) {
        const tags = h.metadata?.tags ?? h.tags ?? [];
        const tag = tags.find((t) => t.startsWith("keybag:"));
        if (!tag) continue;
        const provider = tag.slice("keybag:".length) as ProviderId;
        if (!PROVIDERS.includes(provider)) continue;
        const enc = h.metadata?.enc;
        if (!enc) continue;
        s[provider] = {
          provider,
          enc,
          roles: h.metadata?.roles ?? ["planner", "executor", "critic"],
          savedAt: 0,
        };
      }
    } catch {}
  }
  return PROVIDERS.reduce((acc, p) => {
    const e = s[p];
    acc[p] = { hasKey: !!e, lastVerified: e?.lastVerified ?? null, roles: e?.roles ?? [] };
    return acc;
  }, {} as Record<ProviderId, { hasKey: boolean; lastVerified: number | null; roles: RoleId[] }>);
}

/** Decrypt and return plaintext for a given role, falling back to platform env. */
export function getKeyForRole(tenantId: string, provider: ProviderId, role: RoleId): string | null {
  const e = slot(tenantId)[provider];
  if (!e || !e.roles.includes(role)) return null;
  try { return decryptBag(e.enc); } catch { return null; }
}

export function markVerified(tenantId: string, provider: ProviderId): void {
  const e = slot(tenantId)[provider];
  if (e) e.lastVerified = Date.now();
}
