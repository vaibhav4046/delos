function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

export const env = {
  HYDRA_DB_API_KEY: required("HYDRA_DB_API_KEY"),
  GROQ_API_KEY: required("GROQ_API_KEY"),
  MISTRAL_API_KEY: required("MISTRAL_API_KEY"),
  GOOGLE_GENERATIVE_AI_API_KEY: required("GOOGLE_GENERATIVE_AI_API_KEY"),
  DELRIO_TENANT_ID: process.env.DELRIO_TENANT_ID ?? "delrio_demo",
  ELEVENLABS_API_KEY: optional("ELEVENLABS_API_KEY"),
  // Default: Sarah (mature, reassuring, confident female) — free tier accessible.
  // Was Rachel (21m00Tcm4TlvDq8ikWAM) which is now paid-only on the API.
  ELEVENLABS_VOICE_ID: process.env.ELEVENLABS_VOICE_ID ?? "EXAVITQu4vr4xnSDxMaL",
  ELEVENLABS_MODEL_ID: process.env.ELEVENLABS_MODEL_ID ?? "eleven_turbo_v2_5",
  ANTHROPIC_API_KEY: optional("ANTHROPIC_API_KEY"),
  OPENAI_API_KEY: optional("OPENAI_API_KEY"),
  // Bytez · unified inference API across 175k+ open + closed-source models.
  // Used as a TERTIARY fallback when both Mistral and Gemini are exhausted /
  // rate-limited. Optional — if unset the bytez branch is silently skipped.
  BYTEZ_API_KEY: optional("BYTEZ_API_KEY"),
  // Default Bytez chat model. Picked because Qwen3 is fast, ranks well on
  // chat eval, and is the model id Bytez explicitly references in their
  // openapi spec for the chat task. Override per-account in Settings.
  BYTEZ_DEFAULT_MODEL: process.env.BYTEZ_DEFAULT_MODEL ?? "Qwen/Qwen3-4B",
};
// touch · 1779729936
