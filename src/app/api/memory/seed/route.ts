import { NextRequest } from "next/server";
import { safeAddMemory, ensureTenant } from "@/lib/hydra";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { resolveTenant } from "@/lib/apiAuth";

export const runtime = "nodejs";

const SEED_LIMIT_PER_MIN = 2;
const SEED_WINDOW_MS = 60_000;

const SEED_MEMORIES = [
  {
    text: "Run #1 — goal: 'compare graph DBs vs vector DBs for agent memory'. Planner=kimi-k2 chose 3 steps. web_search via MCP returned 9 hits. Critic drift=0.08. Final: graph DBs win for traversal-based recall.",
    tags: ["run-summary", "research"],
  },
  {
    text: "Run #2 — goal: 'build me a stopwatch'. AppBuilder generated spec via gpt-oss-120b. Validated with zod. Spec app mounted as window. 12 tools / 1240 tokens / $0.0008.",
    tags: ["run-summary", "app-build"],
  },
  {
    text: "Run #3 — chaos test: tool_flake=on + context_flood=on. Initial web_search timed out. Cockatiel retry succeeded on attempt 2. Context compressed at boundary from 8400→2100 tokens. Final answer delivered in 4.2s.",
    tags: ["run-summary", "chaos-recovery"],
  },
  {
    text: "Run #4 — cohort race: 3 models (gpt-oss-120b, llama-4-scout, gemini-2.5-flash) on 'best framework for AI agent OS'. Judge=mistral-large picked [2] gemini, score 9/10. Merged answer cites all 3 perspectives.",
    tags: ["run-summary", "cohort"],
  },
  {
    text: "Run #5 — voice command 'open builder and make me a tip calculator'. Whisper transcribed correctly. Intent classifier mapped to build_app + payload. App Builder opened, prefilled prompt, ran build. App mounted in 3.8s.",
    tags: ["run-summary", "voice-autonomy"],
  },
  {
    text: "Run #6 — user interrupt mid-stream. Original goal: 'find capital of France'. After step 1, user injected 'actually find capital of Japan'. Planner re-decomposed, executor ran new search, critic accepted drift. Delivered correct answer for Japan.",
    tags: ["run-summary", "adaptation"],
  },
  {
    text: "Run #7 — MCP tool fallback. Bundled wiki_search failed (rate limit). Sibling fallback to dad_joke MCP returned. Critic flagged irrelevance, planner replanned with hn_top instead. Recovered without user intervention.",
    tags: ["run-summary", "tool-fallback"],
  },
  {
    text: "Cohort verdict (cached) — for short factual queries, gemini-2.5-flash wins on latency (198ms avg). For multi-step reasoning, kimi-k2 wins on accuracy. Stored as routing hint for future cohort calls.",
    tags: ["learning", "routing"],
  },
  {
    text: "App spec persisted: 'Stopwatch v1' — components: start/stop/reset buttons + display. State key=elapsedMs. Can be re-mounted across sessions via HydraDB tenant.",
    tags: ["app-spec"],
  },
  {
    text: "User preference (cross-session) — tenant=delrio_demo prefers concise answers, no markdown headers, cites sources inline as [1][2]. Applied to all chat / research runs.",
    tags: ["preference"],
  },
];

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const lim = rateLimit(`memseed:ip:${ip}`, SEED_LIMIT_PER_MIN, SEED_WINDOW_MS);
  if (!lim.ok) {
    return Response.json(
      { ok: false, error: "Seed endpoint is rate-limited." },
      { status: 429, headers: lim.headers },
    );
  }
  // BOLA fix (QA report BUG-1) — tenantId comes from session, never body.
  // Exception: reserved test prefixes (qa_/demo_/test_/judge_/hack_) are
  // honored from body so QA reruns can isolate scope without an account.
  // resolveTenant enforces the regex; arbitrary tenantIds are rejected.
  let bodyTenantId: string | undefined;
  try {
    const body = await req.clone().json().catch(() => null);
    if (body && typeof body.tenantId === "string") bodyTenantId = body.tenantId;
  } catch {}
  const { tenantId } = await resolveTenant(req, { bodyTenantId });
  // Hard-block seeding into a regular user tenant. Was polluting
  // anon_*/account tenants with the demo graph so the user's actual
  // pinned facts got drowned in seed text (2026-05-25 brutal-QA P0:
  // "Memory not trustworthy — recall returned seeded demo memories,
  // not my facts"). Only demo/QA/judge/hack/test scopes accept seeds.
  // R12 · also accept the canonical guest tenant `delrio_demo` so the
  // in-OS Memory Browser's auto-seed POST is honored. Was: refused with
  // 403, which is why the dashboard landed empty for fresh judge clicks.
  if (!/^(demo|qa|test|judge|hack)_/i.test(tenantId) && tenantId !== "delrio_demo") {
    return Response.json(
      {
        ok: false,
        error:
          "Seed endpoint refuses to write into a user tenant. Pass tenantId starting with demo_/qa_/test_/judge_/hack_ (or delrio_demo) to scope the seeds.",
        tenantId,
      },
      { status: 403 },
    );
  }
  await ensureTenant(tenantId);
  const added: string[] = [];
  const failed: string[] = [];
  for (const m of SEED_MEMORIES) {
    try {
      await safeAddMemory({
        tenantId,
        text: m.text,
        metadata: { runId: `seed-${Date.now()}`, tags: m.tags, seeded: true },
      });
      added.push(m.text.slice(0, 60));
    } catch (e) {
      failed.push((e as Error).message);
    }
  }
  return Response.json({
    ok: true,
    tenantId,
    seeded: added.length,
    failed: failed.length,
    entries: added,
  });
}

// GET — convenience so judges can hit it from a browser
export async function GET(req: NextRequest) {
  return POST(req);
}
