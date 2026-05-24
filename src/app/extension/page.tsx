import Link from "next/link";
import { Wordmark } from "@/components/Logo";
import { ExtStatusBanner } from "@/components/ExtStatusBanner";

export const metadata = {
  title: "DelOS · Chrome Extension",
  description: "Agents that drive your browser in parallel. Side panel · tab tools · long-lived SSE · same tenant ID as DelOS.",
};

const PERMS = [
  { name: "storage", why: "save tenant ID + model overrides locally so the agent feels like your agent" },
  { name: "sidePanel", why: "render the DelOS-style live agent UI without taking over the page" },
  { name: "tabs / activeTab", why: "let the agent see which tab you have open so 'summarize this' works" },
  { name: "scripting", why: "scrape page text + fill forms when YOU ask the agent to (never proactively)" },
  { name: "alarms", why: "keep service-worker awake so SSE doesn't drop mid-run when popup closes" },
  { name: "host_permissions: <all_urls>", why: "let you point the agent at any site you're already authenticated to" },
];

const STEPS = [
  { n: "01", t: "Get the source", d: "Clone or download the chrome-ext/ folder from the DelOS repo. (Chrome Web Store listing coming soon.)" },
  { n: "02", t: "Open chrome://extensions", d: "Toggle Developer Mode → top right." },
  { n: "03", t: "Load unpacked", d: "Click 'Load unpacked' → select the chrome-ext/ folder. The DelOS icon appears in your toolbar." },
  { n: "04", t: "Set your tenant", d: "Click the icon → Options → enter the same tenant ID you use in /os (default: delrio_demo). Memory syncs instantly." },
  { n: "05", t: "Open the side panel", d: "Hit ⌘+Shift+E (or right-click the icon → Open side panel). Run agents while you keep browsing." },
];

export default function ExtensionPage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 glass-header">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link href="/"><Wordmark size={26} /></Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link href="/os" className="btn-pixel success">★ DelOS</Link>
            <Link href="/play" className="btn-pixel ghost hidden sm:inline-flex">Play</Link>
            <Link href="/docs" className="btn-pixel ghost hidden md:inline-flex">Docs</Link>
            <Link href="/scorecard" className="btn-pixel ghost hidden md:inline-flex">Score</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-12 space-y-10">
        <section>
          <span className="pill pill-muted" style={{ fontSize: 10 }}>★ CHROME — THE THIRD LAYER</span>
          <h1 className="font-pixel text-4xl sm:text-6xl mt-4 mb-3 tracking-wider">
            agents that <span style={{ color: "var(--accent)" }}>drive Chrome</span>.
          </h1>
          <p className="text-[color:var(--muted)] text-sm sm:text-base max-w-2xl">
            Same orchestrator. Same tenant ID. Same memory. Different surface. The DelOS Chrome extension is a Manifest V3 side panel that opens beside any page, runs full agent missions via SSE, and can hand work back to DelOS.
          </p>
          <div className="mt-6 flex gap-2 flex-wrap">
            <a
              href="/delrio-chrome.zip"
              download="delrio-chrome.zip"
              className="btn-pixel success"
            >
              ↓ DOWNLOAD SOURCE ZIP
            </a>
            <a
              href="https://github.com/vaibhavlalwani/delrio/tree/main/chrome-ext"
              target="_blank"
              rel="noreferrer"
              className="btn-pixel ghost"
            >
              VIEW ON GITHUB
            </a>
            <Link href="/docs" className="btn-pixel ghost">API DOCS →</Link>
            <span className="pill pill-warn" style={{ fontSize: 10 }}>Web Store listing pending review</span>
          </div>
          <div className="mt-4">
            <ExtStatusBanner />
          </div>
        </section>

        <section className="card-pixel">
          <h2 className="font-pixel text-lg tracking-widest mb-3" style={{ color: "var(--accent)" }}>
            ★ WHAT IT DOES
          </h2>
          <div className="grid sm:grid-cols-2 gap-3 text-[12px]">
            <div className="card-pixel">
              <div className="font-pixel text-sm mb-1" style={{ color: "var(--accent)" }}>Side panel</div>
              <p className="font-mono text-[11px]" style={{ color: "var(--muted)" }}>
                Full DelOS-style live agent UI without leaving the page. Run, cohort, voice, memory recall — all here.
              </p>
            </div>
            <div className="card-pixel">
              <div className="font-pixel text-sm mb-1" style={{ color: "var(--accent)" }}>Long-lived SSE</div>
              <p className="font-mono text-[11px]" style={{ color: "var(--muted)" }}>
                Service worker holds the run stream alive even when you close the popup. Agents keep working.
              </p>
            </div>
            <div className="card-pixel">
              <div className="font-pixel text-sm mb-1" style={{ color: "var(--accent)" }}>Tenant-shared memory</div>
              <p className="font-mono text-[11px]" style={{ color: "var(--muted)" }}>
                Set the same tenant ID as DelOS web. Every run, every memory, every app spec — synced instantly via HydraDB.
              </p>
            </div>
            <div className="card-pixel">
              <div className="font-pixel text-sm mb-1" style={{ color: "var(--accent)" }}>Hand off to DelOS</div>
              <p className="font-mono text-[11px]" style={{ color: "var(--muted)" }}>
                'Send to DelOS' button on any tab → opens delrio.vercel.app/os with the page pre-loaded.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="font-pixel text-2xl tracking-widest mb-4">install in 5 steps</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {STEPS.map((s) => (
              <div key={s.n} className="card-pixel">
                <div className="font-pixel text-3xl mb-2" style={{ color: "var(--accent)" }}>{s.n}</div>
                <div className="font-pixel text-sm mb-1" style={{ color: "var(--fg)" }}>{s.t}</div>
                <p className="font-mono text-[10px] leading-relaxed" style={{ color: "var(--muted)" }}>{s.d}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="card-pixel">
          <h2 className="font-pixel text-lg tracking-widest mb-3" style={{ color: "var(--accent)" }}>
            ★ WHY EACH PERMISSION
          </h2>
          <p className="text-[color:var(--muted)] text-[11px] mb-3">
            Every Chrome permission has a one-line rationale. Read it before installing. DelOS acts only when you explicitly ask — never proactively.
          </p>
          <ul className="space-y-1.5 font-mono text-[11px]">
            {PERMS.map((p) => (
              <li key={p.name} className="flex items-start gap-2">
                <code style={{ color: "var(--accent)", minWidth: 180 }}>{p.name}</code>
                <span style={{ color: "var(--fg)" }}>— {p.why}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card-pixel" style={{ borderColor: "var(--accent)", background: "rgba(var(--surface-rgb), 0.5)", backdropFilter: "blur(8px)" }}>
          <h3 className="font-pixel text-base tracking-widest mb-2" style={{ color: "var(--accent)" }}>★ TENANT-SYNC IS THE MAGIC</h3>
          <p className="text-sm leading-relaxed" style={{ color: "var(--fg)" }}>
            Open <code style={{ background: "var(--bg)", padding: "2px 4px" }}>/os</code> on your laptop, run a mission. Open the Chrome extension on your phone (Capacitor build) or another laptop, paste the same tenant ID — every memory, every built app, every cohort verdict, every voice command shows up. HydraDB partitions by tenant. The agent is one entity across surfaces.
          </p>
          <div className="mt-3 flex gap-2 flex-wrap">
            <Link href="/os" className="btn-pixel success">▶ TRY ON WEB FIRST</Link>
            <Link href="/scorecard" className="btn-pixel ghost">SEE FULL SCORECARD</Link>
          </div>
        </section>

        {/* ASCII QR placeholder — points at /extension itself */}
        <section className="card-pixel text-center">
          <h3 className="font-pixel text-sm tracking-widest mb-3" style={{ color: "var(--muted)" }}>SCAN ON PHONE</h3>
          <pre className="font-mono text-[8px] leading-none inline-block" style={{ color: "var(--fg)" }}>
{`█▀▀▀▀▀█ ▀▄█▀ █▀▀▀▀▀█
█ ███ █ ▄▀▀▄ █ ███ █
█ ▀▀▀ █ ▀▀█▀ █ ▀▀▀ █
▀▀▀▀▀▀▀ █ █ █ ▀▀▀▀▀▀▀
▄▀▀█▀▀▀▀▀▀▀█▄▀█▀▀▀▄
█▄▀▀▀▀▀▄▀▄ ▀█▄ ▄█▀▀
▀ ▀ ▀▀▀ ▀▀▀▀▄▀ ▀▀ █
█▀▀▀▀▀█ ▄▀█▀  █ ▀ ▀
█ ███ █ ▀▀▀▄▀▀ ▀▄▀█
█ ▀▀▀ █ ▀▄▀█ ▀▄█▀▀▄
▀▀▀▀▀▀▀ ▀  ▀  ▀  ▀ ▀`}
          </pre>
          <p className="text-[10px] font-mono mt-2" style={{ color: "var(--muted)" }}>
            delrio.vercel.app/extension
          </p>
        </section>
      </main>
    </div>
  );
}
