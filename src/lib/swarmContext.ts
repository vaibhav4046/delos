// Swarm Context Engine
// ─────────────────────
// A recursive, token-bounded shared context window that spans chat message
// threads AND the agent swarm (orchestrator runs + their sub-agents).
//
// The core idea: every "place where thinking happens" — a chat thread, an
// orchestrator run, a spawned sub-agent — owns a CONTEXT FRAME. Frames form a
// tree (a sub-agent's frame points at its parent run's frame; a run launched
// from a chat points at that thread's frame). When any agent needs context it
// calls collectContext(), which walks UP the parent chain ("recursive"), folds
// distant ancestors into compact summaries ("and beyond"), merges in semantic
// memory recall, and returns a ranked list trimmed to a token budget.
//
// This file is server-side and dependency-light (only hydra for memory). It
// keeps state in a globalThis singleton so it survives across requests inside a
// warm Lambda, exactly like hydra's local fallback — and is capped the same way
// so a long-lived instance can't grow without bound.

import { safeRecall, safeAddMemory } from "./hydra";

export type ContextSource =
  | "user"
  | "assistant"
  | "agent"
  | "subagent"
  | "tool"
  | "memory"
  | "system";

export type ContextItem = {
  id: string;
  source: ContextSource;
  text: string;
  threadId?: string;
  at: number;
  depth: number; // recursion depth of the frame that owns this item (0 = root)
  tokensEst: number;
  pinned?: boolean; // user-facts / explicit pins survive trimming
};

export type SwarmFrame = {
  id: string;
  tenantId: string;
  parentId?: string;
  threadId?: string;
  kind: "thread" | "run" | "subagent";
  label: string;
  depth: number;
  items: ContextItem[];
  children: string[];
  createdAt: number;
  updatedAt: number;
  // Compact, deterministic summary of items that have aged out of `items`.
  // This is the "and beyond" fold — distant context is preserved as a short
  // string instead of being dropped, so the parent chain stays cheap to walk.
  summary?: string;
  summarizedCount: number;
};

// ── tuning knobs ────────────────────────────────────────────────────────────
const CHARS_PER_TOKEN = 4; // rough heuristic, good enough for budgeting
const MAX_ITEMS_PER_FRAME = 40; // beyond this, oldest items fold into summary
const SUMMARY_KEEP_RECENT = 24; // how many recent items to keep verbatim on fold
const MAX_FRAMES_PER_TENANT = 80; // cap the tree; oldest non-pinned frames drop
const MAX_SUMMARY_CHARS = 1200; // cap the folded-summary string per frame
const DEFAULT_TOKEN_BUDGET = 1400; // default ceiling for a collected window
const DEFAULT_MAX_DEPTH = 6; // how many ancestors to climb ("recursive")
const ITEM_TEXT_CAP = 2000; // truncate any single item to keep one turn sane

export function estTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

function firstWords(text: string, n: number): string {
  const w = text.trim().replace(/\s+/g, " ").split(" ");
  return w.length <= n ? w.join(" ") : w.slice(0, n).join(" ") + "…";
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── store (globalThis singleton, like hydra's localFallback) ──────────────────
type Store = {
  frames: Map<string, SwarmFrame>;
  byThread: Map<string, string>; // `${tenantId}::${threadId}` → frameId
};

const G = globalThis as unknown as { __delosSwarmCtx?: Store };
function getStore(): Store {
  if (!G.__delosSwarmCtx) {
    G.__delosSwarmCtx = { frames: new Map(), byThread: new Map() };
  }
  return G.__delosSwarmCtx;
}

function threadKey(tenantId: string, threadId: string): string {
  return `${tenantId}::${threadId}`;
}

// Drop oldest frames (and their thread index entries) for a tenant once the cap
// is exceeded. Frames whose newest item is pinned are kept preferentially.
function pruneTenant(tenantId: string): void {
  const store = getStore();
  const mine = [...store.frames.values()].filter((f) => f.tenantId === tenantId);
  if (mine.length <= MAX_FRAMES_PER_TENANT) return;
  const hasPin = (f: SwarmFrame) => f.items.some((i) => i.pinned);
  mine.sort((a, b) => {
    // pinned frames last (kept); otherwise oldest-updated first (dropped)
    if (hasPin(a) !== hasPin(b)) return hasPin(a) ? 1 : -1;
    return a.updatedAt - b.updatedAt;
  });
  const dropCount = mine.length - MAX_FRAMES_PER_TENANT;
  for (let i = 0; i < dropCount; i++) {
    const f = mine[i];
    store.frames.delete(f.id);
    if (f.threadId) store.byThread.delete(threadKey(tenantId, f.threadId));
    // unlink from parent's children list
    if (f.parentId) {
      const p = store.frames.get(f.parentId);
      if (p) p.children = p.children.filter((c) => c !== f.id);
    }
  }
}

// ── frame lifecycle ───────────────────────────────────────────────────────────
export function createFrame(args: {
  tenantId: string;
  kind: SwarmFrame["kind"];
  label: string;
  parentId?: string;
  threadId?: string;
}): SwarmFrame {
  const store = getStore();
  const parent = args.parentId ? store.frames.get(args.parentId) : undefined;
  const depth = parent ? parent.depth + 1 : 0;
  const frame: SwarmFrame = {
    id: uid(args.kind),
    tenantId: args.tenantId,
    parentId: parent?.id,
    threadId: args.threadId,
    kind: args.kind,
    label: args.label.slice(0, 120),
    depth,
    items: [],
    children: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    summarizedCount: 0,
  };
  store.frames.set(frame.id, frame);
  if (parent) parent.children.push(frame.id);
  if (args.threadId) store.byThread.set(threadKey(args.tenantId, args.threadId), frame.id);
  pruneTenant(args.tenantId);
  return frame;
}

export function getFrame(id: string): SwarmFrame | undefined {
  return getStore().frames.get(id);
}

// Get (or lazily create) the frame backing a chat thread.
export function frameForThread(args: {
  tenantId: string;
  threadId: string;
  label?: string;
}): SwarmFrame {
  const store = getStore();
  const existing = store.byThread.get(threadKey(args.tenantId, args.threadId));
  if (existing) {
    const f = store.frames.get(existing);
    if (f) return f;
  }
  return createFrame({
    tenantId: args.tenantId,
    kind: "thread",
    label: args.label ?? `thread ${args.threadId.slice(0, 8)}`,
    threadId: args.threadId,
  });
}

// Fold the oldest items of a frame into its summary string ("and beyond").
function foldFrame(frame: SwarmFrame): void {
  if (frame.items.length <= MAX_ITEMS_PER_FRAME) return;
  const overflow = frame.items.length - SUMMARY_KEEP_RECENT;
  if (overflow <= 0) return;
  const aged = frame.items.slice(0, overflow);
  // Never fold a pinned item away — pull pins back into the kept window.
  const pins = aged.filter((i) => i.pinned);
  const foldable = aged.filter((i) => !i.pinned);
  const piece = foldable
    .map((i) => `${i.source[0]}:${firstWords(i.text, 14)}`)
    .join(" · ");
  const merged = [frame.summary, piece].filter(Boolean).join(" · ");
  frame.summary = merged.length > MAX_SUMMARY_CHARS ? "…" + merged.slice(-MAX_SUMMARY_CHARS) : merged;
  frame.summarizedCount += foldable.length;
  frame.items = [...pins, ...frame.items.slice(overflow)];
}

export function addItem(
  frameId: string,
  item: { source: ContextSource; text: string; threadId?: string; pinned?: boolean },
): ContextItem | null {
  const frame = getStore().frames.get(frameId);
  if (!frame) return null;
  const text = item.text.slice(0, ITEM_TEXT_CAP);
  const ci: ContextItem = {
    id: uid("ci"),
    source: item.source,
    text,
    threadId: item.threadId ?? frame.threadId,
    at: Date.now(),
    depth: frame.depth,
    tokensEst: estTokens(text),
    pinned: item.pinned,
  };
  frame.items.push(ci);
  frame.updatedAt = ci.at;
  foldFrame(frame);
  return ci;
}

// ── recursive context collection ──────────────────────────────────────────────
export type CollectedContext = {
  items: ContextItem[];
  hints: string[];
  tokensUsed: number;
  depthReached: number;
  memoryHits: number;
  frameId?: string;
};

export type CollectOptions = {
  query?: string; // drives semantic memory recall + ranking
  tokenBudget?: number;
  maxDepth?: number;
  includeMemory?: boolean;
};

// Walk from `frameId` up the parent chain, gathering each frame's recent items
// (and its folded summary for distant ancestors), merge in semantic memory
// recall for `query`, then trim to the token budget by priority. This is the
// recursive context window handed to every agent.
export async function collectContext(
  args: { frameId?: string; tenantId: string } & CollectOptions,
): Promise<CollectedContext> {
  const store = getStore();
  const budget = args.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
  const maxDepth = args.maxDepth ?? DEFAULT_MAX_DEPTH;
  const includeMemory = args.includeMemory ?? true;

  // Tiered candidate pool. Lower tier = higher priority (kept first).
  type Cand = { item: ContextItem; tier: number };
  const cands: Cand[] = [];
  let depthReached = 0;

  let cur = args.frameId ? store.frames.get(args.frameId) : undefined;
  let climb = 0;
  while (cur && climb <= maxDepth) {
    depthReached = Math.max(depthReached, climb);
    // recent items of this frame; nearer frames (smaller climb) rank higher
    const recent = cur.items.slice(-(climb === 0 ? 14 : 6));
    for (const it of recent) {
      cands.push({ item: it, tier: it.pinned ? 0 : 1 + climb });
    }
    // distant-ancestor fold → one synthetic summary item
    if (climb > 0 && cur.summary) {
      cands.push({
        item: {
          id: `sum-${cur.id}`,
          source: "system",
          text: `[${cur.kind} «${cur.label}» earlier] ${cur.summary}`,
          at: cur.createdAt,
          depth: cur.depth,
          tokensEst: estTokens(cur.summary),
        },
        tier: 2 + climb,
      });
    }
    cur = cur.parentId ? store.frames.get(cur.parentId) : undefined;
    climb++;
  }

  // Semantic memory recall (cross-thread, cross-run long-term memory).
  let memoryHits = 0;
  if (includeMemory && args.query && args.query.trim().length > 1) {
    const hits = await safeRecall({ tenantId: args.tenantId, query: args.query, topK: 5 });
    memoryHits = hits.length;
    hits.forEach((h, idx) => {
      const text = h.text.slice(0, ITEM_TEXT_CAP);
      cands.push({
        item: {
          id: `mem-${idx}`,
          source: "memory",
          text,
          at: Date.now(),
          depth: 0,
          tokensEst: estTokens(text),
        },
        // interleave memory just behind the current frame's own items
        tier: 1,
      });
    });
  }

  // De-dupe by trimmed text (memory recall often echoes a stored turn).
  const seen = new Set<string>();
  const ranked = cands
    .filter((c) => {
      const key = c.item.text.trim().slice(0, 160).toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.tier - b.tier) || (b.item.at - a.item.at));

  // Fill to budget.
  const picked: ContextItem[] = [];
  let tokensUsed = 0;
  for (const c of ranked) {
    if (tokensUsed + c.item.tokensEst > budget && picked.length > 0) continue;
    picked.push(c.item);
    tokensUsed += c.item.tokensEst;
    if (tokensUsed >= budget) break;
  }

  return {
    items: picked,
    hints: renderContextHints(picked),
    tokensUsed,
    depthReached,
    memoryHits,
    frameId: args.frameId,
  };
}

const SOURCE_LABEL: Record<ContextSource, string> = {
  user: "User said",
  assistant: "Assistant replied",
  agent: "Agent noted",
  subagent: "Sub-agent noted",
  tool: "Tool result",
  memory: "Memory",
  system: "Context",
};

// Format collected items as prompt-injectable lines. Single-line each (callers
// drop these straight into a system/context block).
export function renderContextHints(items: ContextItem[]): string[] {
  return items.map((i) => {
    const label = SOURCE_LABEL[i.source] ?? "Context";
    const oneLine = i.text.replace(/\s+/g, " ").trim();
    return `${label}: ${oneLine}`;
  });
}

// ── thread → memory bridge (used by /api/context/thread) ──────────────────────
// Persist a single conversation turn: append it to the thread's frame AND write
// it to long-term memory (tagged with the thread), then return the recursive
// context window the caller should inject next.
export async function persistTurn(args: {
  tenantId: string;
  threadId: string;
  role: "user" | "assistant";
  text: string;
  mode?: string;
  label?: string;
  pinned?: boolean;
}): Promise<{ frameId: string; context: CollectedContext }> {
  const frame = frameForThread({
    tenantId: args.tenantId,
    threadId: args.threadId,
    label: args.label,
  });
  addItem(frame.id, {
    source: args.role === "user" ? "user" : "assistant",
    text: args.text,
    threadId: args.threadId,
    pinned: args.pinned,
  });

  // Long-term memory write — only persist substantive turns to avoid flooding
  // the store with "ok"/"thanks". User turns and longer assistant turns count.
  const worthStoring = args.role === "user" ? args.text.trim().length >= 4 : args.text.trim().length >= 40;
  if (worthStoring) {
    const tags = ["thread", `thread:${args.threadId}`, args.role];
    if (args.pinned) tags.push("pinned");
    if (args.mode) tags.push(`mode:${args.mode}`);
    await safeAddMemory({
      tenantId: args.tenantId,
      text: `[${args.role}] ${args.text.slice(0, ITEM_TEXT_CAP)}`,
      metadata: { tags, threadId: args.threadId, source: "swarm-thread", at: Date.now() },
    });
  }

  // Recall is keyed on the user's latest message (assistant turns reuse it).
  const context = await collectContext({
    frameId: frame.id,
    tenantId: args.tenantId,
    query: args.text,
    includeMemory: args.role === "user",
  });
  return { frameId: frame.id, context };
}

// ── inspector snapshot (used by /api/context/state + Inspector UI) ────────────
export type FrameSnapshot = {
  id: string;
  parentId?: string;
  kind: SwarmFrame["kind"];
  label: string;
  depth: number;
  threadId?: string;
  itemCount: number;
  summarizedCount: number;
  tokens: number;
  updatedAt: number;
  childIds: string[];
  recent: Array<{ source: ContextSource; text: string; at: number; pinned?: boolean }>;
};

export type SwarmSnapshot = {
  tenantId: string;
  frames: FrameSnapshot[];
  totals: { frames: number; items: number; tokens: number; maxDepth: number };
  tokenBudget: number;
  at: number;
};

export function snapshotState(tenantId: string, opts?: { recentPerFrame?: number }): SwarmSnapshot {
  const store = getStore();
  const recentN = opts?.recentPerFrame ?? 6;
  const mine = [...store.frames.values()].filter((f) => f.tenantId === tenantId);
  let items = 0;
  let tokens = 0;
  let maxDepth = 0;
  const frames: FrameSnapshot[] = mine
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((f) => {
      const ft = f.items.reduce((s, i) => s + i.tokensEst, 0);
      items += f.items.length + f.summarizedCount;
      tokens += ft;
      maxDepth = Math.max(maxDepth, f.depth);
      return {
        id: f.id,
        parentId: f.parentId,
        kind: f.kind,
        label: f.label,
        depth: f.depth,
        threadId: f.threadId,
        itemCount: f.items.length + f.summarizedCount,
        summarizedCount: f.summarizedCount,
        tokens: ft,
        updatedAt: f.updatedAt,
        childIds: f.children.slice(),
        recent: f.items.slice(-recentN).map((i) => ({
          source: i.source,
          text: firstWords(i.text, 26),
          at: i.at,
          pinned: i.pinned,
        })),
      };
    });
  return {
    tenantId,
    frames,
    totals: { frames: frames.length, items, tokens, maxDepth },
    tokenBudget: DEFAULT_TOKEN_BUDGET,
    at: Date.now(),
  };
}

// Clear all frames for a tenant (used by Inspector "reset" + tests).
export function clearTenantContext(tenantId: string): number {
  const store = getStore();
  let n = 0;
  for (const [id, f] of store.frames.entries()) {
    if (f.tenantId === tenantId) {
      store.frames.delete(id);
      if (f.threadId) store.byThread.delete(threadKey(tenantId, f.threadId));
      n++;
    }
  }
  return n;
}

export const SWARM_CONTEXT_DEFAULTS = {
  tokenBudget: DEFAULT_TOKEN_BUDGET,
  maxDepth: DEFAULT_MAX_DEPTH,
  maxFramesPerTenant: MAX_FRAMES_PER_TENANT,
  maxItemsPerFrame: MAX_ITEMS_PER_FRAME,
};
