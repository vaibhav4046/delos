import { z } from "zod";
import { generateText } from "ai";
import { resolveModel } from "@/lib/llm";
import { MODEL_KEYS, type ModelKey } from "@/lib/llm.catalog";

import { zodErr } from "@/lib/apiAuth";
export const runtime = "nodejs";
export const maxDuration = 120;

const DEFAULT_TASKS = [
  {
    id: "math-arithmetic",
    domain: "math",
    prompt: "What is 17 × 23? Reply with ONLY the number, no words.",
    expected: (out: string) => /\b391\b/.test(out),
  },
  {
    id: "code-fizzbuzz",
    domain: "code",
    prompt: "Write a JavaScript function `fizzBuzz(n)` that prints 1..n with classic fizzbuzz rules. Return ONLY the function, no prose.",
    expected: (out: string) => /function\s+fizzBuzz/i.test(out) && /Fizz/i.test(out) && /Buzz/i.test(out),
  },
  {
    id: "research-graph-dbs",
    domain: "research",
    prompt: "In exactly 2 sentences, why do graph databases beat vector databases for AI agent memory?",
    expected: (out: string) => /(graph|traversal|relation|edge|node)/i.test(out) && out.split(/[.!?]/).length >= 2 && out.length < 600,
  },
  {
    id: "planning-trip",
    domain: "planning",
    prompt: "Plan a 3-day trip to Tokyo. Output exactly 3 bullet points (one per day), each ≤ 15 words.",
    expected: (out: string) => {
      const lines = out.split(/\n/).filter((l) => /^[-•*]/.test(l.trim()));
      return lines.length >= 3;
    },
  },
  {
    id: "instruction-following",
    domain: "instruction",
    prompt: "Output the single word: PONG",
    expected: (out: string) => /^\s*PONG\s*$/i.test(out.trim()),
  },
];

const Req = z.object({
  tasks: z.array(z.string()).optional(),
  models: z.array(z.string()).optional(),
  perTaskTimeoutMs: z.number().int().min(2000).max(30_000).default(15_000),
});

type Result = {
  task: string;
  domain: string;
  model: string;
  ok: boolean;
  ms: number;
  out: string;
  error?: string;
};

async function runOne(modelKey: ModelKey, prompt: string, timeoutMs: number): Promise<{ text: string; ms: number; error?: string }> {
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await generateText({
      model: resolveModel(modelKey),
      prompt,
      temperature: 0.1,
      abortSignal: ctrl.signal,
    });
    clearTimeout(t);
    return { text: r.text, ms: Date.now() - t0 };
  } catch (e) {
    return { text: "", ms: Date.now() - t0, error: (e as Error).message.slice(0, 120) };
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = Req.safeParse(body);
  if (!parsed.success) return zodErr(parsed.error);

  // Subset tasks + models
  const taskFilter = parsed.data.tasks;
  const tasks = taskFilter && taskFilter.length > 0 ? DEFAULT_TASKS.filter((t) => taskFilter.includes(t.id)) : DEFAULT_TASKS;
  // Default to fast models only — full sweep is expensive
  const modelFilter = parsed.data.models;
  const defaultFast: ModelKey[] = [
    "groq:openai/gpt-oss-20b",
    "groq:meta-llama/llama-4-scout-17b-16e-instruct",
    "google:gemini-2.5-flash",
  ];
  const models = (modelFilter && modelFilter.length > 0 ? modelFilter : defaultFast).filter((m) => MODEL_KEYS.includes(m as ModelKey)) as ModelKey[];

  const results: Result[] = [];
  for (const task of tasks) {
    // Run all models in parallel per task
    const settled = await Promise.allSettled(
      models.map(async (m) => {
        const { text, ms, error } = await runOne(m, task.prompt, parsed.data.perTaskTimeoutMs);
        const ok = !error && task.expected(text);
        return { task: task.id, domain: task.domain, model: m, ok, ms, out: text.slice(0, 400), error };
      }),
    );
    for (const s of settled) {
      if (s.status === "fulfilled") results.push(s.value);
    }
  }

  // Aggregate
  const byModel: Record<string, { passed: number; total: number; avgMs: number }> = {};
  for (const r of results) {
    if (!byModel[r.model]) byModel[r.model] = { passed: 0, total: 0, avgMs: 0 };
    byModel[r.model].total += 1;
    if (r.ok) byModel[r.model].passed += 1;
    byModel[r.model].avgMs += r.ms;
  }
  for (const k of Object.keys(byModel)) {
    byModel[k].avgMs = Math.round(byModel[k].avgMs / byModel[k].total);
  }

  return Response.json({
    ok: true,
    tasksRun: tasks.length,
    modelsRun: models.length,
    results,
    summary: byModel,
    leader: Object.entries(byModel).sort((a, b) => b[1].passed / b[1].total - a[1].passed / a[1].total)[0]?.[0],
    at: Date.now(),
  });
}

export async function GET() {
  return Response.json({
    ok: true,
    description: "POST { tasks?: string[], models?: ModelKey[], perTaskTimeoutMs?: 15000 } → multi-task multi-model eval results.",
    available_tasks: DEFAULT_TASKS.map((t) => ({ id: t.id, domain: t.domain, prompt: t.prompt.slice(0, 80) })),
    available_models: MODEL_KEYS,
  });
}
