import { NextRequest } from "next/server";
import { safeRecall, getLocalFallback, safeAddMemory, ensureTenant } from "@/lib/hydra";
import { resolveTenant } from "@/lib/apiAuth";
import { recallLocal } from "@/lib/memory/localRecall";

export const runtime = "nodejs";

const G = globalThis as unknown as { __delrioSeededTenants?: Set<string> };
G.__delrioSeededTenants ??= new Set();

const SEED = [
  { text: "Research run — graph databases beat vector databases for AI agent memory because traversal-based recall (run→tool→error→retry→success) preserves causal chains that vectors lose. Cited HydraDB paper + Pinecone vs Neo4j benchmarks. Final: graph wins for agent memory.", tags: ["run-summary", "research", "graph-db", "vector-db", "agent-memory"], goalFamily: "graph DBs vs vector DBs" },
  { text: "Research run 2 — three trustworthy facts about graph DBs and vector DBs for agent memory: 1) Graph traversal beats k-NN for relationship queries 2) Vector DBs win for semantic similarity at scale 3) Hybrid systems (Hydra) merge both. Sources: arxiv, Neo4j docs, Pinecone blog.", tags: ["run-summary", "research", "graph-db", "vector-db"], goalFamily: "graph DBs vs vector DBs" },
  { text: "Chaos survival — tool_flake + context_flood active. web_search timed out twice, cockatiel retry succeeded on attempt 3. Context compressed 8400→2100 tokens at boundary. Critic accepted drift=0.12. Delivered answer in 4.2s with 1 replan.", tags: ["run-summary", "chaos-recovery", "tool-flake"], goalFamily: "research" },
  { text: "Cohort race — gpt-oss-120b vs llama-4-scout vs gemini-2.5-flash on 'graph DBs vs vector DBs'. Judge=mistral-large picked [2] gemini, score 9/10. Merged answer cites all 3 perspectives + reconciles disagreement on similarity scoring.", tags: ["run-summary", "cohort", "graph-db"], goalFamily: "graph DBs vs vector DBs" },
  { text: "Voice command — 'build me a tip calculator using the calc tool'. Whisper transcribed → intent=build_app → AppBuilder spawned, prefilled prompt with calc-tool affordance, ran build. Mounted in 3.8s with 2 spec validations.", tags: ["run-summary", "voice-autonomy", "app-build"], goalFamily: "build tip calculator" },
  { text: "User interrupt — original goal 'find capital of France', mid-run injected 'actually Japan'. Planner re-decomposed, executor re-searched via wiki_search MCP, critic accepted goal-drift. Delivered: Tokyo.", tags: ["run-summary", "adaptation", "interrupt"], goalFamily: "capital lookup" },
  { text: "MCP tool fallback — bundled wiki_search rate-limited mid-run. Sibling fallback registered: hn_top → web_search → dad_joke (excluded by critic as irrelevant). Planner replanned with web_search. Recovered without user intervention.", tags: ["run-summary", "tool-fallback", "recovery"], goalFamily: "research" },
  { text: "App spec — 'Stopwatch v1' compiled from prompt. Components: start/stop/reset buttons, mm:ss display, persisted elapsedMs in tenant state. Re-mountable across sessions via HydraDB graph node.", tags: ["app-spec", "app-build"], goalFamily: "build stopwatch" },
  { text: "Learning — for short factual queries gemini-2.5-flash wins latency (198ms avg). For multi-step reasoning kimi-k2 wins accuracy (8.7/10 critic score). Stored as cohort routing hint. Edge: kimi→gemini fallback when latency >2s.", tags: ["learning", "routing", "cohort"], goalFamily: "routing" },
  { text: "User preference (cross-session) — tenant=delrio_demo prefers concise answers, no markdown headers, inline cites [1][2]. Applied to all chat / research runs. Edge to UI: 'compact-mode' window theme.", tags: ["preference"], goalFamily: "preferences" },
  { text: "OS-builder mission — planner spawned 5 sub-agents in parallel. Each produced an AppSpec via /api/build-app. All 5 specs materialized as DelOS windows live. Counters: 5 agents · 247 requests · 1.8M tokens · $0.034.", tags: ["run-summary", "os-builder", "sub-agents"], goalFamily: "build OS" },
  { text: "Memory recall hit — agent searching 'how did we handle context flood last time' surfaced this very entry via graph traversal. Saved 2 retry cycles. Demonstrates cross-run learning.", tags: ["learning", "recall-meta"], goalFamily: "recall" },
];

async function autoSeedIfEmpty(tenantId: string) {
  // Auto-seed for demo_ AND anon-* tenants on first hit so judges who
  // open /os?guest=1 and click Memory immediately see a recall demo
  // populated. Was demo_-only · anon-ip tenants stayed empty forever
  // (2026-05-25 brutal QA · H2). Authenticated user tenants are still
  // skipped so their personal memories aren't polluted.
  if (!/^demo_/i.test(tenantId) && !/^anon[_-]/i.test(tenantId)) return;
  if (G.__delrioSeededTenants?.has(tenantId)) return;
  G.__delrioSeededTenants?.add(tenantId);
  if (getLocalFallback(tenantId).length > 0) return;
  await ensureTenant(tenantId);
  for (const m of SEED) {
    await safeAddMemory({
      tenantId,
      text: m.text,
      metadata: { tags: m.tags, seeded: true, goalFamily: m.goalFamily },
    });
  }
}

export async function GET(req: NextRequest) {
  // Cap query length at 240 chars · pen-test caught a 5000-char string being
  // echoed back unbounded. Tight cap prevents reflection-amplification + DOS
  // via embedded payloads, and matches HydraDB's effective recall window.
  const rawQ = req.nextUrl.searchParams.get("q") ?? "recent runs";
  const q = rawQ.slice(0, 240);
  // BOLA fix (QA report BUG-1) — tenantId is resolved server-side from the
  // signed session cookie, never from arbitrary query string. Reserved test
  // prefixes (qa_/demo_/test_/judge_/hack_) are honored via ?tenant= so QA
  // reruns can isolate scope without an account. resolveTenant enforces
  // the prefix; arbitrary tenantIds still get the anon-IP scope.
  const { tenantId, source } = await resolveTenant(req);
  const topKParam = req.nextUrl.searchParams.get("topK");
  const topK = topKParam ? Math.max(1, Math.min(50, Number(topKParam))) : 12;
  await autoSeedIfEmpty(tenantId);
  const hits = await safeRecall({ tenantId, query: q, topK });
  // B08 · query-sensitive local recall. Empty queries → chronological
  // tail so the dashboard always shows something on first open. Unmatched
  // queries → chronological tail too (so vague prompts like "recent" or
  // "my stuff" surface entries instead of an empty pane). Tight queries
  // still get the relevance-scored slice.
  const localAll = getLocalFallback(tenantId);
  let local = q.trim() ? recallLocal(q, localAll, topK) : [];
  if (local.length === 0 && localAll.length > 0) {
    local = localAll.slice(-topK).reverse();
  }
  return Response.json({ query: q, hits, local, tenantId, scope: source });
}

// POST · same recall semantics as GET but body-driven so client tools
// (DelAssistant tryMcpAction, third-party callers) don't have to serialize
// to a query string. Was a 405 in 2026-05-25 brutal-QA — endpoint
// existed but only handled GET.
export async function POST(req: NextRequest) {
  let body: { query?: string; input?: string; topK?: number } = {};
  try {
    body = (await req.json()) as { query?: string; input?: string; topK?: number };
  } catch {}
  // B12 · accept `input` alias for `query`.
  const q = (body.input ?? body.query ?? "recent runs").slice(0, 240);
  const { tenantId, source } = await resolveTenant(req);
  const topK = Math.max(1, Math.min(50, Number(body.topK ?? 12)));
  await autoSeedIfEmpty(tenantId);
  const hits = await safeRecall({ tenantId, query: q, topK });
  const localAll = getLocalFallback(tenantId);
  let local = q.trim() ? recallLocal(q, localAll, topK) : [];
  if (local.length === 0 && localAll.length > 0) {
    local = localAll.slice(-topK).reverse();
  }
  return Response.json({ query: q, hits, local, tenantId, scope: source });
}
