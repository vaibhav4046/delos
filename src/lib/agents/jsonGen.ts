import { generateText, type LanguageModel } from "ai";
import type { z } from "zod";

function stripFences(s: string): string {
  return s.replace(/```(?:json)?/g, "").trim();
}

function extractJson(s: string): string | null {
  const trimmed = stripFences(s);
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  return trimmed.slice(first, last + 1);
}

export type LLMUsage = { model: string; promptTokens: number; completionTokens: number; ms: number };

function safeModelName(m: LanguageModel): string {
  const x = m as unknown as { modelId?: string; provider?: string };
  return x.modelId ?? x.provider ?? "unknown";
}

export async function generateJson<T>(args: {
  model: LanguageModel;
  schema: z.ZodType<T>;
  prompt: string;
  temperature?: number;
  maxRetries?: number;
  onUsage?: (u: LLMUsage) => void;
}): Promise<T> {
  const sys =
    "Respond ONLY with a single JSON object. No prose, no markdown fences, no tool calls, no commentary.";
  const fullPrompt = `${args.prompt}\n\nReturn ONLY a valid JSON object.`;
  const attempts = args.maxRetries ?? 3;
  let lastErr = "";
  for (let i = 0; i < attempts; i++) {
    let text = "";
    try {
      const t0 = Date.now();
      const result = await generateText({
        model: args.model,
        system: sys,
        prompt: i === 0 ? fullPrompt : `${fullPrompt}\n\nPrevious attempt failed: ${lastErr}. Strict JSON ONLY.`,
        temperature: args.temperature ?? 0.2,
      });
      const ms = Date.now() - t0;
      if (args.onUsage) {
        const u = result.usage as unknown as { inputTokens?: number; outputTokens?: number; promptTokens?: number; completionTokens?: number } | undefined;
        args.onUsage({
          model: safeModelName(args.model),
          promptTokens: u?.inputTokens ?? u?.promptTokens ?? 0,
          completionTokens: u?.outputTokens ?? u?.completionTokens ?? 0,
          ms,
        });
      }
      text = result.text;
    } catch (e) {
      lastErr = (e as Error).message;
      continue;
    }
    const json = extractJson(text);
    if (!json) {
      lastErr = "no JSON object found";
      continue;
    }
    try {
      const obj = JSON.parse(json);
      const parsed = args.schema.safeParse(obj);
      if (parsed.success) return parsed.data;
      lastErr = parsed.error.message.slice(0, 300);
    } catch (e) {
      lastErr = (e as Error).message;
    }
  }
  throw new Error(`generateJson failed after ${attempts} attempts: ${lastErr}`);
}
