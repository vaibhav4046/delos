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

// ─── Provider circuit breaker ──────────────────────────────────────────────
// In-process map of provider → cooldown-until timestamp. When a provider 429s
// we shelve it for COOLDOWN_MS so subsequent calls skip straight to the
// fallback list instead of re-burning quota that we already know is exhausted.
// Plain Map is fine — Vercel Lambdas live ~5 min, longer than the cooldown
// we want, so the state stays warm across requests in the same container.
const COOLDOWN: Map<string, number> = new Map();
const COOLDOWN_MS = 10 * 60_000; // 10 minutes

function modelProvider(m: LanguageModel): string {
  const x = m as { provider?: string; modelId?: string };
  if (x.provider) return x.provider;
  const id = x.modelId ?? "";
  // Convention from llm.ts: providers prefix model ids as "groq:..." etc.
  const sep = id.indexOf("/");
  return sep > 0 ? id.slice(0, sep) : id;
}

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
}): Promise<T> {
  const candidates = [args.primary, ...args.fallbacks];
  let lastErr = "all_providers_failed";
  for (const m of candidates) {
    const provider = modelProvider(m);
    if (isProviderCool(provider)) continue;
    try {
      return await generateJson({
        model: m,
        schema: args.schema,
        prompt: args.prompt,
        temperature: args.temperature,
        maxRetries: args.maxRetries ?? 2, // tighter per-provider since we have fallbacks
        onUsage: args.onUsage,
      });
    } catch (e) {
      const msg = (e as Error).message;
      lastErr = sanitizeProviderError(msg);
      if (lastErr === "rate_limited") shelveProvider(provider);
      // Continue to next provider on rate_limited / upstream_5xx / timeout.
      if (lastErr === "auth_failed" || lastErr === "network_error") continue;
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
      // Sanitize upstream provider errors before propagating — Groq + others
      // leak org IDs, billing URLs, and rate-limit internals. Compress to a
      // short reason code per common case so the QA-surfaced "information
      // disclosure" finding is closed.
      lastErr = sanitizeProviderError((e as Error).message);
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
