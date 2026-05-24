import { env } from "@/lib/env";

// Real brand-routed chat. If ANTHROPIC_API_KEY set, /api/brand-chat?brand=claude hits Claude.
// If OPENAI_API_KEY set, brand=chatgpt hits GPT. Falls back to 503 otherwise so caller can use /api/chat.

export const runtime = "nodejs";

type Msg = { role: "user" | "assistant" | "system"; content: string };

async function callAnthropic(messages: Msg[], model: string, systemPrompt: string): Promise<string> {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages.filter((m) => m.role !== "system"),
    }),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${await r.text().catch(() => "")}`);
  const j = (await r.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = (j.content ?? []).map((c) => c.text ?? "").join("");
  return text;
}

async function callOpenAI(messages: Msg[], model: string): Promise<string> {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages,
    }),
  });
  if (!r.ok) throw new Error(`openai ${r.status}: ${await r.text().catch(() => "")}`);
  const j = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return j.choices?.[0]?.message?.content ?? "";
}

export async function POST(req: Request) {
  try {
    const { brand, messages, systemPrompt, model } = (await req.json()) as {
      brand: "claude" | "chatgpt";
      messages: Msg[];
      systemPrompt?: string;
      model?: string;
    };

    if (brand === "claude") {
      if (!env.ANTHROPIC_API_KEY) {
        return Response.json({ ok: false, reason: "no-key", text: "" }, { status: 503 });
      }
      const m = model ?? "claude-3-5-haiku-20241022";
      const text = await callAnthropic(messages, m, systemPrompt ?? "You are Claude.");
      return Response.json({ ok: true, text, real: true, provider: "anthropic", model: m });
    }
    if (brand === "chatgpt") {
      if (!env.OPENAI_API_KEY) {
        return Response.json({ ok: false, reason: "no-key", text: "" }, { status: 503 });
      }
      const m = model ?? "gpt-4o-mini";
      const sys = systemPrompt ? [{ role: "system" as const, content: systemPrompt }, ...messages] : messages;
      const text = await callOpenAI(sys, m);
      return Response.json({ ok: true, text, real: true, provider: "openai", model: m });
    }
    return Response.json({ ok: false, reason: "unknown-brand" }, { status: 400 });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

// GET — capability probe so client knows which brands are real
export async function GET() {
  return Response.json({
    claude: !!env.ANTHROPIC_API_KEY,
    chatgpt: !!env.OPENAI_API_KEY,
  });
}
