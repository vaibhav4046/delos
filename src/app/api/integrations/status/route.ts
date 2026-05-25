// F11 · /api/integrations/status · enumerate every provider state so the UI
// can show what's connected vs missing. Returns JSON, not HTML.
import { isNimEnabled, NIM_MODELS } from "@/lib/llm/providers/nim";

export const runtime = "nodejs";

function has(name: string): boolean {
  return Boolean(process.env[name] && process.env[name]!.length > 4);
}

export async function GET() {
  const integrations = [
    { provider: "gmail", state: has("GMAIL_CLIENT_ID") ? "configured" : "missing" },
    { provider: "notion", state: has("NOTION_CLIENT_ID") ? "configured" : "missing" },
    { provider: "github", state: has("GITHUB_CLIENT_ID") ? "configured" : "missing" },
    { provider: "gdrive", state: has("GDRIVE_CLIENT_ID") || has("GMAIL_CLIENT_ID") ? "configured" : "missing" },
    { provider: "groq", state: has("GROQ_API_KEY") ? "connected" : "missing" },
    { provider: "mistral", state: has("MISTRAL_API_KEY") ? "connected" : "missing" },
    { provider: "google", state: has("GOOGLE_GENERATIVE_AI_API_KEY") ? "connected" : "missing" },
    { provider: "hydra", state: has("HYDRA_DB_API_KEY") ? "connected" : "missing" },
    { provider: "eleven", state: has("ELEVENLABS_API_KEY") ? "connected" : "missing" },
    {
      provider: "nim",
      state: isNimEnabled() ? "connected" : "missing",
      models: Object.values(NIM_MODELS).length,
      roles: ["cohort.god-mode", "critic.preferred", "codegen.fallback"],
    },
  ];
  return Response.json({ ok: true, integrations });
}

export async function POST() {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
}
