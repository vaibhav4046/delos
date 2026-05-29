import { generateText, type LanguageModel } from "ai";
import { models, getEffectiveTemperature } from "../llm";
import type { LLMUsage } from "./jsonGen";
import { isModelCool, breakerKeys, shelveProvider, sanitizeProviderError } from "./jsonGen";
import { bytezChat, bytezAvailable, type BytezMessage } from "../bytez";

// Per-call ceiling for the quick agent. Kept tight (route maxDuration is 30s,
// and subagents run several of these in parallel) so one hung provider can't
// stall the whole response — we fail over to the next provider instead.
const QUICK_CALL_TIMEOUT_MS = 15_000;
// Transient-fault shelf (5xx / network / timeout): short, so a flapping
// provider stops being tried first on every request but recovers quickly.
const QUICK_SHORT_COOLDOWN_MS = 30_000;

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
    if (isModelCool(m)) continue;
    const { family, model } = breakerKeys(m);
    const t0 = Date.now();
    try {
      const result = await generateText({
        model: m,
        system: sys,
        prompt: args.prompt,
        temperature: getEffectiveTemperature(0.6),
        // Bound each provider call so a hung connection fails over instead of
        // stalling the request until the platform kills it.
        abortSignal: AbortSignal.timeout(QUICK_CALL_TIMEOUT_MS),
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
      // `rate_limited` = account-wide quota → shelve the whole FAMILY long.
      // Every other fault (timeout/5xx/network/unknown) shelves only THIS model
      // id short, so a blip on one SKU can't brick its siblings.
      if (lastErr === "rate_limited") shelveProvider(family);
      else shelveProvider(model, QUICK_SHORT_COOLDOWN_MS);
      // Fall through to the next provider on any failure (loop continues).
      continue;
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
