import type { ModelKey } from "./llm.catalog";

// Per-million-token approximate rates, USD. Free-tier models marked $0.
const RATES: Record<string, { in: number; out: number }> = {
  "groq:openai/gpt-oss-120b": { in: 0.15, out: 0.6 },
  "groq:openai/gpt-oss-20b": { in: 0.05, out: 0.2 },
  "groq:meta-llama/llama-4-scout-17b-16e-instruct": { in: 0.11, out: 0.34 },
  "groq:meta-llama/llama-4-maverick-17b-128e-instruct": { in: 0.27, out: 0.85 },
  "groq:moonshotai/kimi-k2-instruct-0905": { in: 0.6, out: 2.5 },
  "mistral:mistral-large-latest": { in: 2.0, out: 6.0 },
  "mistral:mistral-small-latest": { in: 0.2, out: 0.6 },
  "google:gemini-2.5-flash": { in: 0.075, out: 0.3 },
  "google:gemini-2.5-pro": { in: 1.25, out: 5.0 },
};

export function modelKeyFromModelId(modelId: string): ModelKey | undefined {
  const lower = modelId.toLowerCase();
  const all = Object.keys(RATES) as Array<keyof typeof RATES>;
  for (const k of all) {
    const [, name] = k.split(":");
    if (lower === name.toLowerCase()) return k as ModelKey;
  }
  return undefined;
}

export function estimateCost(modelId: string, promptTokens: number, completionTokens: number): number {
  const key = modelKeyFromModelId(modelId);
  if (!key) return 0;
  const r = RATES[key];
  return (promptTokens * r.in + completionTokens * r.out) / 1_000_000;
}
