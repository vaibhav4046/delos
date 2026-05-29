import { generateText, type LanguageModel } from "ai";
import type { z } from "zod";
import { bytezChat, bytezAvailable, type BytezMessage } from "../bytez";

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

// ─── Provider circuit breaker ──────────────────────────────────────────────
// In-process map of provider → cooldown-until timestamp. When a provider 429s
// we shelve it for COOLDOWN_MS so subsequent calls skip straight to the
// fallback list instead of re-burning quota that we already know is exhausted.
// Plain Map is fine — Vercel Lambdas live ~5 min, longer than the cooldown
// we want, so the state stays warm across requests in the same container.
const COOLDOWN: Map<string, number> = new Map();
const COOLDOWN_MS = 10 * 60_000; // 10 minutes — quota exhaustion (rate_limited)
// Transient faults (5xx, network blip, our own per-call timeout) get a SHORT
// shelf: long enough to stop hammering a flapping provider on every single
// request, short enough that we recover within a minute once it's healthy.
const SHORT_COOLDOWN_MS = 30_000;
// Hard ceiling on any one provider call. Callers that pass their own (shorter)
// abortSignal still win — we abort on whichever fires first. Without this, a
// provider that accepts the TCP connection but never streams a token hangs the
// whole request until the platform's maxDuration kills it: the SSE stream dies
// with no `answer` event. Bounding each call lets the cascade fail over fast.
const PER_CALL_TIMEOUT_MS = 20_000;

// Merge a caller's optional abort with an internal timeout. Returns a signal
// that fires on whichever happens first, a cleanup to release the timer/
// listener, and a flag telling us our timeout (not the caller) fired.
function mergeAbort(
  caller: AbortSignal | undefined,
  ms: number,
): { signal: AbortSignal; cleanup: () => void; timedOut: () => boolean } {
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, ms);
  const onCallerAbort = () => ctl.abort();
  if (caller) {
    if (caller.aborted) ctl.abort();
    else caller.addEventListener("abort", onCallerAbort, { once: true });
  }
  return {
    signal: ctl.signal,
    cleanup: () => {
      clearTimeout(timer);
      caller?.removeEventListener("abort", onCallerAbort);
    },
    timedOut: () => timedOut,
  };
}

// ─── Circuit-breaker keys ───────────────────────────────────────────────
// Two granularities so a transient blip on ONE model can't brick its
// siblings, while a genuine account-wide quota 429 still shelves the family:
//   • family — the provider account (all SKUs share one quota): "mistral",
//     "groq", "google". A `rate_limited` 429 shelves THIS (long, 10 min).
//   • model  — the specific SKU id ("mistral-large-latest"). Every other
//     fault (timeout/5xx/network/unknown) shelves only THIS (short, 30s), so
//     mistral-small stays usable when mistral-large momentarily flaps.
// The AI SDK reports provider as "mistral.chat"/"groq.chat" — we take the
// segment before the dot so every SKU of a provider shares one family key.
// This fixes the live outage where a single transient Mistral fault shelved
// the whole `mistral.chat` family for 10 min and bricked every cascade
// member (the breaker keyed every SKU under one provider string).
function breakerKeys(m: LanguageModel): { family: string; model: string } {
  const x = m as { provider?: string; modelId?: string };
  const model = x.modelId ?? x.provider ?? "unknown";
  const provRaw =
    x.provider ?? (x.modelId?.includes("/") ? x.modelId.split("/")[0] : x.modelId) ?? "unknown";
  const family = provRaw.split(".")[0];
  return { family, model };
}

// A candidate is "cool" (skip it) when EITHER its family or its specific
// model id is currently shelved.
function isModelCool(m: LanguageModel): boolean {
  const { family, model } = breakerKeys(m);
  return isProviderCool(family) || isProviderCool(model);
}
export { breakerKeys, isModelCool };

export function isProviderCool(provider: string): boolean {
  const t = COOLDOWN.get(provider);
  if (t == null) return false;
  if (t > Date.now()) return true;
  COOLDOWN.delete(provider);
  return false;
}

export function shelveProvider(provider: string, ms = COOLDOWN_MS): void {
  COOLDOWN.set(provider, Date.now() + ms);
}

// Try `primary` first; on rate_limited shelve the provider and walk through
// `fallbacks` until one succeeds. Returns first successful parse or throws
// sanitized error after exhausting list. Use this anywhere quota matters
// (run / coordinator / build-app / cohort).
export async function generateJsonWithFallback<T>(args: {
  primary: LanguageModel;
  fallbacks: LanguageModel[];
  schema: z.ZodType<T>;
  prompt: string;
  temperature?: number;
  maxRetries?: number;
  onUsage?: (u: LLMUsage) => void;
  // Caller-supplied abort (e.g. a build/file timeout). When it fires we stop
  // walking the cascade so a dead request can't keep burning provider quota.
  abortSignal?: AbortSignal;
  // Per-provider-call ceiling. Defaults to PER_CALL_TIMEOUT_MS inside
  // generateJson; pass a tighter value for latency-sensitive routes.
  timeoutMs?: number;
}): Promise<T> {
  const candidates = [args.primary, ...args.fallbacks];
  let lastErr = "all_providers_failed";
  for (const m of candidates) {
    if (args.abortSignal?.aborted) throw new Error("timeout");
    if (isModelCool(m)) continue;
    const { family, model } = breakerKeys(m);
    try {
      return await generateJson({
        model: m,
        schema: args.schema,
        prompt: args.prompt,
        temperature: args.temperature,
        maxRetries: args.maxRetries ?? 2, // tighter per-provider since we have fallbacks
        onUsage: args.onUsage,
        abortSignal: args.abortSignal,
        timeoutMs: args.timeoutMs,
      });
    } catch (e) {
      const msg = (e as Error).message;
      lastErr = sanitizeProviderError(msg);
      // Aborted mid-call — bail now instead of trying the next provider (which
      // would instantly reject on the same already-aborted signal) and Bytez.
      if (args.abortSignal?.aborted) throw new Error("timeout");
      // Shelve so SUBSEQUENT requests skip it. `rate_limited` is account-wide
      // quota exhaustion (shared across a provider's SKUs) → shelve the whole
      // FAMILY long. EVERY other failure — timeout / 5xx / network / the
      // catch-all `upstream_error` — shelves only THIS model id short, so (a) a
      // momentary blip on one SKU can't brick its siblings, and (b) an unmapped
      // error still triggers a backoff instead of being retried first forever.
      if (lastErr === "rate_limited") shelveProvider(family);
      else shelveProvider(model, SHORT_COOLDOWN_MS);
      // Walk to the next provider on any failure (the for-loop continues).
      continue;
    }
  }
  // ─── Tertiary fallback · Bytez ────────────────────────────────────────
  // After Mistral + Gemini + Groq are all exhausted, try Bytez. Only
  // engaged when BYTEZ_API_KEY is set. Bytez may 404 if the model isn't
  // in our account's catalog — that's a soft skip, not an error. If it
  // returns a non-empty string we attempt to extract JSON from it the
  // same way generateJson does.
  if (bytezAvailable() && !args.abortSignal?.aborted) {
    const sys = "Respond ONLY with a single JSON object. No prose, no markdown fences, no tool calls, no commentary.";
    const fullPrompt = `${args.prompt}\n\nReturn ONLY a valid JSON object.`;
    const bytezMessages: BytezMessage[] = [
      { role: "system", content: sys },
      { role: "user", content: fullPrompt },
    ];
    const bz = await bytezChat({
      messages: bytezMessages,
      temperature: args.temperature ?? 0.2,
      maxLength: 800,
      timeoutMs: 22_000,
    });
    if (bz.ok && bz.text) {
      const json = extractJson(bz.text);
      if (json) {
        try {
          const obj = JSON.parse(json);
          const parsed = args.schema.safeParse(obj);
          if (parsed.success) {
            if (args.onUsage) {
              args.onUsage({ model: `bytez:${bz.modelId}`, promptTokens: 0, completionTokens: 0, ms: bz.ms });
            }
            return parsed.data;
          }
        } catch {}
      }
      lastErr = "bytez_invalid_json";
    } else if (bz.reason) {
      lastErr = `bytez_${bz.reason}`;
    }
  }
  throw new Error(`all_providers_failed (${lastErr})`);
}

export async function generateJson<T>(args: {
  model: LanguageModel;
  schema: z.ZodType<T>;
  prompt: string;
  temperature?: number;
  maxRetries?: number;
  onUsage?: (u: LLMUsage) => void;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
}): Promise<T> {
  const sys =
    "Respond ONLY with a single JSON object. No prose, no markdown fences, no tool calls, no commentary.";
  const fullPrompt = `${args.prompt}\n\nReturn ONLY a valid JSON object.`;
  const attempts = args.maxRetries ?? 3;
  let lastErr = "";
  for (let i = 0; i < attempts; i++) {
    let text = "";
    // Fresh per-attempt budget: caller's abort merged with an internal ceiling.
    const merged = mergeAbort(args.abortSignal, args.timeoutMs ?? PER_CALL_TIMEOUT_MS);
    try {
      const t0 = Date.now();
      const result = await generateText({
        model: args.model,
        system: sys,
        prompt: i === 0 ? fullPrompt : `${fullPrompt}\n\nPrevious attempt failed: ${lastErr}. Strict JSON ONLY.`,
        temperature: args.temperature ?? 0.2,
        abortSignal: merged.signal,
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
      // Sanitize upstream provider errors before propagating — Groq + others
      // leak org IDs, billing URLs, and rate-limit internals. Compress to a
      // short reason code per common case so the QA-surfaced "information
      // disclosure" finding is closed.
      lastErr = sanitizeProviderError((e as Error).message);
      // Caller's own abort fired (their deadline) — propagate as timeout.
      if (args.abortSignal?.aborted) throw new Error("timeout");
      // OUR per-call ceiling fired: this provider is hung. Re-prompting the same
      // one won't help and just burns the budget — bail so the cascade fails
      // over to the next provider.
      if (merged.timedOut()) throw new Error("timeout");
      // Hard provider errors (bad/expired key, exhausted quota) will NOT recover
      // by re-prompting the SAME provider — retrying just adds latency before the
      // caller's fallback chain can switch providers. Bail immediately for those;
      // keep retrying only transient/parse failures where the re-prompt helps.
      if (lastErr === "auth_failed" || lastErr === "rate_limited") {
        throw new Error(lastErr);
      }
      continue;
    } finally {
      merged.cleanup();
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
      // Squash multi-line Zod blobs into a single readable line so error
      // events shown to users never look like raw stack traces.
      const issue = parsed.error.issues?.[0];
      lastErr = issue
        ? `${issue.message} (at \`${issue.path.join(".") || "root"}\`)`
        : "schema mismatch";
    } catch (e) {
      lastErr = `invalid JSON: ${(e as Error).message.slice(0, 120)}`;
    }
  }
  // User-facing message. Keep concise — Terminal / Builder render this directly.
  throw new Error(`Model returned malformed output after ${attempts} attempts (${lastErr}). Retry or switch model in Settings.`);
}

// Strip org IDs, billing URLs, internal request IDs from provider error
// messages so DelOS responses never leak upstream-provider account info.
function sanitizeProviderError(msg: string): string {
  let s = String(msg || "");
  // Idempotent · if the message is ALREADY one of our reason codes (e.g. it was
  // sanitized once inside generateJson, then re-sanitized by the fallback layer),
  // return it unchanged. Without this, "auth_failed" fails the 401/403 regex
  // below and gets misclassified as "upstream_error", and a re-thrown
  // "rate_limited" would stop triggering the provider cooldown.
  if (/^(rate_limited|timeout|auth_failed|upstream_5xx|network_error|upstream_error)$/.test(s)) return s;
  s = s.replace(/org_[a-z0-9]{20,}/gi, "<org>");
  s = s.replace(/req_[a-z0-9_]{8,}/gi, "<req>");
  s = s.replace(/https?:\/\/console\.[^\s)\]]+/gi, "<upgrade-url>");
  s = s.replace(/in organization `[^`]*`/gi, "");
  s = s.replace(/service tier `[^`]*`/gi, "");
  // Re-extract the human-relevant signal · NEVER leak the upstream retry-
  // window, model name, or token counts. Just a stable enum the UI can map.
  if (/rate.limit|TPD|TPM|RPM|quota/i.test(s)) return "rate_limited";
  if (/timeout|aborted/i.test(s)) return "timeout";
  if (/401|403|forbidden|unauthorized|invalid.api/i.test(s)) return "auth_failed";
  if (/5\d\d|service.unavailable|bad.gateway/i.test(s)) return "upstream_5xx";
  if (/network|fetch|ENOTFOUND|ECONNREFUSED/i.test(s)) return "network_error";
  // Last-resort fallback · short enough that no internals leak.
  return "upstream_error";
}

export { sanitizeProviderError };
