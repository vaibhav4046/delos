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

// All catalog models are callable with the BYOK keys configured in
// Settings → Provider Keys (or auto-fallback to platform pool when
// user hasn't set their own). Cohort + Arena now treat per-call
// failures as soft errors and skip the failing member without aborting
// the whole race, so flaky daily quotas no longer brick the feature.
// Curated to ONLY the models that are confirmed working on free tier
// for this account. Paid-only / soft-skip / "not_in_catalog" models
// were removed to stop dropdown clutter. 2026-05-25 ask · "very long
// unnecessary models · only usable should be there".
//
// Removed:
//   • Groq Llama-4-Maverick + Kimi K2 (paid-only on this org)
//   • All Bytez models (catalog-deployed per-account, soft-skip in QA)
//
// Kept:
//   • Groq GPT-OSS 120B + 20B + Llama 4 Scout (free tier verified)
//   • Mistral Large + Small (free tier verified)
//   • Gemini 2.5 Flash + Pro (Google free tier)
export const MODEL_CATALOG: Array<{ key: ModelKey; provider: string; label: string; ctx: string; tag: "fast" | "smart" | "balanced" }> = [
  { key: "mistral:mistral-small-latest", provider: "Mistral", label: "Mistral Small · fast default", ctx: "32K", tag: "fast" },
  { key: "groq:openai/gpt-oss-20b", provider: "Groq", label: "GPT-OSS 20B · ultra-fast", ctx: "131K", tag: "fast" },
  { key: "google:gemini-2.5-flash", provider: "Google", label: "Gemini 2.5 Flash · balanced", ctx: "1M", tag: "balanced" },
  { key: "groq:meta-llama/llama-4-scout-17b-16e-instruct", provider: "Groq", label: "Llama 4 Scout 17B · long-context", ctx: "128K", tag: "balanced" },
  { key: "mistral:mistral-large-latest", provider: "Mistral", label: "Mistral Large · best reasoning", ctx: "128K", tag: "smart" },
  { key: "groq:openai/gpt-oss-120b", provider: "Groq", label: "GPT-OSS 120B · code expert", ctx: "131K", tag: "smart" },
  { key: "google:gemini-2.5-pro", provider: "Google", label: "Gemini 2.5 Pro · deep reasoning", ctx: "2M", tag: "smart" },
];

export const MODEL_KEYS: ModelKey[] = MODEL_CATALOG.map((m) => m.key);

export type ModelOverrides = Partial<Record<"planner" | "executor" | "critic", ModelKey>>;
