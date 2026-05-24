import Link from "next/link";
import { Wordmark } from "@/components/Logo";
import { DelAssistant } from "@/components/os/DelAssistant";

export const metadata = {
  title: "DelOS · Ask",
  description: "Chat with DelOS agents — code, cohort, research, voice. Same orchestrator as DelOS, focused single-page view.",
};

export default function AskPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-50 glass-header">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link href="/"><Wordmark size={26} /></Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link href="/os" className="btn-pixel success">★ DelOS</Link>
            <Link href="/pitch" className="btn-pixel ghost hidden sm:inline-flex">Pitch</Link>
            <Link href="/play" className="btn-pixel ghost hidden sm:inline-flex">Demo</Link>
            <Link href="/docs" className="btn-pixel ghost hidden md:inline-flex">Docs</Link>
          </nav>
        </div>
      </header>

      <main role="main" aria-label="DelOS Ask" className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 flex flex-col" style={{ minHeight: "calc(100vh - 64px)" }}>
        <div className="mb-4">
          <span className="pill pill-muted" style={{ fontSize: 10 }}>★ ASK · CHAT</span>
          <h1 className="font-pixel text-2xl sm:text-3xl mt-3 mb-1 tracking-wider">
            ask <span style={{ color: "var(--accent)" }}>anything</span>.
          </h1>
          <p className="text-[color:var(--muted)] text-sm font-mono">
            Same multi-agent orchestrator as DelOS. Chat · Code · Cohort · Research modes. Voice + memory shared via tenant ID.
          </p>
        </div>

        <div
          className="flex-1 card-pixel overflow-hidden"
          style={{
            padding: 0,
            background: "var(--surface)",
            borderColor: "var(--accent)",
            minHeight: 540,
          }}
        >
          <DelAssistant />
        </div>
      </main>
    </div>
  );
}
