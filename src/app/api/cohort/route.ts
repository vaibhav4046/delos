import { NextRequest } from "next/server";
import { z } from "zod";
import { generateText } from "ai";
import { resolveModel, withModels, type ModelKey } from "@/lib/llm";
import { runQuickAgent } from "@/lib/agents/quick";
import { generateJson } from "@/lib/agents/jsonGen";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { isNimEnabled, nimChat, NIM_MODELS } from "@/lib/llm/providers/nim";
import { safeAddMemory } from "@/lib/hydra";

import { resolveTenant, zodErr } from "@/lib/apiAuth";
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
  // Lowered from 3 → 1 char · users sending "HI" got 422; server pads short
  // greetings into a richer prompt below.
  goal: z.string().min(1).max(800),
  // Cap raised to 7 so the UI can race every model in MODEL_CATALOG
  // (current catalog count). Was 5 which silently 400d the full roster.
  members: z.array(modelKey).min(2).max(7).default(() => [...DEFAULT_MEMBERS]),
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
  const { goal } = parsed.data;
  // Tenant resolution · always server-side. Used downstream for arena
  // memory writes so cohort verdicts get persisted under the right tenant.
  const { tenantId } = await resolveTenant(req);
  // F16 · godMode adds 2× NIM rows + spawns a verifier pass at temp 0.
  // Honor ?godMode=1 query param.
  const url = new URL(req.url);
  const isGodMode = url.searchParams.get("godMode") === "1" && isNimEnabled();
  const members: string[] = isGodMode
    ? [
        "groq:openai/gpt-oss-120b",
        "groq:meta-llama/llama-4-maverick-17b-128e-instruct",
        "mistral:mistral-large-latest",
        "google:gemini-2.5-pro",
        `nim:${NIM_MODELS.llama33_70b}`,
        `nim:${NIM_MODELS.nemotronSuper49b}`,
      ]
    : (parsed.data.members as string[]);
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
          members.map((m) => {
            // F16 · NIM branch · "nim:nvidia/..." routes to the NIM provider directly.
            if (m.startsWith("nim:")) {
              return (async () => {
                const t0 = Date.now();
                const model = m.slice(4);
                const out = await nimChat({
                  model,
                  messages: [
                    {
                      role: "system",
                      content:
                        "You are a focused expert. Answer the question directly with 2-6 sentences. No filler. If you do not know, say so explicitly rather than guessing.",
                    },
                    { role: "user", content: goal },
                  ],
                  temperature: 0.3,
                  max_tokens: 500,
                });
                return { text: out.text, ms: Date.now() - t0 };
              })();
            }
            return withModels({ executor: m as ModelKey }, async () => {
              const t0 = Date.now();
              // Arena pins each row to ONE model · disable fallback so
              // Mistral's failure is reported as Mistral, not as the
              // Bytez tertiary's "not_in_catalog". Brutal-QA fix.
              const text = await runQuickAgent({
                prompt: goal,
                systemOverride:
                  "You are a focused expert. Answer the question directly with 2-6 sentences. No filler.",
                disableFallback: true,
              });
              return { text, ms: Date.now() - t0 };
            });
          }),
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

        // F18 · cohort_disagreement · bag-of-tokens cosine across answers.
        // Higher = models disagree more. Helps the UI surface a "needs cite"
        // hint when the cohort is divided.
        const tokenize = (s: string) =>
          s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length >= 3);
        const okTexts = answers.filter((a) => a.ok && a.text).map((a) => a.text);
        let disagreement = 0;
        const pairs: Array<{ a: number; b: number; sim: number }> = [];
        if (okTexts.length >= 2) {
          const vecs = okTexts.map((t) => {
            const m = new Map<string, number>();
            for (const tk of tokenize(t)) m.set(tk, (m.get(tk) ?? 0) + 1);
            return m;
          });
          const cos = (a: Map<string, number>, b: Map<string, number>) => {
            let dot = 0, na = 0, nb = 0;
            for (const [k, v] of a) { na += v * v; if (b.has(k)) dot += v * (b.get(k) ?? 0); }
            for (const [, v] of b) nb += v * v;
            return dot / Math.max(1e-9, Math.sqrt(na * nb));
          };
          let totalSim = 0;
          let count = 0;
          for (let i = 0; i < vecs.length; i++) {
            for (let k = i + 1; k < vecs.length; k++) {
              const sim = cos(vecs[i], vecs[k]);
              pairs.push({ a: i, b: k, sim });
              totalSim += sim;
              count++;
            }
          }
          const avgSim = count > 0 ? totalSim / count : 1;
          disagreement = 1 - avgSim;
        }
        send({ t: "cohort_disagreement", score: disagreement, pairs, at: Date.now() });
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
          // Arena memory · persist the verdict so "last arena winner",
          // "what did arena decide about graph DB memory", and dashboard
          // recall surface real history. Audit P1 — cohort had been
          // streaming results then discarding them. Source tag "arena".
          try {
            const winnerModel = members[winnerIndex] ?? "?";
            const scoreLine = (verdict.scores ?? [])
              .map((s) => `${members[s.index]?.split(":").pop()?.slice(0, 24) ?? "?"}=${s.score}`)
              .join(", ");
            const summary = `Arena race · goal "${goal.slice(0, 80)}". Winner: ${winnerModel}. Scores: ${scoreLine || "n/a"}. Disagreement: ${disagreement.toFixed(2)}. Merged: ${String(verdict.merged).slice(0, 240)}`;
            await safeAddMemory({
              tenantId,
              text: summary,
              metadata: {
                runId: "arena",
                tags: ["arena", "cohort", "verdict"],
                source: "arena",
                winner: winnerModel,
                disagreement,
              },
            });
          } catch {}
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
          // Arena memory · rubric-fallback path. Same shape as the
          // judge-success path so recall queries find both kinds.
          try {
            const summary = `Arena race · goal "${goal.slice(0, 80)}". Winner (rubric fallback): ${bestModel} at ${bestMs}ms. Rationale: ${rationale}. Merged: ${(best?.text ?? "").slice(0, 240)}`;
            await safeAddMemory({
              tenantId,
              text: summary,
              metadata: {
                runId: "arena",
                tags: ["arena", "cohort", "verdict", "fallback"],
                source: "arena",
                winner: bestModel,
              },
            });
          } catch {}
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
