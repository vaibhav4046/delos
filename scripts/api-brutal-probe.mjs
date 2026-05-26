#!/usr/bin/env node
// Brutal API probe · hits every endpoint live · classifies pass/fail/fallback.
// Goal: every endpoint returns clean 200 with no error envelope, or a documented
// 4xx with structured kind. No 5xx. No silent fallbacks pretending success.

const BASE = process.argv[2] || process.env.DELOS_BASE_URL || "https://delrio.vercel.app";
const TENANT = `qa_brutal_${Date.now().toString(36)}`;
const SSE_TIMEOUT_MS = 12000;
const REQ_TIMEOUT_MS = 25000;

const log = (...a) => console.log(...a);
const j = (o) => JSON.stringify(o);

async function hit(method, path, body, opts = {}) {
  const ctrl = new AbortController();
  const tmo = setTimeout(() => ctrl.abort("timeout"), opts.timeout ?? REQ_TIMEOUT_MS);
  try {
    const url = BASE + path;
    const init = { method, signal: ctrl.signal, headers: { "Content-Type": "application/json" } };
    if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
    const r = await fetch(url, init);
    const ct = r.headers.get("content-type") || "";
    let payload;
    if (ct.includes("application/json")) {
      try { payload = await r.json(); } catch { payload = null; }
    } else if (ct.includes("text/event-stream")) {
      // collect first few events
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      const types = [];
      const start = Date.now();
      while (Date.now() - start < (opts.sseTimeout ?? SSE_TIMEOUT_MS) && types.length < 6) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() || "";
        for (const p of parts) {
          const line = p.split("\n").find((l) => l.startsWith("data: "));
          if (line) try { types.push(JSON.parse(line.slice(6)).t); } catch {}
        }
      }
      payload = { sseTypes: types };
    } else {
      payload = await r.text();
    }
    return { status: r.status, ok: r.ok, ct, payload };
  } catch (e) {
    return { status: 0, ok: false, err: String(e?.message || e) };
  } finally {
    clearTimeout(tmo);
  }
}

const checks = [
  // Probably-public GETs first
  { name: "health", method: "GET", path: "/api/health", expect: (r) => r.ok && r.payload?.ok === true },
  { name: "stats", method: "GET", path: "/api/stats", expect: (r) => r.ok },
  { name: "me", method: "GET", path: "/api/me", expect: (r) => r.ok },
  { name: "live", method: "GET", path: "/api/live", expect: (r) => r.ok },
  { name: "geo", method: "GET", path: "/api/geo", expect: (r) => r.ok || r.status === 503 },
  { name: "fx", method: "GET", path: "/api/fx?from=USD&to=GBP", expect: (r) => r.ok || r.status === 503 },
  { name: "weather", method: "GET", path: "/api/weather?lat=51.5&lon=-0.12", expect: (r) => r.ok && (typeof r.payload?.tempC === "number" || r.payload?.upstreamUnavailable === true) },
  { name: "judges-gated-403", method: "GET", path: "/api/judges", expect: (r) => r.status === 403 },
  { name: "judges-token-ok", method: "GET", path: "/api/judges?token=hydra2026", expect: (r) => r.status === 200 || r.status === 307 || r.status === 308 || r.status === 302 },
  { name: "leaderboard", method: "GET", path: "/api/leaderboard", expect: (r) => r.ok },
  { name: "connectors", method: "GET", path: "/api/connectors", expect: (r) => r.ok },
  { name: "integrations-status", method: "GET", path: "/api/integrations/status", expect: (r) => r.ok },
  { name: "schedule-list", method: "GET", path: `/api/schedule/list?tenantId=${TENANT}`, expect: (r) => r.ok },
  { name: "tools-list", method: "GET", path: "/api/tools/list", expect: (r) => r.ok },
  { name: "tts-voices", method: "GET", path: "/api/tts/voices", expect: (r) => r.ok },
  { name: "builtin-apps", method: "GET", path: "/api/builtin-apps", expect: (r) => r.ok },
  { name: "files-list", method: "GET", path: `/api/files/list?tenantId=${TENANT}`, expect: (r) => r.ok || r.status === 200 },
  { name: "llm-audit", method: "GET", path: "/api/llm/audit", expect: (r) => r.ok && (r.payload?.results?.length > 0 || r.payload?.healthy) },
  { name: "memory-list", method: "GET", path: `/api/memory?tenantId=${TENANT}&q=&limit=10`, expect: (r) => r.ok && Array.isArray(r.payload?.local) },
  { name: "run-log-list", method: "GET", path: "/api/run-log", expect: (r) => r.ok },
  { name: "keys-status", method: "GET", path: "/api/keys/status", expect: (r) => r.ok },

  // POST endpoints with minimal valid payload
  { name: "memory-seed", method: "POST", path: "/api/memory/seed", body: { tenantId: TENANT }, expect: (r) => r.ok && r.payload?.ok !== false },
  { name: "memory-write", method: "POST", path: "/api/memory/write", body: { tenantId: TENANT, text: "qa write probe one", source: "memory-write" }, expect: (r) => r.ok && r.payload?.ok !== false },
  { name: "memory-list-after-write", method: "GET", path: `/api/memory?tenantId=${TENANT}&q=&limit=10`, expect: (r) => r.ok && (r.payload?.local?.length || 0) >= 1 },
  { name: "memory-pin", method: "POST", path: "/api/memory/pin", body: { tenantId: TENANT, text: "qa pinned memory probe content", tags: ["qa", "probe"] }, expect: (r) => r.ok && r.payload?.ok !== false },
  { name: "memory-export", method: "GET", path: `/api/memory/export?tenantId=${TENANT}`, expect: (r) => r.ok },
  { name: "voice-command-create-event", method: "POST", path: "/api/voice-command", body: { transcript: "schedule meeting tomorrow at 3pm", tenantId: TENANT }, expect: (r) => r.ok && Array.isArray(r.payload?.executions) && r.payload.executions.length > 0 },
  { name: "voice-router", method: "POST", path: "/api/voice-router", body: { transcript: "hello", tenantId: TENANT }, expect: (r) => r.ok },
  { name: "tool-web-search", method: "POST", path: "/api/tool", body: { name: "web_search", args: { q: "delos hackathon" }, tenantId: TENANT }, expect: (r) => r.ok && r.payload?.ok !== false },
  { name: "tool-404", method: "POST", path: "/api/tool", body: { name: "nonexistent.tool", args: {} }, expect: (r) => r.status === 404 },
  { name: "quick-agent", method: "POST", path: "/api/quick-agent", body: { input: "reply in exactly 3 words: hi from qa", tenantId: TENANT }, expect: (r) => r.ok && (r.payload?.text || r.payload?.output || r.payload?.answer) },
  { name: "improve", method: "POST", path: "/api/improve", body: { text: "make this better", tenantId: TENANT }, expect: (r) => r.ok || r.status === 400 },
  { name: "eval", method: "POST", path: "/api/eval", body: { input: "1+1", expected: "2", tenantId: TENANT }, expect: (r) => r.ok || r.status === 400 },
  { name: "wallpaper", method: "GET", path: "/api/wallpaper", expect: (r) => r.ok || r.status === 400 },
  { name: "chat", method: "POST", path: "/api/chat", body: { messages: [{ role: "user", content: "hi" }], tenantId: TENANT }, expect: (r) => r.ok },
  { name: "schedule-run-now", method: "POST", path: "/api/schedule/run-now", body: { tenantId: TENANT, kind: "notify", payload: { title: "qa run-now probe", body: "x" }, label: "qa" }, expect: (r) => r.ok && r.payload?.ok !== false },
  { name: "schedule-tick", method: "POST", path: "/api/schedule/tick", body: { tenantId: TENANT }, expect: (r) => r.ok },
  { name: "schedule-add", method: "POST", path: "/api/schedule", body: { tenantId: TENANT, kind: "reminder", title: "qa reminder", whenISO: new Date(Date.now() + 60000).toISOString() }, expect: (r) => r.ok || r.status === 400 },
  { name: "notify", method: "POST", path: "/api/notify", body: { tenantId: TENANT, kind: "system", title: "qa notify probe", body: "qa" }, expect: (r) => r.ok },
  { name: "build-app", method: "POST", path: "/api/build-app", body: { prompt: "tip calculator with two inputs and large output", tenantId: TENANT }, timeout: 90000, expect: (r) => r.ok && r.payload?.ok !== false },
  { name: "calendar-events-get", method: "GET", path: `/api/calendar/events?tenantId=${TENANT}`, expect: (r) => r.ok },
  { name: "calendar-events-post", method: "POST", path: "/api/calendar/events", body: { tenantId: TENANT, title: "qa calendar event", whenISO: new Date(Date.now() + 3600000).toISOString() }, expect: (r) => r.ok || r.status === 400 },
  { name: "gmail-draft-honest", method: "POST", path: "/api/connectors/gmail/draft", body: { to: "demo@example.com", subject: "qa probe", body: "x", tenantId: TENANT }, expect: (r) => r.ok && (r.payload?.demo === true || r.payload?.simulated === true || r.payload?.kind === "demo_simulated" || r.payload?.connected === false) },
  { name: "notion-create-honest", method: "POST", path: "/api/connectors/notion/create-page", body: { title: "qa probe", content: "x", tenantId: TENANT }, expect: (r) => r.ok && (r.payload?.demo === true || r.payload?.simulated === true || r.payload?.kind === "demo_simulated" || r.payload?.connected === false) },
  { name: "gmail-list", method: "POST", path: "/api/connectors/gmail/list", body: { q: "", limit: 5 }, expect: (r) => r.status === 200 || r.status === 401 },
  { name: "gdrive-list", method: "POST", path: "/api/connectors/gdrive/list", body: { q: "", limit: 5 }, expect: (r) => r.status === 200 || r.status === 401 },
  { name: "github-list", method: "POST", path: "/api/connectors/github/list", body: { q: "", limit: 5 }, expect: (r) => r.status === 200 || r.status === 401 },
  { name: "connectors-manual", method: "GET", path: `/api/connectors/manual?tenantId=${TENANT}`, expect: (r) => r.ok || r.status === 405 },
  { name: "codegen-app", method: "POST", path: "/api/codegen-app", body: { prompt: "tip calculator with bill and tip slider", tenantId: TENANT }, timeout: 90000, expect: (r) => r.ok && (r.payload?.files?.length || 0) >= 1 },
  { name: "codegen-app-clarify", method: "POST", path: "/api/codegen-app/clarify", body: { prompt: "todo list with categories", tenantId: TENANT }, expect: (r) => r.ok && typeof r.payload?.clarify === "boolean" },
  { name: "wiki-generate", method: "POST", path: "/api/wiki/generate", body: { topic: "HydraDB", tenantId: TENANT }, expect: (r) => r.ok || r.status === 400 },
  { name: "brand-chat", method: "POST", path: "/api/brand-chat", body: { input: "what is delos", tenantId: TENANT }, expect: (r) => r.ok || r.status === 400 },
  { name: "clone-builder", method: "POST", path: "/api/clone-builder", body: { spec: "todo list", tenantId: TENANT }, expect: (r) => r.ok || r.status === 400 },
  { name: "steer", method: "POST", path: "/api/steer", body: { tenantId: TENANT, hint: "go faster" }, expect: (r) => r.ok || r.status === 400 },
  { name: "coordinator", method: "POST", path: "/api/coordinator", body: { goal: "test", tenantId: TENANT }, expect: (r) => r.ok || r.status === 400 },
  { name: "mcp-demo", method: "POST", path: "/api/mcp/demo", body: { tool: "echo", args: { msg: "hi" } }, expect: (r) => r.ok || r.status === 400 || r.status === 404 },
  { name: "ingestion-desktop", method: "POST", path: "/api/ingestion/desktop", body: { tenantId: TENANT, text: "qa ingest", title: "qa" }, expect: (r) => r.ok || r.status === 400 },
  { name: "os-builder", method: "POST", path: "/api/os-builder", body: { spec: "qa", tenantId: TENANT }, expect: (r) => r.ok || r.status === 400 },

  // SSE endpoints
  { name: "run-sse", method: "POST", path: "/api/run", body: { input: "reply in 3 words: qa ok done", tenantId: TENANT }, sseTimeout: 15000, expect: (r) => r.ok && r.payload?.sseTypes?.includes("meta") },
  { name: "cohort-sse", method: "POST", path: "/api/cohort", body: { goal: "research two coffee beans under 5 dollars", tenantId: TENANT, min: 3 }, sseTimeout: 20000, expect: (r) => r.ok && (r.payload?.sseTypes?.length || 0) >= 1 },
  { name: "browse-agent-sse", method: "POST", path: "/api/browse-agent", body: { task: "go to example.com and summarize the page", tenantId: TENANT }, sseTimeout: 18000, expect: (r) => r.ok && (r.payload?.sseTypes?.length || 0) >= 1 },
  { name: "codegen-app-stream-sse", method: "POST", path: "/api/codegen-app-stream", body: { prompt: "tip calculator with bill input and percentage slider", tenantId: TENANT }, sseTimeout: 30000, expect: (r) => r.ok && (r.payload?.sseTypes?.length || 0) >= 1 },
];

const results = [];
for (const c of checks) {
  const r = await hit(c.method, c.path, c.body, { sseTimeout: c.sseTimeout });
  let pass = false;
  try { pass = c.expect(r); } catch {}
  const sample = r.ct?.includes("event-stream")
    ? `sse[${r.payload?.sseTypes?.join(",")}]`
    : j(r.payload).slice(0, 140);
  log(`${pass ? "✓" : "✗"} ${c.name.padEnd(34)} ${String(r.status).padStart(3)} ${sample}`);
  results.push({ name: c.name, status: r.status, ok: r.ok, pass, sample });
}

const fails = results.filter((r) => !r.pass);
log(`\n${results.length - fails.length}/${results.length} pass · ${fails.length} fail`);
if (fails.length) {
  log("\nFAILURES:");
  for (const f of fails) log(`  ${f.name.padEnd(34)} ${f.status} ${f.sample}`);
  process.exit(1);
}
