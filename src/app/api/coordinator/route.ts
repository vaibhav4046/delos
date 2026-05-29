// Autonomous coordinator — reads desktop digest + connectors + identity from HydraDB,
// asks the LLM to propose a structured org plan. Returns JSON plan client can preview.
// Plan execution stays client-side via File System Access API (no server side fs writes).

import { z } from "zod";
import { NextRequest } from "next/server";
import { safeRecall } from "@/lib/hydra";
import { generateJsonWithFallback } from "@/lib/agents/jsonGen";
import { models, withModels, getEffectiveTemperature, withTemperature, type ModelOverrides, type ModelKey } from "@/lib/llm";

import { resolveTenant, zodErr } from "@/lib/apiAuth";
import { rateLimit, clientIp } from "@/lib/rateLimit";
export const runtime = "nodejs";
export const maxDuration = 30;

const modelKey = z
  .enum([
    "groq:openai/gpt-oss-120b",
    "groq:openai/gpt-oss-20b",
    "groq:meta-llama/llama-4-scout-17b-16e-instruct",
    "groq:meta-llama/llama-4-maverick-17b-128e-instruct",
    "groq:moonshotai/kimi-k2-instruct-0905",
    "mistral:mistral-large-latest",
    "mistral:mistral-small-latest",
    "google:gemini-2.5-flash",
    "google:gemini-2.5-pro",
  ])
  .optional();

const bodySchema = z.object({
  goal: z.string().min(3).max(400),
  tenantId: z.string().min(1).max(120).optional(),
  identity: z.string().max(2000).optional(),
  models: z.object({ planner: modelKey, executor: modelKey, critic: modelKey }).partial().optional(),
  temperature: z.number().min(0).max(1.5).optional(),
});

const actionSchema = z.object({
  kind: z.enum(["organize", "summarize", "tag", "open_app", "ingest", "notify"]),
  target: z.string().max(200).optional(),
  detail: z.string().max(400),
});

const planSchema = z.object({
  summary: z.string(),
  rationale: z.string(),
  actions: z.array(actionSchema).min(1).max(10),
});

export async function POST(req: NextRequest) {
  // M3 · paid multi-agent LLM route — per-IP throttle so an unauthenticated
  // caller can't burn provider quota / rack up cost in a loop.
  const rl = rateLimit(`coordinator:ip:${clientIp(req)}`, 10, 60_000);
  if (!rl.ok) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429, headers: rl.headers });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return zodErr(parsed.error);
  }
  const { goal, tenantId, identity, models: overrides, temperature } = parsed.data;
  // Resolve server-side · this route recalls the tenant's DESKTOP_INDEX and
  // connector-credential memory entries into the LLM prompt. Trusting a
  // body-supplied tenantId let any caller read ANOTHER tenant's private file
  // index + credentials (BOLA read). resolveTenant ignores arbitrary tenantIds.
  const { tenantId: tid } = await resolveTenant(req, { bodyTenantId: tenantId, intent: "read" });

  // Pull recent desktop index + connector credentials so the coordinator has real context.
  const ingestHits = await safeRecall({ tenantId: tid, query: "DESKTOP_INDEX root", topK: 3 });
  const credHits = await safeRecall({ tenantId: tid, query: "connector-credential", topK: 5 });
  const memCtx = [...ingestHits, ...credHits]
    .slice(0, 8)
    .map((h) => `- ${h.text.slice(0, 240)}`)
    .join("\n");

  const prompt = `You are DelOS Coordinator. The user has just signed in to a browser-OS that orchestrates AI agents.

USER IDENTITY:
${identity || "(none set — apply generic professional defaults)"}

INGESTED CONTEXT (from HydraDB recall):
${memCtx || "(no desktop index or connector credentials yet)"}

USER GOAL:
${goal}

Propose a concrete autonomous plan: 3 to 8 actions DelOS can take to satisfy the goal.
Each action has:
- kind: organize | summarize | tag | open_app | ingest | notify
- target: optional file path, app id, connector id, or tag
- detail: one sentence describing what to do and why

Return JSON only.

{
  "summary": "<one-line plan summary>",
  "rationale": "<one paragraph on why this plan fits the user's identity + context>",
  "actions": [ { "kind": "...", "target": "...", "detail": "..." } ]
}`;

  const overridesArg: ModelOverrides | undefined = overrides
    ? Object.fromEntries(Object.entries(overrides).filter(([, v]) => v) as Array<[string, ModelKey]>)
    : undefined;

  try {
    const plan = await withModels(overridesArg, () =>
      withTemperature(temperature, () =>
        generateJsonWithFallback({
          primary: models.planner,
          fallbacks: models.fallbackChain,
          schema: planSchema,
          prompt,
          temperature: getEffectiveTemperature(0.4),
        }),
      ),
    );
    return Response.json({ ok: true, plan, contextUsed: ingestHits.length + credHits.length });
  } catch (e) {
    // Sanitize upstream error before responding so we never leak provider
    // retry-windows ("retry in 12m33.408s"), org_ ids, or model billing URLs.
    // Map rate-limit to 429 instead of 500 so clients can back off correctly.
    const raw = (e as Error).message;
    const isRateLimit = /rate[_ ]?limit/i.test(raw);
    const safeError = isRateLimit
      ? "rate_limited · upstream model quota exhausted · retry shortly or switch model in Settings"
      : /timeout|aborted/i.test(raw)
        ? "upstream_timeout · try a shorter goal or different model"
        : /malformed|invalid_value|validation/i.test(raw)
          ? "spec_validation_failed · model returned unparseable JSON · try again"
          : "coordinator_error";
    return Response.json(
      { ok: false, error: safeError },
      { status: isRateLimit ? 429 : 500 },
    );
  }
}
