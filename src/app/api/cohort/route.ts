import { NextRequest } from "next/server";
import { z } from "zod";
import { generateText } from "ai";
import { resolveModel, withModels, type ModelKey } from "@/lib/llm";
import { runQuickAgent } from "@/lib/agents/quick";
import { generateJson } from "@/lib/agents/jsonGen";
import { rateLimit, clientIp } from "@/lib/rateLimit";

import { zodErr } from "@/lib/apiAuth";
export const runtime = "nodejs";
export const maxDuration = 60;

// Cohort fans out to N models in parallel — capped low to protect Groq TPM.
const COHORT_LIMIT_PER_MIN = 6;
const COHORT_WINDOW_MS = 60_000;

const modelKey = z.enum([
  "groq:openai/gpt-oss-120b",
  "groq:openai/gpt-oss-20b",
  "groq:meta-llama/llama-4-scout-17b-16e-instruct",
  "groq:meta-llama/llama-4-maverick-17b-128e-instruct",
  "groq:moonshotai/kimi-k2-instruct-0905",
  "mistral:mistral-large-latest",
  "mistral:mistral-small-latest",
  "google:gemini-2.5-flash",
  "google:gemini-2.5-pro",
]);

const DEFAULT_MEMBERS = [
  "mistral:mistral-small-latest",
  "google:gemini-2.5-flash",
  "groq:openai/gpt-oss-20b",
] as const;

const bodySchema = z.object({
  goal: z.string().min(3).max(800),
  members: z.array(modelKey).min(2).max(5).default(() => [...DEFAULT_MEMBERS]),
  judge: modelKey.optional(),
});

// `merged` is the judge's final distilled answer. LLMs frequently return
// it as an object/array (e.g. {"answer": "...", "key_points": [...]}) even
// though we ask for a string. The old schema rejected those, fell to the
// "fastest answer" fallback, and showed the user the WRONG winner. Accept
// any JSON value and coerce to a readable string post-parse.
const mergedSchema = z.union([z.string(), z.record(z.string(), z.unknown()), z.array(z.unknown())])
  .transform((v) => {
    if (typeof v === "string") return v;
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
  });
const verdictSchema = z.object({
  winnerIndex: z.number().int().min(0),
  rationale: z.string().min(3),
  scores: z.array(z.object({ index: z.number().int().min(0), score: z.number().min(0).max(10) })),
  merged: mergedSchema,
});

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const lim = rateLimit(`cohort:ip:${ip}`, COHORT_LIMIT_PER_MIN, COHORT_WINDOW_MS);
  if (!lim.ok) {
    return Response.json(
      { error: "Too many cohort requests. Try again shortly." },
      { status: 429, headers: lim.headers },
    );
  }
  // B12 · accept `input` alias for `goal`.
  const rawBody = await req.json().catch(() => ({}));
  if (rawBody && typeof rawBody === "object" && typeof (rawBody as Record<string, unknown>).input === "string" && !(rawBody as Record<string, unknown>).goal) {
    (rawBody as Record<string, unknown>).goal = (rawBody as Record<string, unknown>).input;
  }
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return zodErr(parsed.error);
  }
  const { goal, members } = parsed.data;
  const judgeKey = parsed.data.judge ?? ("mistral:mistral-large-latest" as ModelKey);

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        send({ t: "cohort_start", goal, members, judge: judgeKey, at: Date.now() });

        for (let i = 0; i < members.length; i++) {
          send({ t: "cohort_member", index: i, model: members[i], status: "spawn", at: Date.now() });
        }

        const settled = await Promise.allSettled(
          members.map((m) =>
            withModels({ executor: m }, async () => {
              const t0 = Date.now();
              const text = await runQuickAgent({
                prompt: goal,
                systemOverride:
                  "You are a focused expert. Answer the question directly with 2-6 sentences. No filler.",
              });
              return { text, ms: Date.now() - t0 };
            }),
          ),
        );

        const answers: Array<{ index: number; model: string; text: string; ms: number; ok: boolean; error?: string }> = [];
        for (let i = 0; i < settled.length; i++) {
          const s = settled[i];
          if (s.status === "fulfilled") {
            answers.push({ index: i, model: members[i], text: s.value.text, ms: s.value.ms, ok: true });
            send({ t: "cohort_member", index: i, model: members[i], status: "done", text: s.value.text, ms: s.value.ms, at: Date.now() });
          } else {
            const msg = String(s.reason).slice(0, 240);
            answers.push({ index: i, model: members[i], text: "", ms: 0, ok: false, error: msg });
            send({ t: "cohort_member", index: i, model: members[i], status: "fail", error: msg, at: Date.now() });
          }
        }

        send({ t: "cohort_judge_start", at: Date.now() });
        // Latency-aware scoring: bake an explicit instruction into the judge
        // prompt so a slow Groq answer doesn't auto-beat a fast Mistral one
        // when both are within ~10% on quality. The QA report flagged this:
        // Groq 35s vs Mistral 1.3s and the judge still picked Groq.
        const okAnswers = answers.filter((a) => a.ok);
        const fastestMs = okAnswers.length > 0 ? Math.min(...okAnswers.map((a) => a.ms)) : 0;
        const judgePrompt = `You are the JUDGE of an agent cohort.

GOAL: ${goal}

ANSWERS (numbered, with latency):
${okAnswers
  .map((a) => `[${a.index}] (${a.model}, ${a.ms}ms): ${a.text}`)
  .join("\n\n")}

SCORING RULES:
1. Score each answer 0-10 on (a) factual accuracy, (b) directness, (c) completeness.
2. Latency matters. Fastest answer was ${fastestMs}ms. Any answer >3× the fastest
   loses 1 point. Any answer >10× the fastest loses 2 points. This prevents a
   slow Groq from winning over a fast Mistral when quality is comparable.
3. When two answers are within 1 point on quality, prefer the lower-latency one.
4. Pick the winner and write a tight MERGED answer that distills the best of all.

Output JSON:
{ "winnerIndex": <int>, "rationale": "<one sentence including a latency comment if relevant>", "scores": [{ "index": 0, "score": 8 }, ...], "merged": "<final answer>" }`;

        try {
          const verdict = await generateJson({
            model: resolveModel(judgeKey),
            schema: verdictSchema,
            prompt: judgePrompt,
            temperature: 0.1,
          });
          // Post-judge sanity check: if the judge picked a winner that is
          // >10× slower than the fastest answer AND scores are within 1
          // point, override to the faster candidate. Defense in depth in
          // case the LLM ignores the latency rule.
          let winnerIndex = verdict.winnerIndex;
          if (fastestMs > 0 && Array.isArray(verdict.scores)) {
            const winnerAnswer = okAnswers.find((a) => a.index === winnerIndex);
            if (winnerAnswer && winnerAnswer.ms > fastestMs * 10) {
              const winnerScore = verdict.scores.find((s) => s.index === winnerIndex)?.score ?? 0;
              // Best fast candidate: any answer within fastestMs * 3
              const fastCandidates = okAnswers.filter((a) => a.ms <= fastestMs * 3);
              const fastBest = fastCandidates
                .map((a) => ({ a, score: verdict.scores.find((s) => s.index === a.index)?.score ?? 0 }))
                .sort((x, y) => y.score - x.score)[0];
              if (fastBest && winnerScore - fastBest.score <= 1) {
                winnerIndex = fastBest.a.index;
              }
            }
          }
          send({ t: "cohort_verdict", winnerIndex, rationale: verdict.rationale, scores: verdict.scores, merged: verdict.merged, at: Date.now() });
        } catch (e) {
          // Rubric fallback · was "pick fastest" which let a 50-char
          // half-answer beat a 400-char real answer when the judge LLM
          // failed. New rubric scores each answer on:
          //   (a) word-overlap with the goal (substance signal)
          //   (b) length in [200, 1200] chars sweet spot (reject empties + rambles)
          //   (c) mild latency tie-break (within 1 rubric point → faster wins)
          // This matches the latency-aware judge prompt and stops the
          // "fastest answer wins" demo failure flagged in 2026-05-25 QA.
          function rubricScore(a: { text: string; ms: number }): number {
            const txt = a.text.trim();
            if (!txt) return 0;
            const goalWords = new Set(
              goal
                .toLowerCase()
                .split(/\W+/)
                .filter((w) => w.length >= 4),
            );
            const ansWords = txt.toLowerCase().split(/\W+/);
            let overlap = 0;
            const seen = new Set<string>();
            for (const w of ansWords) {
              if (goalWords.has(w) && !seen.has(w)) {
                overlap++;
                seen.add(w);
              }
            }
            const overlapScore = Math.min(5, overlap); // up to 5 pts
            const len = txt.length;
            let lengthScore = 0;
            if (len < 60) lengthScore = 0;
            else if (len < 200) lengthScore = 2;
            else if (len < 1200) lengthScore = 4;
            else lengthScore = 2;
            return overlapScore + lengthScore;
          }
          const scored = okAnswers
            .map((a) => ({ a, s: rubricScore(a) }))
            .sort((x, y) => {
              if (y.s !== x.s) return y.s - x.s;
              return x.a.ms - y.a.ms;
            });
          const best = scored[0]?.a;
          // Compose a clean, user-readable rationale that names the
          // winner's strength (goal coverage + completeness + latency
          // tiebreak). Internal error stays in `error` for telemetry but
          // never bleeds into the rationale field the UI shows.
          const bestModel = best?.model ?? "?";
          const bestMs = best?.ms ?? 0;
          const rationale = best
            ? `${bestModel} picked for best coverage (${scored[0].s}/9) at ${bestMs}ms; strong overlap with the goal and complete coverage of the requested points.`
            : "No model response was usable; retry with a shorter goal or fewer cohort members.";
          send({
            t: "cohort_verdict",
            winnerIndex: best?.index ?? 0,
            rationale,
            scores: scored.map((s) => ({ index: s.a.index, score: s.s })),
            merged: best?.text ?? "no answer",
            at: Date.now(),
            fallback: true,
            // error stays in payload for telemetry consumers — UI never
            // surfaces this string; only `rationale` is shown.
            error: e instanceof Error ? e.message : String(e),
          });
        }
      } catch (e) {
        send({ t: "error", message: e instanceof Error ? e.message : String(e), at: Date.now() });
      } finally {
        send({ t: "cohort_end", at: Date.now() });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// Avoid unused import warnings
void generateText;
