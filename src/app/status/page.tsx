"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/Logo";

type Probe = {
  id: string;
  name: string;
  url: string;
  method?: "GET" | "POST";
  body?: string;
  expect?: number;
  mustContain?: string;
  // Multiple substrings — ANY of them missing fails the probe. Stricter
  // than mustContain alone for routes that need to prove a chain (e.g.
  // /api/run must emit both `tool_call` AND `answer`, not just one).
  mustContainAll?: string[];
  mustNotContain?: string;
};
type Result = { id: string; ok: boolean; ms: number; status?: number; error?: string };

const probes: Probe[] = [
  { id: "mcp", name: "DelOS MCP Demo", url: "/api/mcp/demo", method: "GET" },
  { id: "memory", name: "Memory API", url: "/api/memory?q=ping&topK=1", method: "GET" },
  { id: "tools", name: "Tool Registry", url: "/api/tools/list", method: "GET" },
  { id: "tts", name: "ElevenLabs probe", url: "/api/tts", method: "GET" },
  { id: "quick", name: "Quick Agent", url: "/api/quick-agent", method: "POST", body: JSON.stringify({ prompt: "Say 'pong' and nothing else." }) },
  {
    id: "run",
    name: "Agent run sanity",
    url: "/api/run",
    method: "POST",
    body: JSON.stringify({ goal: "What is 7 times 8? Use calc and answer only.", maxSteps: 3 }),
    // Run must hit calc tool AND deliver an answer. Catches the regression
    // where provider rate limit ended the run before any tool call. The
    // synthesized fallback answer still has provider-unavailable substring,
    // so we also reject that to mark provider-down runs as degraded.
    mustContainAll: ['"t":"tool_call"', '"t":"answer"'],
    mustNotContain: "provider unavailable",
  },
  { id: "wiki", name: "MCP / wiki_search", url: "/api/mcp/demo", method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "tools/call", params: { name: "random_fact", arguments: {} } }) },
  { id: "crypto", name: "MCP / crypto_price", url: "/api/mcp/demo", method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 100, method: "tools/call", params: { name: "crypto_price", arguments: { symbol: "btc" } } }) },
  // Bytez tertiary fallback probe. Health endpoint folds bytez into the
  // /api/health summary; this surface line exposes the auth-level check
  // directly on /status so judges see the integration is wired.
  { id: "bytez", name: "Bytez fallback", url: "/api/health", method: "GET", mustContain: '"name":"bytez"', mustNotContain: '"name":"bytez","ok":false,"ms":0,"reason":"no_key"' },
];

export default function StatusPage() {
  const [results, setResults] = useState<Record<string, Result>>({});
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<number | null>(null);

  async function checkOne(p: Probe): Promise<Result> {
    const t0 = performance.now();
    try {
      const r = await fetch(p.url, p.method === "POST" ? { method: "POST", headers: { "Content-Type": "application/json" }, body: p.body } : undefined);
      const ms = Math.round(performance.now() - t0);
      const needsBody = !!(p.mustContain || p.mustContainAll || p.mustNotContain);
      const body = needsBody ? await r.text() : "";
      if (p.mustContain && !body.includes(p.mustContain)) {
        return { id: p.id, ok: false, ms, status: r.status, error: `missing ${p.mustContain}` };
      }
      if (p.mustContainAll) {
        for (const m of p.mustContainAll) {
          if (!body.includes(m)) {
            return { id: p.id, ok: false, ms, status: r.status, error: `missing ${m}` };
          }
        }
      }
      if (p.mustNotContain && body.includes(p.mustNotContain)) {
        return { id: p.id, ok: false, ms, status: r.status, error: `contains ${p.mustNotContain}` };
      }
      return { id: p.id, ok: r.ok, ms, status: r.status };
    } catch (e) {
      const ms = Math.round(performance.now() - t0);
      return { id: p.id, ok: false, ms, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async function checkAll() {
    setRunning(true);
    setResults({});
    const out: Record<string, Result> = {};
    await Promise.all(
      probes.map(async (p) => {
        out[p.id] = await checkOne(p);
        setResults((cur) => ({ ...cur, [p.id]: out[p.id] }));
      }),
    );
    setRunning(false);
    setLastRun(Date.now());
  }

  useEffect(() => {
    checkAll();
    const t = setInterval(checkAll, 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allOk = probes.every((p) => results[p.id]?.ok);
  const anyError = Object.values(results).some((r) => !r?.ok);
  const overall = !lastRun ? "checking" : allOk ? "operational" : anyError ? "degraded" : "checking";

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 glass-header">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link href="/"><Wordmark size={26} /></Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link href="/os" className="btn-pixel success">★ DelOS</Link>
            <Link href="/" className="btn-pixel ghost hidden sm:inline-flex">Home</Link>
            <Link href="/docs" className="btn-pixel ghost hidden sm:inline-flex">Docs</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-12 space-y-8">
        <section className="text-center">
          <h1 className="font-pixel text-4xl sm:text-6xl mb-4 tracking-wider">Status</h1>
          <div className="flex items-center justify-center gap-3">
            <span
              className={`pill ${overall === "operational" ? "pill-ok" : overall === "degraded" ? "pill-bad" : "pill-warn"}`}
              style={{ fontSize: 12, padding: "4px 10px" }}
            >
              <span className="w-2 h-2 inline-block accent-pulse" style={{ background: overall === "operational" ? "var(--success)" : overall === "degraded" ? "var(--danger)" : "var(--warn)" }} />
              {overall.toUpperCase()}
            </span>
            <button onClick={checkAll} disabled={running} className="btn-pixel ghost" style={{ padding: "6px 10px", fontSize: 11 }}>
              {running ? "checking…" : "re-check"}
            </button>
            {lastRun && <span className="text-[color:var(--muted)] text-xs font-mono">last: {new Date(lastRun).toLocaleTimeString()}</span>}
          </div>
        </section>

        <section className="space-y-2">
          {probes.map((p) => {
            const r = results[p.id];
            return (
              <div key={p.id} className="card-pixel flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="font-pixel text-sm tracking-wider mb-1">{p.name}</div>
                  <code className="font-mono text-[10px] text-[color:var(--muted)]">{p.method ?? "GET"} {p.url}</code>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {!r && <span className="pill pill-warn">checking…</span>}
                  {r?.ok && <span className="pill pill-ok">● up</span>}
                  {r && !r.ok && <span className="pill pill-bad">● down{r.status ? ` ${r.status}` : ""}</span>}
                  {r && <span className="pill pill-muted" style={{ fontSize: 9 }}>{r.ms}ms</span>}
                </div>
              </div>
            );
          })}
        </section>

        <section className="card-pixel">
          <h2 className="font-pixel text-lg mb-2 tracking-wider" style={{ color: "var(--accent)" }}>Upstream providers</h2>
          <p className="text-[color:var(--muted)] text-sm mb-3">
            DelOS depends on these external services. We don&apos;t directly probe them from this page (avoids burning your quota); the route-level checks above implicitly test the chain.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-mono">
            <a href="https://status.groq.com" target="_blank" rel="noreferrer" className="card-pixel">Groq status →</a>
            <a href="https://status.mistral.ai" target="_blank" rel="noreferrer" className="card-pixel">Mistral status →</a>
            <a href="https://status.cloud.google.com" target="_blank" rel="noreferrer" className="card-pixel">Google Cloud →</a>
            <a href="https://status.elevenlabs.io" target="_blank" rel="noreferrer" className="card-pixel">ElevenLabs status →</a>
            <a href="https://api.hydradb.com" target="_blank" rel="noreferrer" className="card-pixel">HydraDB API →</a>
            <a href="https://discord.gg/UYsxv9PNU" target="_blank" rel="noreferrer" className="card-pixel">Hackathon Discord →</a>
          </div>
        </section>

        <p className="text-center text-xs text-[color:var(--muted)] font-mono">
          Auto-refreshes every 30s · client-side checks · no third-party tracking
        </p>
      </main>
    </div>
  );
}
