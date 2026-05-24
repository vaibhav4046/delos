import { NextRequest } from "next/server";
import { z } from "zod";
import { generateText } from "ai";
import { resolveModel, withModels, type ModelKey } from "@/lib/llm";
import { runQuickAgent } from "@/lib/agents/quick";
import { generateJson } from "@/lib/agents/jsonGen";
import { rateLimit, clientIp } from "@/lib/rateLimit";

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

const bodySchema = z.object({
  goal: z.string().min(3).max(800),
  members: z.array(modelKey).min(2).max(5),
  judge: modelKey.optional(),
});

const verdictSchema = z.object({
  winnerIndex: z.number().int().min(0),
  rationale: z.string().min(3),
  scores: z.array(z.object({ index: z.number().int().min(0), score: z.number().min(0).max(10) })),
  merged: z.string().min(1),
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
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
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
        const judgePrompt = `You are the JUDGE of an agent cohort.

GOAL: ${goal}

ANSWERS (numbered):
${answers
  .filter((a) => a.ok)
  .map((a) => `[${a.index}] (${a.model}, ${a.ms}ms): ${a.text}`)
  .join("\n\n")}

Score each answer 0-10 on factual accuracy + directness + completeness.
Pick the winner. Then write a tight MERGED answer that distills the best of all.

Output JSON:
{ "winnerIndex": <int>, "rationale": "<one sentence>", "scores": [{ "index": 0, "score": 8 }, ...], "merged": "<final answer>" }`;

        try {
          const verdict = await generateJson({
            model: resolveModel(judgeKey),
            schema: verdictSchema,
            prompt: judgePrompt,
            temperature: 0.1,
          });
          send({ t: "cohort_verdict", winnerIndex: verdict.winnerIndex, rationale: verdict.rationale, scores: verdict.scores, merged: verdict.merged, at: Date.now() });
        } catch (e) {
          // Fallback: pick longest non-empty answer
          const best = answers.filter((a) => a.ok).sort((a, b) => b.text.length - a.text.length)[0];
          send({ t: "cohort_verdict", winnerIndex: best?.index ?? 0, rationale: "judge failed; picked longest", scores: [], merged: best?.text ?? "no answer", at: Date.now(), fallback: true, error: e instanceof Error ? e.message : String(e) });
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
