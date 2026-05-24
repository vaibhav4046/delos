// BYOK · round-trip the saved key against the provider's models endpoint
// to verify it's live. Updates lastVerified in the key bag on success.

import { NextRequest } from "next/server";
import { resolveTenant } from "@/lib/apiAuth";
import { getKeyForRole, markVerified, PROVIDERS, type ProviderId } from "@/lib/keyBag";

export const runtime = "nodejs";

const PROBE_URLS: Record<ProviderId, string> = {
  groq: "https://api.groq.com/openai/v1/models",
  mistral: "https://api.mistral.ai/v1/models",
  gemini: "https://generativelanguage.googleapis.com/v1beta/models",
  openai: "https://api.openai.com/v1/models",
  anthropic: "https://api.anthropic.com/v1/models",
  together: "https://api.together.xyz/v1/models",
  openrouter: "https://openrouter.ai/api/v1/models",
  // OpenAI-compatible endpoints — Bearer auth + /v1/models GET works on all.
  cerebras: "https://api.cerebras.ai/v1/models",
  deepinfra: "https://api.deepinfra.com/v1/openai/models",
  hyperbolic: "https://api.hyperbolic.xyz/v1/models",
  fireworks: "https://api.fireworks.ai/inference/v1/models",
};

function authHeader(provider: ProviderId, key: string): Record<string, string> {
  if (provider === "gemini") return { "x-goog-api-key": key };
  if (provider === "anthropic") return { "x-api-key": key, "anthropic-version": "2023-06-01" };
  return { Authorization: `Bearer ${key}` };
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider: pRaw } = await ctx.params;
  const provider = pRaw as ProviderId;
  if (!PROVIDERS.includes(provider)) {
    return Response.json({ ok: false, reason: "unknown_provider" }, { status: 400 });
  }
  const { tenantId } = await resolveTenant(req);
  // Allow caller to pass a one-off key in body for first-time test, OR
  // use the saved key from the bag.
  const body = await req.json().catch(() => ({})) as { key?: string };
  const key = body.key ?? getKeyForRole(tenantId, provider, "planner") ?? getKeyForRole(tenantId, provider, "executor");
  if (!key) {
    return Response.json({ ok: false, reason: "no_key_saved" }, { status: 404 });
  }
  try {
    const r = await fetch(PROBE_URLS[provider], {
      headers: authHeader(provider, key),
    });
    if (r.ok) {
      markVerified(tenantId, provider);
      return Response.json({ ok: true, provider, verifiedAt: Date.now() });
    }
    if (r.status === 401 || r.status === 403) {
      return Response.json({ ok: false, reason: "invalid_key", status: r.status }, { status: 401 });
    }
    return Response.json({ ok: false, reason: "upstream_error", status: r.status }, { status: 502 });
  } catch (e) {
    return Response.json({ ok: false, reason: "network_error", error: String((e as Error).message) }, { status: 502 });
  }
}
