import Link from "next/link";
import { Wordmark } from "@/components/Logo";

type Endpoint = { method: string; path: string; desc: string; body?: string; resp?: string; example?: string };

const endpoints: Endpoint[] = [
  {
    method: "POST", path: "/api/run", desc: "Stream a full agent run (SSE). Goal → planner → executor → critic → answer.",
    body: `{
  "goal": "What is 7×8?",
  "chaos": ["tool_flake"],            // optional
  "interrupt": { "afterSteps": 1, "newGoal": "..." },  // optional
  "maxSteps": 8,                       // optional
  "models": { "planner": "groq:openai/gpt-oss-120b" }, // optional overrides
  "mcpServers": [{ "id": "demo", "name": "...", "url": "...", "enabled": true }],
  "tenantId": "me_personal"            // optional
}`,
    resp: "SSE stream of RunEvent JSON lines (meta, phase, thought, tool_call, tool_result, recover, adapt, usage, subagent, memory_*, metric, answer, error)",
    example: `curl -N -X POST http://localhost:3000/api/run \\
  -H "Content-Type: application/json" \\
  -d '{"goal":"What is 7×8?"}'`,
  },
  {
    method: "POST", path: "/api/cohort", desc: "Race N models on the same goal. Judge picks winner + merges.",
    body: `{ "goal": "Why is the sky blue?", "members": ["groq:openai/gpt-oss-120b","google:gemini-2.5-flash","mistral:mistral-large-latest"], "judge": "mistral:mistral-large-latest" }`,
    resp: "SSE: cohort_start → cohort_member spawn/done/fail per member → cohort_verdict { winnerIndex, rationale, scores, merged }",
  },
  {
    method: "POST", path: "/api/build-app", desc: "Generate a DelOS app spec from natural language. Zod-validated.",
    body: `{ "prompt": "Build me a stopwatch with start/stop/reset.", "models": {...}, "tenantId": "..." }`,
    resp: `{ "spec": { "id": "...", "name": "...", "icon": "...", "width": 320, "height": 240, "initialState": {...}, "root": {...} } }`,
  },
  {
    method: "POST", path: "/api/voice-command", desc: "Interpret a transcript → action JSON for autonomy mode.",
    body: `{ "transcript": "open the terminal and find the capital of japan" }`,
    resp: `{ "intent": "run_mission", "app": "terminal", "payload": "find the capital of japan", "reply": "Opening terminal and..." }`,
  },
  {
    method: "POST", path: "/api/stt", desc: "Whisper Large v3 Turbo speech-to-text. Free quota via Groq.",
    body: "multipart/form-data: file=<audio blob>, model=whisper-large-v3-turbo, language=en (opt)",
    resp: `{ "text": "transcript here", "ms": 1234, "model": "whisper-large-v3-turbo" }`,
  },
  {
    method: "POST", path: "/api/tts", desc: "ElevenLabs text-to-speech (premium, 10k chars/mo free).",
    body: `{ "text": "hello world", "voiceId": "...", "stability": 0.5, "similarity": 0.75 }`,
    resp: "audio/mpeg binary · 503 when no key (client falls back to browser TTS)",
  },
  {
    method: "GET", path: "/api/tts", desc: "Probe TTS configuration.",
    resp: `{ "available": true, "voiceId": "...", "modelId": "..." }`,
  },
  {
    method: "GET", path: "/api/tts/voices", desc: "List available ElevenLabs voices.",
    resp: `{ "available": true, "voices": [{ "id": "...", "name": "...", "labels": {...} }] }`,
  },
  {
    method: "POST", path: "/api/steer", desc: "Inject a live instruction into a running orchestrator.",
    body: `{ "runId": "abc123", "instruction": "focus on dates only" }`,
    resp: `{ "ok": true } · orchestrator picks up between steps and triggers WARP zone replan`,
  },
  {
    method: "POST", path: "/api/tool", desc: "Direct single-tool invocation (used by AppRuntime).",
    body: `{ "tool": "calc", "args": { "expr": "(2+3)*4" } }`,
    resp: `{ "ok": true, "data": { "value": 20 } }`,
  },
  {
    method: "POST", path: "/api/quick-agent", desc: "One-shot LLM reply, no tools, no critic.",
    body: `{ "prompt": "Write a haiku about pixel art.", "tenantId": "..." }`,
    resp: `{ "text": "..." }`,
  },
  {
    method: "GET", path: "/api/memory?q=...&tenantId=...&topK=24", desc: "Recall memories from HydraDB + local fallback.",
    resp: `{ "query": "...", "hits": [{ "text": "...", "score": 0.82 }], "local": [{ "id": "...", "text": "...", "tags": [...], "createdAt": ... }] }`,
  },
  {
    method: "POST", path: "/api/mcp/demo", desc: "Bundled MCP server. JSON-RPC 2.0. 8 tools: wiki_search · world_time · random_fact · crypto_price · exchange_rate · dictionary · dad_joke · weather.",
    body: `{ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "crypto_price", "arguments": { "symbol": "btc" } } }`,
    resp: `{ "jsonrpc": "2.0", "id": 1, "result": { "content": [{ "type": "text", "text": "BTC: $77,250 (24h 0.20%)" }] } }`,
  },
  {
    method: "GET", path: "/api/tools/list", desc: "List the local tool registry with schemas.",
    resp: `{ "tools": [{ "name": "calc", "description": "...", "tags": ["math","compute"], "fields": [...] }, ...] }`,
  },
  {
    method: "GET", path: "/api/stats", desc: "Single source of truth for site-wide counts + live drift/replan metrics.",
    resp: `{ "features": 51, "endpoints": 21, "tools": { "local": 6, "mcp": 11, "total": 17 }, "apps": 24, "models": [...], "runs_today": 12, "avg_drift_7d": 0.07, "replans_per_run_7d": 0.4, "metrics_line": "Critic verifies every step · avg drift this week: 0.07 · replans/run: 0.4" }`,
  },
  {
    method: "GET", path: "/api/run-log?runId=...", desc: "Fetch full SSE event log for a specific run (or list recent if no runId).",
    resp: `{ "ok": true, "run": { "runId": "...", "goal": "...", "events": [...RunEvent], "answer": "...", "drift": 0.07, "replans": 0, "success": true } }`,
  },
  {
    method: "GET", path: "/api/live", desc: "SSE stream of all run starts/events/ends across tenants (for /live dashboard).",
    resp: `data: { "type": "snapshot|start|event|end|heartbeat", ... }`,
  },
  {
    method: "POST", path: "/api/memory/seed", desc: "Seed 12 graph-shaped sample memories under a tenant (idempotent — auto-runs on first /api/memory GET too).",
    body: `{ "tenantId": "delrio_demo" }`,
    resp: `{ "ok": true, "seeded": 12, "entries": [...] }`,
  },
  {
    method: "POST", path: "/api/os-builder", desc: "Sub-agent fan-out mission. Spawns N parallel agents that each build an app via /api/build-app. Emits app_materialize for each spec. Ends with Doom launch.",
    body: `{ "goal": "Build OS shell with 5 apps", "subGoals": ["Calculator...", "Clock...", ...], "tenantId": "..." }`,
    resp: "SSE: meta · phase · thought · subagent (5 spawns) · tool_result name=app_materialize (×N) · metric (agents/requests/tokens/usd) · tool_result name=launch_app · answer · done",
  },
];

const events = [
  { t: "meta", shape: "{ runId, at }", note: "First event of a stream. Capture runId for /api/steer." },
  { t: "phase", shape: "{ phase: 'boot'|'recall'|'plan'|'act'|'critic'|'replan'|'store'|'done'|'fail', note?, at }", note: "Lifecycle marker." },
  { t: "thought", shape: "{ agent: 'planner'|'executor'|'critic', text, at }", note: "Free-form agent reasoning." },
  { t: "tool_call", shape: "{ name, args, at }", note: "Outbound tool invocation." },
  { t: "tool_result", shape: "{ name, ok, result?, error?, at }", note: "Tool returned." },
  { t: "recover", shape: "{ reason, strategy, at }", note: "Recovery layer fired (1-UP)." },
  { t: "adapt", shape: "{ from, to, reason, at }", note: "Goal swap / drift correction (WARP zone)." },
  { t: "usage", shape: "{ role, model, promptTokens, completionTokens, ms, at }", note: "LLM call telemetry." },
  { t: "subagent", shape: "{ id, goal, status: 'spawn'|'done'|'fail', result?, at }", note: "Parallel sub-agent fan-out." },
  { t: "memory_write", shape: "{ key, preview, at }", note: "HydraDB store." },
  { t: "memory_recall", shape: "{ query, hits, at }", note: "HydraDB recall." },
  { t: "metric", shape: "{ key, value, at }", note: "drift / elapsed_ms / replans / tool_calls / successes / wall_time_ms." },
  { t: "tool_result name=app_materialize", shape: "{ ok: true, result: { spec: AppSpec }, at }", note: "DelOS shell listens for this and spawns a window with the spec (os-builder mission)." },
  { t: "tool_result name=launch_app", shape: "{ ok: true, result: { app: string }, at }", note: "Auto-launch a built-in DelOS app (e.g. doom)." },
  { t: "answer", shape: "{ text, at }", note: "Final answer. Sourced from final_answer tool when planner included it; otherwise post-loop LLM synth." },
  { t: "error", shape: "{ message, at }", note: "Fatal." },
];

export default function DocsPage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 glass-header">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link href="/"><Wordmark size={26} /></Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link href="/os" className="btn-pixel success">★ DelOS</Link>
            <Link href="/" className="btn-pixel ghost hidden sm:inline-flex">Home</Link>
            <Link href="/status" className="btn-pixel ghost hidden md:inline-flex">Status</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-12 grid lg:grid-cols-[200px_1fr] gap-8">
        <aside className="hidden lg:block">
          <div className="sticky top-24 space-y-1 font-mono text-xs">
            <a href="#auth" className="block text-[color:var(--muted)] hover:text-[color:var(--accent)]">Auth + Tenants</a>
            <a href="#endpoints" className="block text-[color:var(--muted)] hover:text-[color:var(--accent)]">Endpoints</a>
            {endpoints.map((e) => (
              <a key={`${e.method}-${e.path}`} href={`#${slugify(e.method + "-" + e.path)}`} className="block pl-3 text-[color:var(--muted)] hover:text-[color:var(--accent)]">{e.method} {e.path}</a>
            ))}
            <a href="#events" className="block text-[color:var(--muted)] hover:text-[color:var(--accent)] mt-2">Event Schema</a>
          </div>
        </aside>

        <article className="space-y-8 max-w-3xl">
          <div>
            <h1 className="font-pixel text-4xl mb-2 tracking-wider">API Reference</h1>
            <p className="text-[color:var(--muted)]">
              REST + SSE. Self-hostable. Per-request model overrides via AsyncLocalStorage. JSON-RPC 2.0 for MCP.
            </p>
          </div>

          <section id="auth">
            <h2 className="font-pixel text-2xl mb-3 tracking-wider" style={{ color: "var(--accent)" }}>Auth + Tenants</h2>
            <p className="text-[color:var(--muted)] mb-3">
              Self-hosted — no API key on DelOS routes. Backend uses your <code>.env.local</code> for upstream providers (Groq, Mistral, Gemini, HydraDB, ElevenLabs).
              Pass <code>tenantId</code> in every body to scope memory per device / user. Same tenant ID across installs = automatic sync via HydraDB.
            </p>
            <pre className="card-pixel font-mono text-xs whitespace-pre-wrap" style={{ background: "var(--bg)" }}>
{`# .env.local
HYDRA_DB_API_KEY=...
GROQ_API_KEY=...
MISTRAL_API_KEY=...
GOOGLE_GENERATIVE_AI_API_KEY=...
ELEVENLABS_API_KEY=...                 # optional
DELRIO_TENANT_ID=default                # fallback`}
            </pre>
          </section>

          <section id="endpoints">
            <h2 className="font-pixel text-2xl mb-3 tracking-wider" style={{ color: "var(--accent)" }}>Endpoints</h2>
            <div className="space-y-6">
              {endpoints.map((e) => (
                <div key={`${e.method}-${e.path}`} id={slugify(e.method + "-" + e.path)} className="card-pixel">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className={`pill ${e.method === "POST" ? "pill-warn" : "pill-info"}`}>{e.method}</span>
                    <code className="font-mono text-sm" style={{ color: "var(--accent)" }}>{e.path}</code>
                  </div>
                  <p className="text-sm text-[color:var(--muted)] leading-relaxed mb-3">{e.desc}</p>
                  {e.body && (
                    <>
                      <div className="text-[10px] font-pixel tracking-wider text-[color:var(--muted)] mt-3 mb-1">REQUEST</div>
                      <pre className="font-mono text-[11px] whitespace-pre-wrap p-2" style={{ background: "var(--bg)", border: "1px solid var(--surface-2)" }}>{e.body}</pre>
                    </>
                  )}
                  {e.resp && (
                    <>
                      <div className="text-[10px] font-pixel tracking-wider text-[color:var(--muted)] mt-3 mb-1">RESPONSE</div>
                      <pre className="font-mono text-[11px] whitespace-pre-wrap p-2" style={{ background: "var(--bg)", border: "1px solid var(--surface-2)" }}>{e.resp}</pre>
                    </>
                  )}
                  {e.example && (
                    <>
                      <div className="text-[10px] font-pixel tracking-wider text-[color:var(--muted)] mt-3 mb-1">CURL</div>
                      <pre className="font-mono text-[11px] whitespace-pre-wrap p-2" style={{ background: "var(--bg)", border: "1px solid var(--surface-2)" }}>{e.example}</pre>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section id="events">
            <h2 className="font-pixel text-2xl mb-3 tracking-wider" style={{ color: "var(--accent)" }}>SSE Event Schema</h2>
            <p className="text-[color:var(--muted)] mb-3">
              Every event has <code>{`{ t, at }`}</code>. <code>at</code> is a Unix-ms timestamp. Consume via <code>fetch</code> + <code>ReadableStream</code>.
            </p>
            <div className="space-y-2">
              {events.map((ev) => (
                <div key={ev.t} className="card-pixel">
                  <div className="flex items-center gap-2 mb-1">
                    <code className="font-mono text-sm" style={{ color: "var(--accent)" }}>{ev.t}</code>
                    <span className="font-mono text-xs text-[color:var(--muted)]">{ev.shape}</span>
                  </div>
                  <p className="text-xs text-[color:var(--muted)]">{ev.note}</p>
                </div>
              ))}
            </div>
          </section>
        </article>
      </main>

      <footer className="border-t-2 border-[color:var(--surface-2)] py-6 text-center text-xs text-[color:var(--muted)] font-mono">
        Self-host: <code>node ./node_modules/next/dist/bin/next dev -p 3000</code> · v2.0
      </footer>
    </div>
  );
}

function slugify(s: string) {
  return s.replace(/[^a-z0-9]/gi, "-").toLowerCase();
}
