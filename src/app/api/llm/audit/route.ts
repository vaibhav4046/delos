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
  __delos_llm_audit?: { at: number; results: Array<{ model: string; ok: boolean; ms: number; err?: string }> };
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

async function probeModel(model: string): Promise<{ ok: boolean; ms: number; err?: string }> {
  const t0 = Date.now();
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
    const { withModels } = await import("@/lib/llm");
    const text = await withModels({ executor: model as Parameters<typeof resolveModel>[0] }, () =>
      runQuickAgent({ prompt: "Reply with exactly: OK" }),
    );
    return { ok: /ok/i.test(text), ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, err: e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120) };
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
  const results: Array<{ model: string; ok: boolean; ms: number; err?: string }> = [];
  // Sequential audit so we don't burst all providers · keeps latency under 30s.
  for (const model of targets) {
    const out = await probeModel(model);
    results.push({ model, ...out });
  }
  G.__delos_llm_audit = { at: Date.now(), results };
  return Response.json({ ok: true, cachedAt: Date.now(), results });
}

export async function POST() {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
}
