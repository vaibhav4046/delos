// OpenRouter · provider client.
// Used as a wide-coverage fallback after Groq when the planner needs more
// brain than the small models can offer. OpenRouter routes to ~100 models;
// we pick a strong default and keep latency reasonable.
//
// BYOK supported · callers pass a user key (e.g. from Settings) and it
// takes precedence over the server env. Per-request override means hackathon
// judges can paste their own key and run unlimited demos without us paying.

const OPENROUTER_BASE = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
const ENV_KEY = process.env.OPENROUTER_API_KEY;

export function isOpenRouterEnabled(userKey?: string | null): boolean {
  const k = userKey || ENV_KEY;
  return Boolean(k && k.startsWith("sk-or-"));
}

export const OPENROUTER_MODELS = {
  // Mid-cost · fast · strong reasoning · good default for planning tasks.
  qwen3Coder: "qwen/qwen-3-coder",
  // Big brain for hard plans.
  deepseekR1: "deepseek/deepseek-r1",
  // Cheap + fast for quick replies.
  llama33: "meta-llama/llama-3.3-70b-instruct",
  // Multimodal fallback.
  gemini2Flash: "google/gemini-2.0-flash-001",
  // Default everything-else.
  defaultPlan: "anthropic/claude-3.5-sonnet",
} as const;

type Msg = { role: "system" | "user" | "assistant"; content: string };

type ChatArgs = {
  model: string;
  messages: Msg[];
  temperature?: number;
  max_tokens?: number;
  userKey?: string | null;
};

export async function openRouterChat(args: ChatArgs): Promise<{ text: string; model: string }> {
  const key = args.userKey || ENV_KEY;
  if (!key) throw new Error("openrouter_disabled · no API key");

  const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      // Identification headers · OpenRouter rate limits per-app friendlier
      // when these are present. Won't break if removed.
      "HTTP-Referer": "https://delrio.vercel.app",
      "X-Title": "DelOS",
    },
    body: JSON.stringify({
      model: args.model,
      messages: args.messages,
      temperature: args.temperature ?? 0.3,
      max_tokens: args.max_tokens ?? 1200,
    }),
  });

  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`openrouter_${r.status}: ${detail.slice(0, 200)}`);
  }
  const j = (await r.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
  };
  const text = j.choices?.[0]?.message?.content ?? "";
  return { text, model: j.model ?? args.model };
}
