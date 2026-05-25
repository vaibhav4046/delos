// NVIDIA NIM (build.nvidia.com inference) · provider client.
// Used by cohort godMode, critic preferred path, and codegen LLM fallback
// when no playbook matches.

const NIM_BASE = process.env.NIM_BASE_URL ?? "https://integrate.api.nvidia.com/v1";
const KEY = process.env.NVIDIA_NIM_API_KEY;

export function isNimEnabled(): boolean {
  return Boolean(KEY && KEY.startsWith("nvapi-"));
}

// Model registry · verified live against build.nvidia.com 2026-05-25
export const NIM_MODELS = {
  nemotronSuper49b: "nvidia/llama-3.3-nemotron-super-49b-v1",
  llama33_70b: "meta/llama-3.3-70b-instruct",
  llama4Maverick: "meta/llama-4-maverick-17b-128e-instruct",
  mistralLarge3: "mistralai/mistral-large-3-675b-instruct-2512",
  mistralLarge2: "mistralai/mistral-large-2-instruct",
  deepseekV4Pro: "deepseek-ai/deepseek-v4-pro",
  phi4Multi: "microsoft/phi-4-multimodal-instruct",
} as const;

type Msg = { role: "system" | "user" | "assistant"; content: string };
type ChatArgs = {
  model: string;
  messages: Msg[];
  temperature?: number;
  max_tokens?: number;
  signal?: AbortSignal;
};

export type NimChatResult = {
  text: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  raw?: unknown;
};

export async function nimChat(a: ChatArgs): Promise<NimChatResult> {
  if (!isNimEnabled()) throw new Error("NIM_NOT_ENABLED");
  const r = await fetch(`${NIM_BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: a.model,
      messages: a.messages,
      temperature: a.temperature ?? 0.2,
      max_tokens: a.max_tokens ?? 512,
      stream: false,
    }),
    signal: a.signal,
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`nim_http_${r.status}: ${body.slice(0, 200)}`);
  }
  const j = (await r.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    text: j?.choices?.[0]?.message?.content ?? "",
    usage: j?.usage,
    raw: j,
  };
}

export async function* nimChatStream(a: ChatArgs): AsyncGenerator<string> {
  if (!isNimEnabled()) throw new Error("NIM_NOT_ENABLED");
  const r = await fetch(`${NIM_BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: a.model,
      messages: a.messages,
      temperature: a.temperature ?? 0.2,
      max_tokens: a.max_tokens ?? 512,
      stream: true,
    }),
    signal: a.signal,
  });
  if (!r.ok || !r.body) throw new Error(`nim_stream_${r.status}`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const m = line.match(/^data:\s*(.*)$/);
      if (!m || m[1] === "[DONE]") continue;
      try {
        const d = JSON.parse(m[1]) as { choices?: Array<{ delta?: { content?: string } }> };
        const tok = d?.choices?.[0]?.delta?.content;
        if (tok) yield tok;
      } catch {
        // ignore malformed SSE chunks
      }
    }
  }
}
