import Link from "next/link";
import { Wordmark, Logo } from "@/components/Logo";
import { HeroTerminal } from "@/components/HeroTerminal";
import { InteractiveMac } from "@/components/InteractiveMac";
import { LiveMetricsLine } from "@/components/LiveMetricsLine";
import { getSiteStats, type SiteStats } from "@/lib/stats";

// Landing reads counts from the same source /api/stats serves so numbers
// never drift between "48h · 7 LLMs · 23 apps" and the actual app surface.
// MODEL_CATALOG.length is the canonical LLM count (P0-10 single source of
// truth) — bump pricing teaser + OG/Twitter cards when adding providers.
export const revalidate = 60;

const pillars = [
  { name: "Save State", sub: "Memory", desc: "HydraDB graph + vector recall across runs. Agents remember what worked, what didn't, what you told them last Tuesday.", icon: "★" },
  { name: "Power-Ups", sub: "Tools", desc: "Typed tool registry with capability tags. MCP-shaped. Live marketplace with bundled + custom servers. Sibling fallback on failure.", icon: "⚒" },
  { name: "1-Up", sub: "Recovery", desc: "Cockatiel retry + circuit breakers. Critic agent triggers replans on drift. Model failover. Tool sibling fallback. Three layers of resilience.", icon: "♥" },
  { name: "Warp Zone", sub: "Adaptation", desc: "Goal drift detection. User interrupts mid-stream rebuild the plan. Live STEER from any device. Context flood compressed at the boundary.", icon: "↯" },
];

const useCases = [
  { title: "Research copilot", desc: "Multi-source web research with critic verification + memory across sessions.", icon: "Search" },
  { title: "Workflow automation", desc: "Chain agents, tools, MCPs into reusable missions. Voice-triggered.", icon: "Workflow" },
  { title: "Personal OS", desc: "Browser-based desktop where you build mini-apps on demand by talking to it.", icon: "Monitor" },
  { title: "Support agent", desc: "Del Assistant drafts Gmail replies, opens tickets in Notion, and references GitHub issues — all from one chat.", icon: "Headphones" },
  { title: "Data analyst", desc: "Plan → SQL → run → critique → re-plan if drift. Pipe to charts via spec apps.", icon: "BarChart3" },
  { title: "Voice assistant", desc: "Whisper STT + ElevenLabs TTS + autonomy mode. Hands-free everything.", icon: "Mic" },
];

const stack = [
  "Next.js 16", "React 19", "TypeScript", "Tailwind v4",
  "HydraDB", "Groq", "Mistral", "Gemini", "ElevenLabs",
  "Vercel AI SDK v6", "Cockatiel", "Zod v4", "framer-motion",
  "MCP", "AsyncLocalStorage", "Web Speech API", "PWA", "Tauri",
];

function buildStatsRow(s: SiteStats) {
  return [
    { v: "48h", k: "Built in" },
    { v: String(s.models.length), k: "LLMs" },
    { v: String(s.apps), k: "Desktop apps" },
    { v: String(s.tools.total), k: "Tools + MCP" },
    { v: "$0", k: "Free tier" },
  ];
}

const faqs = [
  { q: "Is this real or just a demo?", a: "Every endpoint hits real APIs: Groq Whisper for STT, ElevenLabs for premium TTS, Mistral / Gemini / Groq for LLM routing, HydraDB for memory, plus Gmail / Notion / GitHub / GDrive MCPs in Del Assistant. The token / cost counters in the Terminal aren't simulated." },
  { q: "Do I need API keys?", a: "Self-host with free-tier keys for Groq + Mistral + Gemini + HydraDB. ElevenLabs is optional — falls back to browser TTS. Total monthly cost at modest usage: $0." },
  { q: "What's MCP?", a: "Model Context Protocol — JSON-RPC tool servers. DelOS ships a bundled MCP server with 11 tools (crypto price, weather, dictionary, …) and accepts any HTTP MCP URL in Settings." },
  { q: "How does voice autonomy work?", a: "Hold the mic, say \"build me a calculator,\" Whisper transcribes, a small LLM maps it to an intent action, the OS executes — opens App Builder, prefills the prompt, hits BUILD." },
  { q: "Can it run offline?", a: "The OS shell + games + window manager run offline. Agent calls need network. Install as PWA for offline shell. Tauri build available for native desktop." },
  { q: "How does cross-device sync work?", a: "Set the same Tenant ID in Settings → Device on every install. HydraDB partitions memory by tenant — instant sync across Mac / Win / Linux / iOS / Android / Chrome extension." },
];

export default async function Home() {
  const stats = await getSiteStats();
  return (
    <div className="min-h-screen relative overflow-x-hidden">
      <Header />
      <main role="main" aria-label="DelOS landing" className="overflow-x-hidden">
        <Hero apps={stats.apps} />
        <StatBar stats={stats} />
        <Pillars />
        <HowItWorks />
        <DesktopShowcase apps={stats.apps} />
        <RealWorldUses />
        <UseCases />
        <Stack />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}

function Header() {
  return (
    <header
      className="sticky top-0 z-50 glass-header"
    >
      {/* Header was clipping at 390px because nav children couldn't shrink
          below their text widths and gap stacked them past viewport. flex-
          wrap lets the nav reflow onto a second line on narrow viewports;
          shrink-0 on the brand keeps the wordmark intact. */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <Wordmark size={26} />
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm flex-wrap justify-end min-w-0">
          <Link href="/os?guest=1" className="btn-pixel success text-xs sm:text-sm">★ DelOS</Link>
          <Link href="/auth" className="btn-pixel ghost text-xs sm:text-sm">Sign in</Link>
          <Link href="/pitch" className="btn-pixel ghost text-xs sm:text-sm hidden sm:inline-flex">Pitch</Link>
          <Link href="/arena" className="btn-pixel ghost text-xs sm:text-sm hidden md:inline-flex">Arena</Link>
          <Link href="/live" className="btn-pixel ghost text-xs sm:text-sm hidden md:inline-flex">Live</Link>
          <Link href="/memory" className="btn-pixel ghost text-xs sm:text-sm hidden md:inline-flex">Memory</Link>
          <Link href="/skills" className="btn-pixel ghost text-xs sm:text-sm hidden lg:inline-flex">Skills</Link>
          <Link href="/scorecard" className="btn-pixel ghost text-xs sm:text-sm hidden lg:inline-flex">Score</Link>
          <Link href="/docs" className="btn-pixel ghost text-xs sm:text-sm hidden lg:inline-flex">Docs</Link>
        </nav>
      </div>
    </header>
  );
}

function Hero({ apps }: { apps: number }) {
  return (
    <section className="relative overflow-hidden hero-bg">
      {/* Animated grid backdrop */}
      <div
        className="absolute inset-0 opacity-30 pointer-events-none"
        style={{
          background:
            "repeating-linear-gradient(0deg, transparent 0 38px, rgba(var(--fg-rgb), 0.04) 38px 40px), repeating-linear-gradient(90deg, transparent 0 38px, rgba(var(--fg-rgb), 0.04) 38px 40px)",
        }}
      />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pt-12 sm:pt-20 pb-12 sm:pb-20 grid lg:grid-cols-2 gap-10 items-center">
        <div>
          {/* Eyebrow per Anthropic Design package — pixel font reserved for tracked-out
             accent labels only, not the main headline. */}
          <div className="eyebrow mb-5">
            <span className="dot" />
            AGENTS UNDER PRESSURE · HYDRADB HACKATHON 2026
          </div>
          {/* Pixel headline — Pixelify Sans across the whole hero so the brand voice
             stays consistent with the OS dock, badges, and HUD type. */}
          <h1
            className="font-pixel leading-[1.1] mb-4"
            style={{
              fontWeight: 700,
              letterSpacing: "0.01em",
              fontSize: "clamp(22px, 3.4vw, 40px)",
            }}
          >
            The AI operating system{" "}
            <span style={{ color: "var(--muted-2)" }}>where</span>{" "}
            agents{" "}
            <span
              className="font-serif-italic"
              style={{ color: "var(--accent)", fontWeight: 600, letterSpacing: "0.005em" }}
            >
              flow
            </span>{" "}
            under pressure.
          </h1>
          <p
            className="font-pixel text-[color:var(--muted)] max-w-xl"
            style={{
              fontSize: "clamp(12px, 1.05vw, 14px)",
              lineHeight: 1.5,
              letterSpacing: "0.015em",
            }}
          >
            Browser-OS where <span style={{ color: "var(--fg)" }}>memory</span>,{" "}
            <span style={{ color: "var(--fg)" }}>tools</span>,{" "}
            <span style={{ color: "var(--fg)" }}>recovery</span>, and{" "}
            <span style={{ color: "var(--fg)" }}>adaptation</span> are wired in by default. Multi-agent orchestration as a substrate. Real APIs, no mocks.{" "}
            <span style={{ color: "var(--accent)" }}>Agents build the apps live.</span>
          </p>
          <div className="mt-7 flex flex-wrap gap-2 sm:gap-3">
            <Link href="/os?guest=1" className="btn-pixel success magnet" style={{ fontSize: 13, padding: "10px 16px" }}>
              ★ LAUNCH DELOS →
            </Link>
            <Link href="/docs" className="btn-pixel ghost hidden sm:inline-flex" style={{ fontSize: 13, padding: "10px 16px" }}>
              DOCS
            </Link>
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-2 text-xs font-mono text-[color:var(--muted)]">
            <span>powered by</span>
            <span className="pill pill-muted" style={{ fontSize: 10 }}>HydraDB</span>
            <span className="pill pill-muted" style={{ fontSize: 10 }}>Groq</span>
            <span className="pill pill-muted" style={{ fontSize: 10 }}>Mistral</span>
            <span className="pill pill-muted" style={{ fontSize: 10 }}>Gemini</span>
            <span className="pill pill-muted" style={{ fontSize: 10 }}>ElevenLabs</span>
            <span className="pill pill-muted" style={{ fontSize: 10 }}>MCP</span>
          </div>
        </div>

        <div className="relative flex items-center justify-center">
          <div className="hidden lg:block absolute -inset-8 opacity-40 pointer-events-none" style={{ background: "radial-gradient(circle, var(--ring) 0%, transparent 70%)" }} />
          <InteractiveMac />
        </div>
      </div>

      {/* Live terminal preview row */}
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pb-16 grid lg:grid-cols-5 gap-6 items-stretch">
        <div className="lg:col-span-3">
          <HeroTerminal />
        </div>
        <div className="lg:col-span-2 space-y-3">
          <div className="card-pixel">
            <div className="flex items-center gap-2 mb-1">
              <span className="pill pill-ok" style={{ fontSize: 9 }}>● LIVE</span>
              <span className="font-pixel text-xs tracking-widest" style={{ color: "var(--fg)" }}>real APIs · no mock</span>
            </div>
            <p className="text-[11px] text-[color:var(--muted)] font-mono leading-relaxed">
              every line in that terminal hits real models. tokens, cost, ms — all measured live.
            </p>
          </div>
          <div className="card-pixel">
            <div className="font-pixel text-xs tracking-widest mb-1" style={{ color: "var(--accent)" }}>★ THE EDGE</div>
            <ul className="text-[11px] font-mono space-y-0.5" style={{ color: "var(--fg)" }}>
              <li>· planner → executor → critic → memory</li>
              <li>· cockatiel retry + breaker fallback</li>
              <li>· Del Assistant · Gmail / Notion / GitHub / GDrive MCPs</li>
              <li>· voice autonomy via Whisper + 11labs</li>
              <li>· live STEER mid-stream</li>
            </ul>
          </div>
          <Link
            href="/os?guest=1"
            className="card-pixel block group"
            style={{ borderColor: "var(--accent)", textDecoration: "none" }}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="font-pixel text-sm tracking-widest" style={{ color: "var(--accent)" }}>OPEN DELOS</div>
                <div className="text-[11px] text-[color:var(--muted)] font-mono mt-0.5">{apps} apps · 0 sign-up</div>
              </div>
              <div className="font-pixel text-2xl group-hover:translate-x-1 transition-transform" style={{ color: "var(--accent)" }}>→</div>
            </div>
          </Link>
        </div>
      </div>
    </section>
  );
}

function StatBar({ stats }: { stats: SiteStats }) {
  const row = buildStatsRow(stats);
  return (
    <section
      className="border-y-2 py-6 sm:py-8"
      style={{ background: "var(--surface)", borderColor: "var(--surface-2)" }}
    >
      {/* 5-col was overflowing 390px viewports — 2 / 3 / 5 staircase keeps */}
      {/* every stat tile readable + the page total width under viewport. */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-5 gap-3 sm:gap-4 overflow-hidden">
        {row.map((s) => (
          <div key={s.k} className="text-center min-w-0">
            <div className="font-pixel text-xl sm:text-3xl md:text-4xl truncate" style={{ color: "var(--accent)" }}>{s.v}</div>
            <div className="text-[9px] sm:text-xs text-[color:var(--muted)] uppercase tracking-wider mt-1 truncate">{s.k}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Pillars() {
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
      <div className="mb-10 max-w-3xl">
        <span className="pill pill-muted" style={{ fontSize: 10 }}>★ FOUR PILLARS</span>
        <h2 className="font-pixel text-3xl sm:text-4xl mt-4 mb-3 tracking-wider">
          four power-ups, <span style={{ color: "var(--accent)" }}>wired in</span>.
        </h2>
        <p className="text-[color:var(--muted)] text-sm sm:text-base">Every DelOS run goes through all four layers, every time. Not an afterthought — the substrate.</p>
      </div>
      <div className="grid md:grid-cols-2 gap-3 sm:gap-4">
        {pillars.map((p, i) => (
          <div
            key={p.name}
            className="card-pixel group"
            style={{
              transition: "transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1)",
            }}
          >
            <div className="flex items-start justify-between mb-2 gap-3">
              <div className="flex items-center gap-3">
                <div
                  className="font-pixel text-2xl flex items-center justify-center"
                  style={{
                    width: 44,
                    height: 44,
                    background: "var(--surface-2)",
                    color: "var(--accent)",
                    border: "2px solid var(--accent)",
                    boxShadow: "2px 2px 0 var(--shadow)",
                  }}
                >
                  {p.icon}
                </div>
                <div>
                  <h3 className="font-pixel text-lg sm:text-xl tracking-wider" style={{ color: "var(--fg)" }}>
                    {p.name}
                  </h3>
                  <span className="pill pill-info" style={{ fontSize: 9 }}>{p.sub}</span>
                </div>
              </div>
              <div className="font-pixel text-xl opacity-30" style={{ color: "var(--accent)" }}>
                0{i + 1}
              </div>
            </div>
            <p className="text-[color:var(--muted)] leading-relaxed text-sm">{p.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { n: "01", t: "Plan", d: "Planner LLM reads goal + memory + decides fan-out. Outputs typed steps.", icon: "Brain" },
    { n: "02", t: "Execute", d: "Executor picks a tool from merged registry (local + MCP) via cockatiel retry + breaker.", icon: "Cpu" },
    { n: "03", t: "Critique", d: "Critic scores drift after each step. Replans on >0.5. Mistral → Gemini failover.", icon: "Eye" },
    { n: "04", t: "Remember", d: "HydraDB stores run summary by tenant. Local fallback keeps UI live during indexing.", icon: "Database" },
  ];
  return (
    <section
      className="border-y-2 py-16 sm:py-20"
      style={{ background: "var(--surface)", borderColor: "var(--surface-2)" }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="mb-10 max-w-3xl">
          <span className="pill pill-muted" style={{ fontSize: 10 }}>★ THE LOOP</span>
          <h2 className="font-pixel text-3xl sm:text-4xl mt-4 mb-3 tracking-wider">
            how it <span style={{ color: "var(--accent)" }}>flows</span>.
          </h2>
          <p className="text-[color:var(--muted)] text-sm sm:text-base">Every mission, every time. Deterministic loop, non-deterministic models.</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 relative">
          {steps.map((s, i) => (
            <div key={s.n} className="card-pixel relative">
              <div className="flex items-center justify-between mb-3">
                <div className="font-pixel text-3xl sm:text-4xl" style={{ color: "var(--accent)" }}>{s.n}</div>
                {i < steps.length - 1 && (
                  <div className="hidden lg:block absolute -right-3 top-1/2 -translate-y-1/2 text-xl font-pixel" style={{ color: "var(--accent)" }}>→</div>
                )}
              </div>
              <div className="font-pixel text-lg sm:text-xl mb-1" style={{ color: "var(--fg)" }}>{s.t}</div>
              <p className="text-xs sm:text-sm text-[color:var(--muted)] leading-relaxed">{s.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function DesktopShowcase({ apps }: { apps: number }) {
  // Featured row — only the agent-substrate apps that prove the pitch.
  // Snake / TicTac / Calculator / SysInfo live behind Cmd+K; they shouldn't
  // share top-billing with Del Assistant on the marketing surface.
  const featured = [
    { i: "Sparkles", l: "Del Assistant" },
    { i: "Brain", l: "Identity" },
    { i: "FolderOpen", l: "Ingest" },
    { i: "Wrench", l: "App Builder" },
    { i: "Mail", l: "Gmail MCP" },
    { i: "Cpu", l: "Cores" },
    { i: "TerminalSquare", l: "Terminal" },
    { i: "Globe", l: "Browser" },
    { i: "Mic", l: "Voice" },
    { i: "Radio", l: "Mission" },
    { i: "Database", l: "Memory" },
    { i: "Box", l: "+ build" },
  ];
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
      <div className="grid lg:grid-cols-2 gap-10 items-center">
        <div>
          <span className="pill pill-muted" style={{ fontSize: 10 }}>★ THE OS</span>
          <h2 className="font-pixel text-3xl sm:text-4xl mt-4 mb-4 tracking-wider">
            browser-OS where <span style={{ color: "var(--accent)" }}>agents build the apps</span>.
          </h2>
          <p className="text-[color:var(--muted)] text-sm sm:text-base mb-6 leading-relaxed">
            DelOS is a full window-managed desktop in a tab. Del Assistant (autonomous Gmail / Notion / GitHub / GDrive MCPs), Identity Core, Ingest Vault, VibeCode App Builder, DevFactory Cores — plus an App Builder that compiles your spoken prompt into a working mini-app live.
          </p>
          <div className="grid grid-cols-2 gap-2 text-[11px] font-mono mb-6" style={{ color: "var(--fg)" }}>
            <div>✓ {apps} apps shipped</div>
            <div>✓ macOS-style dock</div>
            <div>✓ Window snap + maximize</div>
            <div>✓ Cmd+K palette</div>
            <div>✓ Voice autonomy</div>
            <div>✓ Multi-agent live</div>
            <div>✓ MCP marketplace</div>
            <div>✓ Light + dark theme</div>
            <div>✓ PWA + Tauri + iOS/Android</div>
            <div>✓ Cross-device sync</div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Link href="/os?guest=1" className="btn-pixel">▶ OPEN DELOS</Link>
          </div>
        </div>

        <div className="card-pixel" style={{ padding: 0, overflow: "hidden", borderColor: "var(--accent)" }}>
          <div className="px-3 py-2 flex items-center justify-between" style={{ background: "var(--accent)", color: "var(--on-accent)" }}>
            <div className="flex items-center gap-2">
              <Logo size={18} />
              <span className="font-pixel text-xs tracking-widest">★ DELOS · LIVE PREVIEW</span>
            </div>
            <span className="font-mono text-[10px]">v2.0</span>
          </div>
          <div className="p-4 grid grid-cols-4 sm:grid-cols-6 gap-2" style={{ background: "var(--surface)" }}>
            {featured.map((a) => (
              <div
                key={a.l}
                className="card-pixel flex flex-col items-center gap-1 text-center"
                style={{ padding: "8px 4px" }}
              >
                <span className="font-pixel text-lg" style={{ color: "var(--accent)" }}>★</span>
                <span className="font-pixel" style={{ fontSize: 8, color: "var(--fg)", letterSpacing: "0.05em" }}>{a.l.toUpperCase()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// Real-world use cases · concrete day-in-the-life patterns that judges +
// recruiters can map to actual products they ship. Each card opens DelOS
// at the matching app via deep link so the demo path is one click long.
function RealWorldUses() {
  const uses = [
    { tag: "MORNING", icon: "Mic", title: "Voice-only inbox triage", body: 'Say "summarize my last 10 emails and draft replies to the urgent ones." Reads Gmail, drafts in your tone, lands in Drafts ready to review.', link: "/os?guest=1" },
    { tag: "BUILD", icon: "Sparkles", title: "Ship a SaaS prototype before lunch", body: '"Build me a Stripe dashboard clone with KPI cards, charts, and a recent payments table." Real working app in 1.2s with full brand fidelity.', link: "/os?guest=1" },
    { tag: "RESEARCH", icon: "Search", title: "Ask Del Assistant to research anything", body: 'Open Del Assistant, ask "research the top 5 open-source AI agent frameworks". The assistant queries memory + web tools + drafts a markdown report you can paste into Notion in one click.', link: "/os?guest=1" },
    { tag: "CHAOS", icon: "AlertTriangle", title: "Survive provider outages mid-demo", body: 'Groq rate-limited? The orchestrator hops Mistral → Gemini → Bytez in under a second. The user never sees a 429. The chaos demo proves it on stage.', link: "/play" },
    { tag: "MEMORY", icon: "Database", title: "Cross-session recall via HydraDB", body: 'Yesterday you compared graph vs vector DBs. Today, ask Del Assistant. It remembers what you concluded, who you cited, and what you decided next.', link: "/memory" },
    { tag: "ORGANIZE", icon: "FolderTree", title: 'Voice-drive the whole desktop', body: '"Open terminal, calculate 17 times 19, then build me a habit tracker." Compound voice commands fan out into chained actions across the OS.', link: "/os?guest=1" },
  ];
  return (
    <section className="border-y-2 py-16 sm:py-20" style={{ background: "var(--surface)", borderColor: "var(--surface-2)" }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="mb-10 max-w-3xl">
          <span className="pill pill-muted" style={{ fontSize: 10 }}>★ REAL-WORLD WORKFLOWS</span>
          <h2 className="font-pixel text-3xl sm:text-4xl mt-4 mb-3 tracking-wider">
            what you can <span style={{ color: "var(--accent)" }}>actually do</span> with it.
          </h2>
          <p className="text-[color:var(--muted)] text-sm sm:text-base">Six concrete patterns. Each one shippable today on free tiers. Each one tested live in the videos below.</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {uses.map((u) => (
            <Link key={u.title} href={u.link} className="card-pixel group block" style={{ textDecoration: "none" }}>
              <div className="flex items-center justify-between mb-2">
                <span className="pill pill-info" style={{ fontSize: 9 }}>{u.tag}</span>
                <span className="font-pixel text-xs opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all" style={{ color: "var(--accent)" }}>→</span>
              </div>
              <h3 className="font-pixel text-sm sm:text-base mb-2 tracking-wider" style={{ color: "var(--fg)" }}>{u.title}</h3>
              <p className="text-xs sm:text-[13px] text-[color:var(--muted)] leading-relaxed">{u.body}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function UseCases() {
  return (
    <section
      className="border-y-2 py-16 sm:py-20"
      style={{ background: "var(--surface)", borderColor: "var(--surface-2)" }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="mb-10 max-w-3xl">
          <span className="pill pill-muted" style={{ fontSize: 10 }}>★ USE CASES</span>
          <h2 className="font-pixel text-3xl sm:text-4xl mt-4 mb-3 tracking-wider">what you can build.</h2>
          <p className="text-[color:var(--muted)] text-sm sm:text-base">DelOS is the substrate. You decide the mission.</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {useCases.map((u) => (
            <div key={u.title} className="card-pixel">
              <h3 className="font-pixel text-sm sm:text-base mb-2 tracking-wider" style={{ color: "var(--accent)" }}>{u.title}</h3>
              <p className="text-xs sm:text-sm text-[color:var(--muted)] leading-relaxed">{u.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Stack() {
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
      <div className="mb-8 max-w-3xl">
        <span className="pill pill-muted" style={{ fontSize: 10 }}>★ STACK</span>
        <h2 className="font-pixel text-3xl sm:text-4xl mt-4 mb-3 tracking-wider">built on the right things.</h2>
        <p className="text-[color:var(--muted)] text-sm sm:text-base">No proprietary lock-in. Swap any provider via Settings.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {stack.map((s) => (
          <span key={s} className="pill pill-muted" style={{ fontSize: 11 }}>{s}</span>
        ))}
      </div>
    </section>
  );
}

function PricingTeaser() {
  const tiers = [
    { name: "Free", price: "$0", tag: "Hackathon", lines: ["All 4 pillars", "Bundled MCP", "Voice agents", "7 LLMs", "PWA + extensions", "Self-host"] },
    { name: "Pro", price: "$19", tag: "per month", featured: true, lines: ["Everything in Free", "Hosted HydraDB", "ElevenLabs key passthrough", "Priority Groq quota", "Email support", "Custom domain"] },
    { name: "Enterprise", price: "Custom", tag: "Contact", lines: ["Everything in Pro", "SSO + audit logs", "Private MCP fleet", "SLA", "On-prem Tauri", "Dedicated success"] },
  ];
  return (
    <section
      className="border-y-2 py-16 sm:py-20"
      style={{ background: "var(--surface)", borderColor: "var(--surface-2)" }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="mb-10 max-w-3xl">
          <span className="pill pill-muted" style={{ fontSize: 10 }}>★ PRICING</span>
          <h2 className="font-pixel text-3xl sm:text-4xl mt-4 mb-3 tracking-wider">pricing.</h2>
          <p className="text-[color:var(--muted)] text-sm sm:text-base">Self-host free forever. Pay only if you want it managed.</p>
        </div>
        <div className="grid md:grid-cols-3 gap-3 sm:gap-4">
          {tiers.map((t) => (
            <div
              key={t.name}
              className="card-pixel"
              style={{
                borderColor: t.featured ? "var(--accent)" : "var(--surface-2)",
                boxShadow: t.featured
                  ? "0 0 0 2px var(--bg), 0 0 0 4px var(--accent), 8px 8px 0 var(--shadow)"
                  : undefined,
              }}
            >
              <div className="flex items-baseline justify-between">
                <h3 className="font-pixel text-xl sm:text-2xl tracking-wider" style={{ color: t.featured ? "var(--accent)" : "var(--fg)" }}>
                  {t.name}
                </h3>
                {t.featured && <span className="pill pill-info" style={{ fontSize: 9 }}>★ POPULAR</span>}
              </div>
              <div className="font-pixel text-3xl sm:text-4xl mt-2" style={{ color: "var(--accent)" }}>{t.price}</div>
              <div className="text-[10px] text-[color:var(--muted)] tracking-wider uppercase mt-1">{t.tag}</div>
              <ul className="mt-4 space-y-1 text-xs sm:text-sm">
                {t.lines.map((l) => <li key={l} className="flex gap-2"><span style={{ color: "var(--success)" }}>✓</span> {l}</li>)}
              </ul>
              <Link href="/pricing" className={`btn-pixel ${t.featured ? "" : "ghost"} mt-4 w-full justify-center`} style={{ fontSize: 12 }}>
                {t.name === "Enterprise" ? "CONTACT" : "GET STARTED"}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section className="max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
      <div className="mb-8">
        <span className="pill pill-muted" style={{ fontSize: 10 }}>★ FAQ</span>
        <h2 className="font-pixel text-3xl sm:text-4xl mt-4 mb-3 tracking-wider">questions.</h2>
      </div>
      <div className="space-y-2">
        {faqs.map((f) => (
          <details key={f.q} className="card-pixel group">
            <summary className="font-pixel text-sm sm:text-base tracking-wider cursor-pointer flex items-center justify-between gap-3" style={{ color: "var(--accent)" }}>
              <span>{f.q}</span>
              <span className="font-pixel text-lg transition-transform group-open:rotate-45" style={{ color: "var(--accent)" }}>+</span>
            </summary>
            <p className="mt-3 text-[color:var(--muted)] leading-relaxed text-sm">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section
      className="relative overflow-hidden border-t-2 hero-bg"
      style={{ borderColor: "var(--surface-2)" }}
    >
      <div className="absolute inset-0 opacity-30 pointer-events-none" style={{ background: "radial-gradient(circle at 50% 50%, var(--ring) 0%, transparent 60%)" }} />
      <div className="relative max-w-4xl mx-auto px-4 sm:px-6 py-20 sm:py-24 text-center">
        <Logo size={64} className="mx-auto mb-6 float" />
        <h2 className="font-pixel text-4xl sm:text-5xl md:text-6xl mb-5 tracking-wider leading-tight">
          ship agents that <br /><span className="shimmer">survive chaos</span>.
        </h2>
        <p className="text-[color:var(--muted)] mb-10 max-w-2xl mx-auto text-sm sm:text-base">
          Open DelOS. Speak to it. Watch four LLMs collaborate live. Build an app with your voice. Win.
        </p>
        <div className="flex justify-center gap-2 sm:gap-3 flex-wrap">
          <Link href="/os?guest=1" className="btn-pixel success magnet" style={{ fontSize: 14, padding: "12px 22px" }}>
            ★ LAUNCH DELOS →
          </Link>
          <Link href="/docs" className="btn-pixel ghost" style={{ fontSize: 14, padding: "12px 22px" }}>
            READ THE DOCS
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer
      className="border-t-2 py-10"
      style={{ background: "var(--surface)", borderColor: "var(--surface-2)" }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 grid sm:grid-cols-4 gap-8 text-sm">
        <div>
          <Wordmark size={24} />
          <p className="text-[color:var(--muted)] mt-3 text-xs leading-relaxed">
            DelOS — the AI operating system.<br />Built in 48h for the HydraDB hackathon.
          </p>
        </div>
        <div>
          <h4 className="font-pixel text-xs tracking-widest mb-3" style={{ color: "var(--accent)" }}>PRODUCT</h4>
          <ul className="space-y-1.5 text-xs text-[color:var(--muted)]">
            <li><Link href="/os?guest=1">DelOS</Link></li>
            <li><Link href="/play">Chaos demo</Link></li>
            <li><Link href="/memory">Memory browser</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="font-pixel text-xs tracking-widest mb-3" style={{ color: "var(--accent)" }}>DEVELOPERS</h4>
          <ul className="space-y-1.5 text-xs text-[color:var(--muted)]">
            <li><Link href="/docs">API docs</Link></li>
            <li><Link href="/status">Status</Link></li>
            <li><a href="https://discord.gg/UYsxv9PNU" target="_blank" rel="noreferrer">Hackathon Discord</a></li>
          </ul>
        </div>
        <div>
          <h4 className="font-pixel text-xs tracking-widest mb-3" style={{ color: "var(--accent)" }}>PILLARS</h4>
          <ul className="space-y-1.5 text-xs text-[color:var(--muted)]">
            <li>Memory · Save State</li>
            <li>Tools · Power-Ups</li>
            <li>Recovery · 1-Up</li>
            <li>Adaptation · Warp Zone</li>
          </ul>
        </div>
      </div>
      <div
        className="max-w-7xl mx-auto px-4 sm:px-6 mt-8 pt-6 border-t flex flex-col sm:flex-row justify-between text-[10px] text-[color:var(--muted)] gap-2 font-mono"
        style={{ borderColor: "var(--surface-2)" }}
      >
        <span>© 2026 DelOS · Built for Agents Under Pressure · HydraDB</span>
        <LiveMetricsLine />
      </div>
    </footer>
  );
}
