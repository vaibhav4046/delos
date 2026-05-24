import Link from "next/link";
import { Wordmark } from "@/components/Logo";

type Row = { track: string; feature: string; where: string; href?: string; status: "🟢" | "🟡" | "🔴" };

const ROWS: Row[] = [
  // Memory
  { track: "Memory", feature: "HydraDB graph store + local fallback", where: "src/lib/hydra.ts", status: "🟢" },
  { track: "Memory", feature: "Cross-run recall in planner prompt", where: "src/lib/orchestrator.ts:plan", status: "🟢" },
  { track: "Memory", feature: "Memory browser UI", where: "/memory", href: "/memory", status: "🟢" },
  { track: "Memory", feature: "Auto-seed 12 graph-shaped memories", where: "/api/memory route", href: "/api/memory", status: "🟢" },
  { track: "Memory", feature: "Fuzzy word-overlap fallback recall", where: "src/lib/hydra.ts:safeRecall", status: "🟢" },
  // Tools
  { track: "Tools", feature: "Typed local registry (6 tools)", where: "/api/tools/list", href: "/api/tools/list", status: "🟢" },
  { track: "Tools", feature: "Bundled MCP server (11 tools)", where: "/api/mcp/demo", href: "/api/mcp/demo", status: "🟢" },
  { track: "Tools", feature: "Tool sibling fallback", where: "src/lib/orchestrator.ts:fallbacks", status: "🟢" },
  { track: "Tools", feature: "Capability-tagged registry", where: "src/lib/tools/builtin.ts", status: "🟢" },
  // Recovery
  { track: "Recovery", feature: "Cockatiel retry + circuit breaker", where: "src/lib/resilience.ts", status: "🟢" },
  { track: "Recovery", feature: "Critic step-intent drift scoring", where: "src/lib/agents/critic.ts", status: "🟢" },
  { track: "Recovery", feature: "Replan hard cap (2)", where: "src/lib/orchestrator.ts:replans<2", status: "🟢" },
  { track: "Recovery", feature: "Model failover (Mistral → Gemini)", where: "src/lib/agents/critic.ts:catch", status: "🟢" },
  // Adaptation
  { track: "Adaptation", feature: "Live STEER mid-stream", where: "/api/steer", href: "/api/steer", status: "🟢" },
  { track: "Adaptation", feature: "Critic goal-drift detection", where: "src/lib/agents/critic.ts", status: "🟢" },
  { track: "Adaptation", feature: "Context flood compression", where: "src/lib/orchestrator.ts:context_flood", status: "🟢" },
  { track: "Adaptation", feature: "User-interrupt warp zone", where: "/play", href: "/play", status: "🟢" },
  // Bonus
  { track: "Bonus · AI-OS", feature: "DelOS — 24 desktop apps", where: "/os", href: "/os", status: "🟢" },
  { track: "Bonus · AI-OS", feature: "Del Doom · 10 levels · raycaster", where: "/os doom app", status: "🟢" },
  { track: "Bonus · AI-OS", feature: "Del Assistant · Claude-style chat", where: "src/components/os/DelAssistant.tsx", status: "🟢" },
  { track: "Bonus · AI-OS", feature: "Cowork · autonomous task agent", where: "src/components/os/CoworkApp.tsx", status: "🟢" },
  { track: "Bonus · AI-OS", feature: "Cohort council (3+ models race)", where: "/api/cohort", status: "🟢" },
  { track: "Bonus · Voice", feature: "Whisper STT via Groq", where: "/api/stt", status: "🟢" },
  { track: "Bonus · Voice", feature: "ElevenLabs TTS + browser fallback", where: "/api/tts", status: "🟡" },
  { track: "Bonus · Voice", feature: "Voice command autonomy", where: "/api/voice-command", status: "🟢" },
  { track: "Bonus · Build", feature: "AppBuilder — natural language → spec", where: "/api/build-app", status: "🟢" },
  { track: "Bonus · Build", feature: "App spec validator (Zod)", where: "src/lib/appSpec.ts", status: "🟢" },
  { track: "Bonus · Demo", feature: "Run replay /run/[runId]", where: "/run/[runId]", status: "🟢" },
  { track: "Bonus · Demo", feature: "Live public dashboard", where: "/live", href: "/live", status: "🟢" },
  { track: "Bonus · Demo", feature: "Scorecard (this page)", where: "/scorecard", href: "/scorecard", status: "🟢" },
  { track: "Bonus · Demo", feature: "HydraDB recall panel in /play", where: "src/components/HydraPanel.tsx", status: "🟢" },
  { track: "Bonus · Demo", feature: "Stats single source of truth", where: "/api/stats", href: "/api/stats", status: "🟢" },
  { track: "Bonus · Surfaces", feature: "Chrome extension (MV3) — landing + download", where: "/extension", href: "/extension", status: "🟢" },
  { track: "Bonus · Surfaces", feature: "Capacitor iOS + Android wrap", where: "capacitor.config.ts", status: "🟡" },
  { track: "Bonus · Surfaces", feature: "Tauri desktop wrap", where: "src-tauri/", status: "🟡" },
  { track: "Bonus · Surfaces", feature: "PWA installable — manifest + SW controlling /os", where: "/manifest.webmanifest", status: "🟢" },
];

export default function Scorecard() {
  const groups: Record<string, Row[]> = {};
  for (const r of ROWS) {
    groups[r.track] = groups[r.track] ?? [];
    groups[r.track].push(r);
  }
  const allGreen = ROWS.filter((r) => r.status === "🟢").length;
  const partial = ROWS.filter((r) => r.status === "🟡").length;
  const planned = ROWS.filter((r) => r.status === "🔴").length;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 glass-header">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link href="/"><Wordmark size={26} /></Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link href="/os" className="btn-pixel success">★ DelOS</Link>
            <Link href="/" className="btn-pixel ghost hidden sm:inline-flex">Home</Link>
            <Link href="/play" className="btn-pixel ghost hidden sm:inline-flex">Play</Link>
            <Link href="/live" className="btn-pixel ghost hidden sm:inline-flex">Live</Link>
            <Link href="/docs" className="btn-pixel ghost hidden md:inline-flex">Docs</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 space-y-8">
        <section>
          <span className="pill pill-muted" style={{ fontSize: 10 }}>★ HACKATHON RUBRIC</span>
          <h1 className="font-pixel text-3xl sm:text-5xl mt-3 mb-3 tracking-wider">
            scorecard.
          </h1>
          <p className="text-[color:var(--muted)] text-sm sm:text-base max-w-2xl">
            Every feature mapped to the four hackathon tracks (Memory · Tools · Recovery · Adaptation) plus bonuses. Click any row to deep-link into the source.
          </p>
          <div className="mt-5 flex gap-2 flex-wrap text-xs font-mono">
            <span className="pill pill-ok">{allGreen} shipped 🟢</span>
            <span className="pill pill-warn">{partial} partial 🟡</span>
            {planned > 0 && <span className="pill pill-bad">{planned} planned 🔴</span>}
          </div>
        </section>

        {Object.entries(groups).map(([track, rows]) => (
          <section key={track} className="card-pixel">
            <h2 className="font-pixel text-lg sm:text-xl tracking-widest mb-3" style={{ color: "var(--accent)" }}>
              {track.toUpperCase()}
            </h2>
            <table className="w-full font-mono text-[11px]">
              <thead>
                <tr style={{ color: "var(--muted)", borderBottom: "1px solid var(--surface-2)" }}>
                  <th className="text-left pb-2" style={{ width: 40 }}>—</th>
                  <th className="text-left pb-2">Feature</th>
                  <th className="text-left pb-2 hidden sm:table-cell">Where</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const cell = (
                    <>
                      <td className="py-1.5">{r.status}</td>
                      <td className="py-1.5" style={{ color: "var(--fg)" }}>{r.feature}</td>
                      <td className="py-1.5 hidden sm:table-cell" style={{ color: "var(--muted)" }}>
                        <code style={{ fontSize: 10 }}>{r.where}</code>
                      </td>
                    </>
                  );
                  return r.href ? (
                    <tr
                      key={i}
                      className="hover:bg-[color:var(--surface-2)]"
                      style={{ cursor: "pointer" }}
                    >
                      <td colSpan={3} style={{ padding: 0 }}>
                        <Link href={r.href} className="block" style={{ padding: 0, textDecoration: "none" }}>
                          <table className="w-full font-mono text-[11px]"><tbody><tr>{cell}</tr></tbody></table>
                        </Link>
                      </td>
                    </tr>
                  ) : (
                    <tr key={i}>{cell}</tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))}

        <section className="card-pixel" style={{ background: "rgba(var(--surface-rgb), 0.5)", backdropFilter: "blur(8px)", borderColor: "var(--accent)" }}>
          <h3 className="font-pixel text-base tracking-widest mb-2" style={{ color: "var(--accent)" }}>★ THE PITCH</h3>
          <p className="text-sm leading-relaxed" style={{ color: "var(--fg)" }}>
            DelOS is the substrate every agent should be built on. Memory in HydraDB graph + local fallback. Tools typed + capability-tagged + MCP-shaped. Recovery via Cockatiel retry, breaker, critic replan, model failover. Adaptation via live STEER, drift detection, context compression. Wrapped in a 24-app browser-OS where agents build the apps live.
          </p>
          <div className="mt-3 flex gap-2 flex-wrap">
            <Link href="/play" className="btn-pixel success">▶ RUN CHAOS DEMO</Link>
            <Link href="/os" className="btn-pixel">★ OPEN DELOS</Link>
            <Link href="/memory" className="btn-pixel ghost">BROWSE MEMORY</Link>
          </div>
        </section>
      </main>
    </div>
  );
}
