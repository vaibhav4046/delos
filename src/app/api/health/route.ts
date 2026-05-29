import { env } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 10;

type ProbeResult = { name: string; ok: boolean; ms: number; reason?: string };

async function probe(name: string, url: string, init?: RequestInit, ttl = 4500): Promise<ProbeResult> {
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const tm = setTimeout(() => ctrl.abort(), ttl);
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    clearTimeout(tm);
    if (r.ok) return { name, ok: true, ms: Date.now() - t0 };
    // 429 = reachable but throttled. Provider is up and the cascade will fail
    // over to the next one, so don't flap the dashboard red on a transient cap.
    if (r.status === 429) return { name, ok: true, ms: Date.now() - t0, reason: "throttled (429)" };
    // M13 · 401/403 means the credentials were REJECTED. The endpoint is
    // reachable but UNUSABLE for real generation. The old code counted these
    // as "alive", so a revoked/expired/missing key showed green while every
    // actual LLM call 401'd — a green board during a total outage. Report down.
    if (r.status === 401 || r.status === 403) {
      return { name, ok: false, ms: Date.now() - t0, reason: `auth_failed (${r.status})` };
    }
    return { name, ok: false, ms: Date.now() - t0, reason: `status ${r.status}` };
  } catch (e) {
    return { name, ok: false, ms: Date.now() - t0, reason: (e as Error).message.slice(0, 80) };
  }
}

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const checks = await Promise.allSettled([
    probe("groq", "https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
    }),
    probe("mistral", "https://api.mistral.ai/v1/models", {
      headers: { Authorization: `Bearer ${env.MISTRAL_API_KEY}` },
    }),
    probe("gemini", `https://generativelanguage.googleapis.com/v1beta/models?key=${env.GOOGLE_GENERATIVE_AI_API_KEY}`),
    env.BYTEZ_API_KEY
      ? probe("bytez", "https://api.bytez.com/models/v2/list/tasks", {
          headers: { Authorization: `Key ${env.BYTEZ_API_KEY}` },
        })
      : Promise.resolve({ name: "bytez", ok: false, ms: 0, reason: "no_key" } satisfies ProbeResult),
    probe("hydradb", "https://api.hydradb.com/health", {}),
    env.ELEVENLABS_API_KEY
      ? probe("elevenlabs", "https://api.elevenlabs.io/v1/user", {
          headers: { "xi-api-key": env.ELEVENLABS_API_KEY },
        })
      : Promise.resolve({ name: "elevenlabs", ok: false, ms: 0, reason: "no_key" } satisfies ProbeResult),
    probe("mcp", `${origin}/api/mcp/demo`),
    probe("stats", `${origin}/api/stats`),
    // memory: probe HydraDB directly (self-probe via /api/memory loops via autoseed)
    probe("memory", "https://api.hydradb.com/health", {}),
    // runlog: confirm dynamic route shape via known-404
    (async () => {
      const t0 = Date.now();
      try {
        const r = await fetch(`${origin}/api/run-log/__probe__`, { signal: AbortSignal.timeout(3000) });
        return { name: "runlog", ok: r.status === 404, ms: Date.now() - t0 };
      } catch (e) {
        return { name: "runlog", ok: false, ms: Date.now() - t0, reason: (e as Error).message };
      }
    })(),
  ]);

  const results: ProbeResult[] = checks.map((c) =>
    c.status === "fulfilled" ? c.value : { name: "unknown", ok: false, ms: 0, reason: String(c.reason).slice(0, 80) },
  );

  const required = ["groq", "mistral", "gemini", "hydradb", "mcp", "stats", "runlog"];
  const ok = results.filter((r) => required.includes(r.name)).every((r) => r.ok);

  return Response.json({
    ok,
    checks: results,
    summary: `${results.filter((r) => r.ok).length}/${results.length} alive`,
    at: Date.now(),
  });
}
