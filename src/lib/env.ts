// Lazy, non-throwing env access.
//
// Missing keys resolve to "" instead of throwing at module-evaluation.
// This matters because lib/llm.ts and lib/hydra.ts construct provider
// clients at import time — a hard throw there crashes `next build`
// page-data collection AND the documented keyless-demo path. The LLM
// provider cascade (lib/llm + lib/jsonGen) and the HydraDB local
// fallback (lib/hydra) already degrade gracefully when a call fails,
// and /api/health + /api/keys/status surface which keys are actually
// live, so an absent key is observable without crashing the process.
//
// Getters (not eager reads) so a key set in the environment is picked
// up on next access rather than frozen at first import.
function read(name: string): string {
  return process.env[name] ?? "";
}

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

/** True when a non-empty value is present for `name`. */
export function hasEnv(name: string): boolean {
  return (process.env[name] ?? "").length > 0;
}

export const env = {
  get HYDRA_DB_API_KEY() {
    return read("HYDRA_DB_API_KEY");
  },
  get GROQ_API_KEY() {
    return read("GROQ_API_KEY");
  },
  get MISTRAL_API_KEY() {
    return read("MISTRAL_API_KEY");
  },
  get GOOGLE_GENERATIVE_AI_API_KEY() {
    return read("GOOGLE_GENERATIVE_AI_API_KEY");
  },
  DELRIO_TENANT_ID: process.env.DELRIO_TENANT_ID ?? "delrio_demo",
  get ELEVENLABS_API_KEY() {
    return optional("ELEVENLABS_API_KEY");
  },
  // Default: Sarah (mature, reassuring, confident female) — free tier accessible.
  // Was Rachel (21m00Tcm4TlvDq8ikWAM) which is now paid-only on the API.
  ELEVENLABS_VOICE_ID: process.env.ELEVENLABS_VOICE_ID ?? "EXAVITQu4vr4xnSDxMaL",
  ELEVENLABS_MODEL_ID: process.env.ELEVENLABS_MODEL_ID ?? "eleven_turbo_v2_5",
  get ANTHROPIC_API_KEY() {
    return optional("ANTHROPIC_API_KEY");
  },
  get OPENAI_API_KEY() {
    return optional("OPENAI_API_KEY");
  },
  // Bytez · unified inference API across 175k+ open + closed-source models.
  // Used as a TERTIARY fallback when both Mistral and Gemini are exhausted /
  // rate-limited. Optional — if unset the bytez branch is silently skipped.
  get BYTEZ_API_KEY() {
    return optional("BYTEZ_API_KEY");
  },
  // Default Bytez chat model. Picked because Qwen3 is fast, ranks well on
  // chat eval, and is the model id Bytez explicitly references in their
  // openapi spec for the chat task. Override per-account in Settings.
  BYTEZ_DEFAULT_MODEL: process.env.BYTEZ_DEFAULT_MODEL ?? "Qwen/Qwen3-4B",
};
