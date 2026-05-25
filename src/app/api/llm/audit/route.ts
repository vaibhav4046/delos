// R5-C · /api/llm/audit · probes every registered model with a 1-token
// "reply OK" trial. Caches result for 15 minutes so heavy traffic doesn't
// spam upstream providers. Model picker filters out ok:false rows.
import { NextRequest } from "next/server";
import { resolveModel } from "@/lib/llm";
import { runQuickAgent } from "@/lib/agents/quick";
import { isNimEnabled, nimChat, NIM_MODELS } from "@/lib/llm/providers/nim";

export const runtime = "nodejs";
export const maxDuration = 60;

const G = globalThis as unknown as {
  __delos_llm_audit?: { at: number; results: Array<{ model: string; ok: boolean; ms: number; err?: string; missingKey?: boolean }> };
};

const AUDIT_TTL_MS = 15 * 60_000;

const MODELS_TO_AUDIT = [
  "groq:openai/gpt-oss-120b",
  "groq:openai/gpt-oss-20b",
  "groq:meta-llama/llama-4-maverick-17b-128e-instruct",
  "groq:moonshotai/kimi-k2-instruct-0905",
  "mistral:mistral-large-latest",
  "google:gemini-2.5-flash",
];

// Map a provider prefix to the env var that holds its key. Used to give
// callers an explicit "missing_key" signal instead of a generic timeout/
// 401 string. QA P5 — was indistinguishable from "provider is down".
function envKeyFor(model: string): string | null {
  if (model.startsWith("groq:")) return "GROQ_API_KEY";
  if (model.startsWith("mistral:")) return "MISTRAL_API_KEY";
  if (model.startsWith("google:")) return "GOOGLE_GENERATIVE_AI_API_KEY";
  if (model.startsWith("nim:")) return "NIM_API_KEY";
  return null;
}

async function probeModel(
  model: string,
): Promise<{ ok: boolean; ms: number; err?: string; missingKey?: boolean }> {
  const t0 = Date.now();
  const keyName = envKeyFor(model);
  if (keyName && !process.env[keyName]) {
    // No key configured · short-circuit. Callers regex-sniffed the err
    // string before — now there's a structured signal.
    return { ok: false, ms: 0, err: `missing_key:${keyName}`, missingKey: true };
  }
  try {
    if (model.startsWith("nim:")) {
      const m = model.slice(4);
      const r = await nimChat({
        model: m,
        messages: [{ role: "user", content: "Reply with exactly: OK" }],
        max_tokens: 8,
        temperature: 0,
      });
      return { ok: /ok/i.test(r.text), ms: Date.now() - t0 };
    }
    // Standard providers via withModels override · use runQuickAgent
    // with disableFallback so each row reports its OWN provider error
    // instead of cascading down to the Bytez tertiary and showing
    // bytez_not_in_catalog under every supposedly-working model.
    const { withModels } = await import("@/lib/llm");
    const text = await withModels({ executor: model as Parameters<typeof resolveModel>[0] }, () =>
      runQuickAgent({ prompt: "Reply with exactly: OK", disableFallback: true }),
    );
    return { ok: /ok/i.test(text), ms: Date.now() - t0 };
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120);
    // 401 / 403 / "API key" responses also count as missing/bad key so the
    // operator sees a clear "fix the credential" signal in the audit row.
    const looksMissing = /\b(401|403|api[ _]?key|unauthorized|invalid[_ ]key)\b/i.test(msg);
    return { ok: false, ms: Date.now() - t0, err: msg, ...(looksMissing ? { missingKey: true } : {}) };
  }
}

export async function GET(req: NextRequest) {
  const force = req.nextUrl.searchParams.get("force") === "1";
  const cached = G.__delos_llm_audit;
  if (!force && cached && Date.now() - cached.at < AUDIT_TTL_MS) {
    return Response.json({ ok: true, cachedAt: cached.at, results: cached.results });
  }
  const targets = [...MODELS_TO_AUDIT];
  if (isNimEnabled()) {
    targets.push(`nim:${NIM_MODELS.nemotronSuper49b}`);
    targets.push(`nim:${NIM_MODELS.llama33_70b}`);
  }
  const results: Array<{ model: string; ok: boolean; ms: number; err?: string; missingKey?: boolean }> = [];
  // Sequential audit so we don't burst all providers · keeps latency under 30s.
  for (const model of targets) {
    const out = await probeModel(model);
    results.push({ model, ...out });
  }
  G.__delos_llm_audit = { at: Date.now(), results };
  return Response.json({
    ok: true,
    cachedAt: Date.now(),
    results,
    // P0 · expose healthy/unhealthy split so cohort + model picker can
    // route around dead providers automatically. Callers should prefer
    // `healthy` over MODELS_TO_AUDIT.
    healthy: results.filter((r) => r.ok).map((r) => r.model),
    unhealthy: results.filter((r) => !r.ok).map((r) => ({ model: r.model, err: r.err, missingKey: r.missingKey })),
  });
}

// P0 · cohort + browse-agent + extension call this to drop dead providers
// before spawning members. Cache-respecting · returns the most recent audit
// without re-probing. If no audit ran yet, returns the full target list so
// the first call doesn't fail.
export function getHealthyModelsSync(): string[] | null {
  const cached = G.__delos_llm_audit;
  if (!cached || Date.now() - cached.at > AUDIT_TTL_MS) return null;
  return cached.results.filter((r) => r.ok).map((r) => r.model);
}

export async function POST() {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
}
