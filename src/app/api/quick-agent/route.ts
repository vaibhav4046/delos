import { NextRequest } from "next/server";
import { z } from "zod";
import { runQuickAgent } from "@/lib/agents/quick";
import { withModels, withTemperature, type ModelOverrides, type ModelKey } from "@/lib/llm";
import { rateLimit, clientIp } from "@/lib/rateLimit";

import { zodErr } from "@/lib/apiAuth";
export const runtime = "nodejs";
export const maxDuration = 30;

const QUICK_LIMIT_PER_MIN = 15;
const QUICK_WINDOW_MS = 60_000;

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

// Prompt cap raised from 1200 → 8000. CoworkApp's compile pass joins 4-6
// step results plus a system block and was hitting 400s once goals had any
// research depth, killing the final "★ OUTPUT" render on the hackathon demo.
const bodySchema = z.object({
  prompt: z.string().min(2).max(8000),
  models: z.object({ planner: modelKey, executor: modelKey, critic: modelKey }).partial().optional(),
  temperature: z.number().min(0).max(1.5).optional(),
  identity: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const lim = rateLimit(`quickagent:ip:${ip}`, QUICK_LIMIT_PER_MIN, QUICK_WINDOW_MS);
  if (!lim.ok) {
    return Response.json(
      { error: "Too many quick-agent requests. Try again shortly." },
      { status: 429, headers: lim.headers },
    );
  }
  // B12 · accept `input` (canonical) or legacy `prompt`.
  const rawBody = await req.json().catch(() => ({}));
  const normalized = (() => {
    const obj = rawBody && typeof rawBody === "object" ? (rawBody as Record<string, unknown>) : {};
    if (typeof obj.input === "string" && !obj.prompt) obj.prompt = obj.input;
    return obj;
  })();
  const parsed = bodySchema.safeParse(normalized);
  if (!parsed.success) {
    return zodErr(parsed.error);
  }
  const overrides: ModelOverrides | undefined = parsed.data.models
    ? Object.fromEntries(Object.entries(parsed.data.models).filter(([, v]) => v) as Array<[string, ModelKey]>)
    : undefined;
  try {
    const sysOverride = parsed.data.identity
      ? `You are DelOS Quick Agent. Apply the user identity profile to EVERY output (tone, format, banned terms).\n\n${parsed.data.identity}\n\nReply in 1-4 sentences. No filler. No 'I think', no caveats.`
      : undefined;
    const text = await withModels(overrides, () => withTemperature(parsed.data.temperature, () => runQuickAgent({ prompt: parsed.data.prompt, systemOverride: sysOverride })));
    // B16 · truthful counter headers. Approximate from char-counts since
    // runQuickAgent doesn't surface model usage directly. Conservative
    // tokens-per-char of 4. Better than zero so the top bar advances.
    const tokIn = Math.max(1, Math.ceil(parsed.data.prompt.length / 4));
    const tokOut = Math.max(1, Math.ceil((text ?? "").length / 4));
    return new Response(JSON.stringify({ text }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "X-Tok-In": String(tokIn),
        "X-Tok-Out": String(tokOut),
        "X-Cost-Usd": String((tokIn + tokOut) * 0.000001),
      },
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
}
