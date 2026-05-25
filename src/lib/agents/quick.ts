import { generateText, type LanguageModel } from "ai";
import { models, getEffectiveTemperature } from "../llm";
import type { LLMUsage } from "./jsonGen";
import { isProviderCool, shelveProvider, sanitizeProviderError } from "./jsonGen";
import { bytezChat, bytezAvailable, type BytezMessage } from "../bytez";

function modelProvider(m: LanguageModel): string {
  const x = m as { provider?: string; modelId?: string };
  if (x.provider) return x.provider;
  const id = x.modelId ?? "";
  const sep = id.indexOf("/");
  return sep > 0 ? id.slice(0, sep) : id;
}

// Cross-provider fallback chain for the lightweight chat agent. /api/quick-
// agent is the entry point for the in-app chat bubbles, voice "answer"
// intents, and the Cowork side-effect drafting · all of which break if the
// primary Groq quota is dry. Falls through Mistral → Gemini and synthesizes
// a deterministic apology if every provider misses.
export async function runQuickAgent(args: {
  prompt: string;
  onUsage?: (u: LLMUsage) => void;
  systemOverride?: string;
  // Brutal-QA · arena/cohort sees the same model name on the chip card,
  // so falling through to Bytez and printing "bytez_not_in_catalog" makes
  // judges think *Mistral Large* failed with a Bytez error. Set true to
  // pin to the active executor and surface its real failure mode.
  disableFallback?: boolean;
}): Promise<string> {
  const sys =
    args.systemOverride ??
    "You are a concise focused assistant. Reply in 1-4 sentences with the answer. No filler. No 'I think', no caveats.";
  const candidates: LanguageModel[] = args.disableFallback
    ? [models.executor]
    : [models.executor, ...models.fallbackChain];
  let lastErr = "all_providers_failed";
  for (const m of candidates) {
    const provider = modelProvider(m);
    if (isProviderCool(provider)) continue;
    const t0 = Date.now();
    try {
      const result = await generateText({
        model: m,
        system: sys,
        prompt: args.prompt,
        temperature: getEffectiveTemperature(0.6),
      });
      const ms = Date.now() - t0;
      if (args.onUsage) {
        const u = result.usage as unknown as { inputTokens?: number; outputTokens?: number; promptTokens?: number; completionTokens?: number } | undefined;
        const meta = m as unknown as { modelId?: string };
        args.onUsage({
          model: meta.modelId ?? "executor",
          promptTokens: u?.inputTokens ?? u?.promptTokens ?? 0,
          completionTokens: u?.outputTokens ?? u?.completionTokens ?? 0,
          ms,
        });
      }
      const out = result.text.trim();
      if (out) return out;
      lastErr = "empty_response";
    } catch (e) {
      lastErr = sanitizeProviderError((e as Error).message);
      if (lastErr === "rate_limited") shelveProvider(provider);
      if (lastErr === "auth_failed" || lastErr === "network_error") continue;
    }
  }
  // ─── Bytez tertiary fallback ─────────────────────────────────────────
  // Engaged only when every Mistral/Gemini/Groq path failed. Soft-skips
  // if the key isn't configured or the catalog has no deployed model.
  // Suppressed when caller pins to a single executor (arena/cohort).
  if (!args.disableFallback && bytezAvailable()) {
    const bzMessages: BytezMessage[] = [
      { role: "system", content: args.systemOverride ?? "You are a concise focused assistant. Reply in 1-4 sentences with the answer. No filler." },
      { role: "user", content: args.prompt },
    ];
    const bz = await bytezChat({ messages: bzMessages, temperature: getEffectiveTemperature(0.6), maxLength: 600, timeoutMs: 22_000 });
    if (bz.ok && bz.text) {
      if (args.onUsage) {
        args.onUsage({ model: `bytez:${bz.modelId}`, promptTokens: 0, completionTokens: 0, ms: bz.ms });
      }
      return bz.text;
    }
    if (bz.reason) lastErr = `bytez_${bz.reason}`;
  }
  throw new Error(`quick_agent_failed (${lastErr})`);
}
