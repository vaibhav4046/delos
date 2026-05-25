import "server-only";
import { env } from "./env";

// ─── Bytez chat adapter ─────────────────────────────────────────────────
// Bytez exposes a unified REST surface over 175k+ open- and closed-source
// models. We use it as a TERTIARY fallback when both Mistral and Gemini
// quotas are exhausted (and historically the Groq free tier is dry by
// late afternoon). Endpoint:
//
//   POST https://api.bytez.com/models/v2/<modelId>
//   Authorization: <BYTEZ_API_KEY>
//   Content-Type: application/json
//   { "messages": [...], "params": { temperature, max_length } }
//
// Response: { "error": string|null, "output": string | { content: string } | array }
//
// The catalog can return a 404 "Model does not exist or has yet to be
// added" if the model id is not currently provisioned for the calling
// account. Caller code (jsonGen, quick.ts) treats that as a soft skip
// — we just fall through to the next provider rather than throwing.

export type BytezMessage = { role: "system" | "user" | "assistant"; content: string };

export type BytezOptions = {
  modelId?: string;
  messages: BytezMessage[];
  temperature?: number;
  maxLength?: number;
  timeoutMs?: number;
  apiKeyOverride?: string;
};

export type BytezResult = {
  ok: boolean;
  text: string;
  ms: number;
  modelId: string;
  // Stable reason codes for the caller-side fallback logic.
  // not_configured → BYTEZ_API_KEY missing entirely.
  // not_in_catalog → 404, model not provisioned for this key.
  // rate_limited / timeout / network_error / auth_failed / upstream_error
  reason?:
    | "not_configured"
    | "not_in_catalog"
    | "rate_limited"
    | "timeout"
    | "auth_failed"
    | "network_error"
    | "upstream_error"
    | "empty_response";
};

const HOST = "https://api.bytez.com/models/v2";

export function bytezAvailable(): boolean {
  return !!env.BYTEZ_API_KEY;
}

export async function bytezChat(opts: BytezOptions): Promise<BytezResult> {
  const t0 = Date.now();
  const modelId = opts.modelId || env.BYTEZ_DEFAULT_MODEL;
  const apiKey = opts.apiKeyOverride || env.BYTEZ_API_KEY;
  if (!apiKey) {
    return { ok: false, text: "", ms: 0, modelId, reason: "not_configured" };
  }

  const body: Record<string, unknown> = { messages: opts.messages };
  if (opts.temperature !== undefined || opts.maxLength !== undefined) {
    body.params = {
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.maxLength !== undefined ? { max_length: opts.maxLength } : {}),
    };
  }

  const timeout = opts.timeoutMs ?? 25_000;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${HOST}/${modelId}`, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
        lang: "javascript",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const ms = Date.now() - t0;

    // 404 = model not in catalog for this key. Soft-skip — not an error.
    if (res.status === 404) {
      return { ok: false, text: "", ms, modelId, reason: "not_in_catalog" };
    }
    if (res.status === 429) {
      return { ok: false, text: "", ms, modelId, reason: "rate_limited" };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, text: "", ms, modelId, reason: "auth_failed" };
    }
    if (res.status >= 500) {
      return { ok: false, text: "", ms, modelId, reason: "upstream_error" };
    }

    const text = await res.text();
    let parsed: { error?: string | null; output?: unknown } = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      // Some endpoints stream plain text — accept that too.
      const trimmed = text.trim();
      if (trimmed.length > 0) {
        return { ok: true, text: trimmed, ms, modelId };
      }
      return { ok: false, text: "", ms, modelId, reason: "upstream_error" };
    }

    if (parsed.error) {
      const errMsg = String(parsed.error);
      if (/not.*catalog|does not exist/i.test(errMsg)) {
        return { ok: false, text: "", ms, modelId, reason: "not_in_catalog" };
      }
      if (/rate.limit|TPM|RPM|quota/i.test(errMsg)) {
        return { ok: false, text: "", ms, modelId, reason: "rate_limited" };
      }
      return { ok: false, text: "", ms, modelId, reason: "upstream_error" };
    }

    // Output shape varies: chat models return a single message-shaped
    // object; text-generation models return a string. Normalize to a
    // plain string the caller can use directly.
    const out = parsed.output;
    let answer = "";
    if (typeof out === "string") answer = out;
    else if (Array.isArray(out)) {
      // Hugging-face style: [{ generated_text: "..." }] or [{ content: "..." }]
      const first = out[0] as { generated_text?: string; content?: unknown; text?: string } | undefined;
      if (first && typeof first.generated_text === "string") answer = first.generated_text;
      else if (first && typeof first.text === "string") answer = first.text;
      else if (first && typeof first.content === "string") answer = first.content;
      else if (first && Array.isArray((first as { content?: unknown }).content)) {
        const c = (first.content as Array<{ text?: string }>)[0];
        if (c && typeof c.text === "string") answer = c.text;
      }
    } else if (out && typeof out === "object") {
      const o = out as { content?: unknown; text?: string; generated_text?: string };
      if (typeof o.generated_text === "string") answer = o.generated_text;
      else if (typeof o.text === "string") answer = o.text;
      else if (typeof o.content === "string") answer = o.content;
      else if (Array.isArray(o.content)) {
        const c = (o.content as Array<{ text?: string }>)[0];
        if (c && typeof c.text === "string") answer = c.text;
      }
    }

    answer = answer.trim();
    if (!answer) {
      return { ok: false, text: "", ms, modelId, reason: "empty_response" };
    }
    return { ok: true, text: answer, ms, modelId };
  } catch (e) {
    clearTimeout(t);
    const msg = e instanceof Error ? e.message : String(e);
    const ms = Date.now() - t0;
    if (/abort|timeout/i.test(msg)) {
      return { ok: false, text: "", ms, modelId, reason: "timeout" };
    }
    return { ok: false, text: "", ms, modelId, reason: "network_error" };
  }
}

// Synchronous health probe — checks the /list/tasks endpoint which is
// authenticated but very cheap. Used by status page + settings UI to
// confirm the BYTEZ_API_KEY is at least valid even when the catalog
// has zero deployed models for this account.
export async function bytezHealth(apiKeyOverride?: string): Promise<{
  configured: boolean;
  keyValid: boolean;
  ms: number;
  catalogReady: boolean;
}> {
  const t0 = Date.now();
  const apiKey = apiKeyOverride || env.BYTEZ_API_KEY;
  if (!apiKey) return { configured: false, keyValid: false, ms: 0, catalogReady: false };
  try {
    const res = await fetch(`${HOST}/list/tasks`, {
      method: "GET",
      headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    const ms = Date.now() - t0;
    if (!res.ok) return { configured: true, keyValid: false, ms, catalogReady: false };
    const j = (await res.json()) as { output?: unknown };
    const hasTasks = Array.isArray(j.output) && j.output.length > 0;
    return { configured: true, keyValid: hasTasks, ms, catalogReady: hasTasks };
  } catch {
    return { configured: true, keyValid: false, ms: Date.now() - t0, catalogReady: false };
  }
}
