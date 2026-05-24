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
  // Re-extract the human-relevant signal: rate-limit / timeout / 4xx / 5xx
  if (/rate.limit|TPD|TPM|RPM/i.test(s)) {
    const wait = s.match(/try again in (\d+m?\d*\.?\d*s?)/i);
    return `rate_limited${wait ? ` · retry in ${wait[1]}` : ""}`;
  }
  if (/timeout/i.test(s)) return "timeout";
  if (/401|403|forbidden|unauthorized/i.test(s)) return "auth_failed";
  if (/5\d\d|service.unavailable|bad.gateway/i.test(s)) return "upstream_5xx";
  // Final fallback — keep first 120 chars, strip remaining URLs.
  return s.replace(/https?:\/\/\S+/g, "<url>").slice(0, 120);
}
