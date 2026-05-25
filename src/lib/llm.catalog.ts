export type ModelKey =
  | "groq:openai/gpt-oss-120b"
  | "groq:openai/gpt-oss-20b"
  | "groq:meta-llama/llama-4-scout-17b-16e-instruct"
  | "groq:meta-llama/llama-4-maverick-17b-128e-instruct"
  | "groq:moonshotai/kimi-k2-instruct-0905"
  | "mistral:mistral-large-latest"
  | "mistral:mistral-small-latest"
  | "google:gemini-2.5-flash"
  | "google:gemini-2.5-pro"
  // Bytez · unified API across 175k+ open + closed models. Tertiary
  // fallback layer; engaged only when Mistral + Gemini are exhausted.
  // Specific Bytez models are catalog-deployed per-account, so they
  // may soft-skip with "not_in_catalog" until provisioned.
  | "bytez:Qwen/Qwen3-4B"
  | "bytez:Qwen/Qwen2.5-7B-Instruct"
  | "bytez:meta-llama/Llama-3.2-3B-Instruct"
  | "bytez:google/gemma-2-9b-it";

// Production default: use the lowest-friction provider that survived live QA
// for planner/executor/critic. Groq remains selectable, but its shared
// free-tier quota was causing default runs to fail before any tool call.
export const DEFAULTS: Record<"planner" | "executor" | "critic", ModelKey> = {
  planner: "mistral:mistral-small-latest",
  executor: "mistral:mistral-small-latest",
  critic: "mistral:mistral-small-latest",
};

// All 9 models are callable with the BYOK keys configured in Settings →
// Provider Keys (or auto-fallback to platform pool when user hasn't set their
// own). Cohort + Arena now treat per-call failures as soft errors and skip
// the failing member without aborting the whole race, so flaky daily quotas
// no longer brick the feature.
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
  { key: "bytez:Qwen/Qwen3-4B", provider: "Bytez", label: "Qwen3 4B (Bytez)", ctx: "32K", tag: "fast" },
  { key: "bytez:Qwen/Qwen2.5-7B-Instruct", provider: "Bytez", label: "Qwen2.5 7B (Bytez)", ctx: "32K", tag: "balanced" },
  { key: "bytez:meta-llama/Llama-3.2-3B-Instruct", provider: "Bytez", label: "Llama 3.2 3B (Bytez)", ctx: "8K", tag: "fast" },
  { key: "bytez:google/gemma-2-9b-it", provider: "Bytez", label: "Gemma 2 9B (Bytez)", ctx: "8K", tag: "smart" },
];

export const MODEL_KEYS: ModelKey[] = MODEL_CATALOG.map((m) => m.key);

export type ModelOverrides = Partial<Record<"planner" | "executor" | "critic", ModelKey>>;
