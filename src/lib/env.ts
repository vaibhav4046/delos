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
};
