import { NextRequest } from "next/server";
import { z } from "zod";
import { buildAppFromPrompt } from "@/lib/agents/appBuilder";
import { safeAddMemory } from "@/lib/hydra";
import { env } from "@/lib/env";
import { withModels, type ModelOverrides, type ModelKey } from "@/lib/llm";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUILD_LIMIT_PER_MIN = 8;
const BUILD_WINDOW_MS = 60_000;

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
  prompt: z.string().min(3).max(800),
  models: z.object({ planner: modelKey, executor: modelKey, critic: modelKey }).partial().optional(),
  tenantId: z.string().min(1).max(120).optional(),
});

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const lim = rateLimit(`buildapp:ip:${ip}`, BUILD_LIMIT_PER_MIN, BUILD_WINDOW_MS);
  if (!lim.ok) {
    return Response.json(
      { error: "Too many build-app requests. Try again shortly." },
      { status: 429, headers: lim.headers },
    );
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  const overrides: ModelOverrides | undefined = parsed.data.models
    ? Object.fromEntries(Object.entries(parsed.data.models).filter(([, v]) => v) as Array<[string, ModelKey]>)
    : undefined;
  const tenantId = parsed.data.tenantId || env.DELRIO_TENANT_ID;
  try {
    const spec = await withModels(overrides, () => buildAppFromPrompt(parsed.data.prompt));
    await safeAddMemory({
      tenantId,
      text: `Built DelOS app "${spec.name}" from prompt: ${parsed.data.prompt.slice(0, 120)}`,
      metadata: { runId: "app-builder", tags: ["app-build"], appId: spec.id },
    });
    return Response.json({ spec });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
