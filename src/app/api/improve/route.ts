import { generateText } from "ai";
import { resolveModel } from "@/lib/llm";
import { safeAddMemory, safeRecall, ensureTenant } from "@/lib/hydra";
import { listRuns } from "@/lib/runLog";
import { env } from "@/lib/env";
import { z } from "zod";

import { zodErr } from "@/lib/apiAuth";
export const runtime = "nodejs";
export const maxDuration = 30;

// Self-improvement loop:
// 1. Recall recent run summaries from HydraDB
// 2. Snapshot recent in-memory runs (drift, replans, failures)
// 3. LLM proposes 3 concrete improvements + 1 routing hint
// 4. Persist proposals as memories tagged learning + improvement
// 5. Future runs auto-recall these hints in planner context

const Req = z.object({
  tenantId: z.string().default(env.DELRIO_TENANT_ID),
  windowHours: z.number().int().min(1).max(168).default(24),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = Req.safeParse(body);
  if (!parsed.success) return zodErr(parsed.error);
  const { tenantId, windowHours } = parsed.data;
  await ensureTenant(tenantId);

  // 1. Pull recent run summaries
  const recallHits = await safeRecall({
    tenantId,
    query: "run-summary failure replan drift recovery",
    topK: 12,
  }).catch(() => []);

  // 2. In-memory recent runs from this Lambda (last 60 in window)
  const since = Date.now() - windowHours * 3600 * 1000;
  const recent = listRuns(60).filter((r) => r.startedAt >= since);
  const failures = recent.filter((r) => r.success === false || (r.replans ?? 0) > 1);
  const highDrift = recent.filter((r) => (r.drift ?? 0) > 0.4);

  const summary = {
    totalRuns: recent.length,
    failures: failures.length,
    highDrift: highDrift.length,
    avgReplans: recent.length > 0 ? recent.reduce((a, r) => a + (r.replans ?? 0), 0) / recent.length : 0,
    avgDrift: recent.length > 0 ? recent.reduce((a, r) => a + (r.drift ?? 0), 0) / recent.length : 0,
    sampleGoals: recent.slice(0, 8).map((r) => r.goal.slice(0, 80)),
    historicalLearnings: recallHits.map((h) => h.text.slice(0, 200)),
  };

  // 3. Ask the LLM for proposals
  const prompt = `You are DelOS's self-improvement critic. Analyze recent agent runs and propose concrete improvements.

Recent activity (last ${windowHours}h):
- Total runs: ${summary.totalRuns}
- Failures: ${summary.failures}
- High-drift runs (>0.4): ${summary.highDrift}
- Avg replans/run: ${summary.avgReplans.toFixed(2)}
- Avg drift: ${summary.avgDrift.toFixed(2)}

Sample recent goals:
${summary.sampleGoals.map((g, i) => `${i + 1}. ${g}`).join("\n")}

Historical learnings already captured:
${summary.historicalLearnings.slice(0, 5).map((l, i) => `[${i + 1}] ${l}`).join("\n") || "(none yet)"}

Output JSON with EXACTLY this shape, nothing else:
{
  "diagnoses": ["one-line root cause", "one-line root cause", "one-line root cause"],
  "improvements": ["concrete actionable improvement", "concrete actionable improvement", "concrete actionable improvement"],
  "routing_hint": "one line on which model to prefer for what task domain"
}

JSON:`;

  let llmOut = "";
  try {
    const r = await generateText({
      model: resolveModel("groq:openai/gpt-oss-120b"),
      prompt,
      temperature: 0.3,
      abortSignal: AbortSignal.timeout(20_000),
    });
    llmOut = r.text;
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message, summary }, { status: 500 });
  }

  // 4. Parse JSON
  let proposals: { diagnoses?: string[]; improvements?: string[]; routing_hint?: string } = {};
  const jsonMatch = llmOut.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      proposals = JSON.parse(jsonMatch[0]);
    } catch {}
  }

  // 5. Persist as memories
  const persisted: string[] = [];
  if (proposals.improvements) {
    for (const imp of proposals.improvements.slice(0, 5)) {
      const text = `Learning (self-improve cycle ${new Date().toISOString().slice(0, 10)}): ${imp}`;
      try {
        await safeAddMemory({
          tenantId,
          text,
          metadata: { tags: ["learning", "self-improvement", `cycle-${Date.now()}`] },
        });
        persisted.push(text.slice(0, 100));
      } catch {}
    }
  }
  if (proposals.routing_hint) {
    const text = `Routing hint (self-improve): ${proposals.routing_hint}`;
    try {
      await safeAddMemory({
        tenantId,
        text,
        metadata: { tags: ["learning", "routing", "self-improvement"] },
      });
      persisted.push(text.slice(0, 100));
    } catch {}
  }

  return Response.json({
    ok: true,
    summary,
    proposals,
    persisted,
    note: "Improvements stored as memories tagged 'learning' + 'self-improvement'. Future runs will surface them via recall.",
  });
}

export async function GET() {
  return Response.json({
    ok: true,
    description: "POST { tenantId?, windowHours? } → analyze recent runs, propose 3 improvements + 1 routing hint, persist as memories for future recall.",
    schedule: "Recommended: trigger via cron every 6 hours.",
  });
}
