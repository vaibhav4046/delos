export type ModelKey =
  | "groq:openai/gpt-oss-120b"
  | "groq:openai/gpt-oss-20b"
  | "groq:meta-llama/llama-4-scout-17b-16e-instruct"
  | "groq:meta-llama/llama-4-maverick-17b-128e-instruct"
  | "groq:moonshotai/kimi-k2-instruct-0905"
  | "mistral:mistral-large-latest"
  | "mistral:mistral-small-latest"
  | "google:gemini-2.5-flash"
  | "google:gemini-2.5-pro";

export const DEFAULTS: Record<"planner" | "executor" | "critic", ModelKey> = {
  planner: "groq:openai/gpt-oss-120b",
  executor: "groq:openai/gpt-oss-20b",
  // Critic defaults to fast Groq for sub-second drift scoring.
  // Orchestrator escalates to Mistral on initial drift > 0.4 (second-opinion path).
  critic: "groq:openai/gpt-oss-20b",
};

export const MODEL_CATALOG: Array<{ key: ModelKey; provider: string; label: string; ctx: string; tag: "fast" | "smart" | "balanced" }> = [
  { key: "groq:openai/gpt-oss-120b", provider: "Groq", label: "GPT-OSS 120B", ctx: "131K", tag: "smart" },
  { key: "groq:openai/gpt-oss-20b", provider: "Groq", label: "GPT-OSS 20B", ctx: "131K", tag: "fast" },
  { key: "groq:meta-llama/llama-4-scout-17b-16e-instruct", provider: "Groq", label: "Llama 4 Scout 17B", ctx: "128K", tag: "balanced" },
  { key: "groq:meta-llama/llama-4-maverick-17b-128e-instruct", provider: "Groq", label: "Llama 4 Maverick 17B", ctx: "1M", tag: "smart" },
  { key: "groq:moonshotai/kimi-k2-instruct-0905", provider: "Groq", label: "Kimi K2", ctx: "262K", tag: "smart" },
  { key: "mistral:mistral-large-latest", provider: "Mistral", label: "Mistral Large", ctx: "128K", tag: "smart" },
  { key: "mistral:mistral-small-latest", provider: "Mistral", label: "Mistral Small", ctx: "32K", tag: "fast" },
  { key: "google:gemini-2.5-flash", provider: "Google", label: "Gemini 2.5 Flash", ctx: "1M", tag: "balanced" },
  { key: "google:gemini-2.5-pro", provider: "Google", label: "Gemini 2.5 Pro", ctx: "2M", tag: "smart" },
];

export const MODEL_KEYS: ModelKey[] = MODEL_CATALOG.map((m) => m.key);

export type ModelOverrides = Partial<Record<"planner" | "executor" | "critic", ModelKey>>;
