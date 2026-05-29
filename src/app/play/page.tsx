"use client";
import { useState, useRef } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/Logo";
import { AgentLog } from "@/components/AgentLog";
import { ChaosControls } from "@/components/ChaosControls";
import { RunMetrics } from "@/components/RunMetrics";
import { HydraPanel } from "@/components/HydraPanel";
import type { ChaosKind, RunEvent } from "@/lib/types";
import { AgentConstellation } from "@/components/AgentConstellation";
import { getModelOverrides } from "@/lib/useModelOverrides";
import { useWakeLock } from "@/lib/useWakeLock";
import { shareContent, haptic } from "@/lib/mobile";

const PRESETS = [
  {
    label: "Research summary",
    goal: "Find three trustworthy facts about why graph databases beat vector databases for AI agent memory, then summarize in 3 bullets.",
  },
  {
    label: "Math + research",
    goal: "Search for the population of Tokyo as of 2024, then calculate what 12% of it equals. Return both numbers and the source.",
  },
  {
    label: "Multi-step plan",
    goal: "Plan a 5-step go-to-market for a new pixel-art productivity app targeting solo developers. Include channels and one risk per step.",
  },
  {
    label: "Adaptive goal",
    goal: "Find the capital of France.",
  },
];

export default function PlayPage() {
  const [goal, setGoal] = useState(PRESETS[0].goal);
  const [chaos, setChaos] = useState<Set<ChaosKind>>(new Set());
  const [interrupt, setInterrupt] = useState<boolean>(false);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [base, setBase] = useState<number>(Date.now());
  const [metrics, setMetrics] = useState<Record<string, number>>({});
  const [shareRun, setShareRun] = useState<{ runId: string; url: string } | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const ctrlRef = useRef<AbortController | null>(null);

  // Keep the screen awake while a mission streams — a phone left on the run
  // view won't dim/lock mid-orchestration. No-ops on desktop / unsupported.
  useWakeLock(running);

  function copyShare() {
    if (!shareRun) return;
    haptic("tap");
    // Mobile: open the native share sheet so the run link can go straight to
    // Messages/WhatsApp/etc. Desktop / unsupported: fall back to clipboard,
    // then to a manual copy prompt.
    void shareContent({
      title: "DelOS run replay",
      text: "Watch this multi-agent run replay on DelOS:",
      url: shareRun.url,
    }).then((result) => {
      if (result === "shared" || result === "copied") {
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 1800);
      } else if (result === "failed" && !navigator.share) {
        window.prompt("Copy this share link:", shareRun.url);
      }
    });
  }

  async function run() {
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setEvents([]);
    setMetrics({});
    setBase(Date.now());
    setRunning(true);
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal,
          chaos: [...chaos],
          interrupt: interrupt
            ? { afterSteps: 1, newGoal: "Actually, ignore that — find the capital of Japan instead." }
            : undefined,
          models: getModelOverrides(),
        }),
        signal: ctrl.signal,
      });
      if (!res.body) throw new Error("No stream body");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const p of parts) {
          const line = p.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          try {
            const ev = JSON.parse(line.slice(6)) as RunEvent;
            setEvents((prev) => {
              const next = [...prev, ev];
              // Persist final snapshot to localStorage when run ends (durable replay across Lambda cold starts)
              if (ev.t === "phase" && ev.phase === "done") {
                try {
                  const meta = next.find((e) => e.t === "meta");
                  const runId = meta && meta.t === "meta" ? meta.runId : null;
                  if (runId) {
                    const key = `delos.runlog.${runId}`;
                    localStorage.setItem(key, JSON.stringify({ runId, goal, startedAt: base, endedAt: Date.now(), events: next }));
                    // Trigger share-this-run toast
                    const url = `${window.location.origin}/run/${runId}`;
                    setShareRun({ runId, url });
                    // Trim old runs to last 12
                    const ids: string[] = JSON.parse(localStorage.getItem("delos.runlog.index") ?? "[]");
                    ids.unshift(runId);
                    const trimmed = ids.slice(0, 12);
                    for (const old of ids.slice(12)) {
                      try { localStorage.removeItem(`delos.runlog.${old}`); } catch {}
                    }
                    localStorage.setItem("delos.runlog.index", JSON.stringify(trimmed));
                  }
                } catch {}
              }
              return next;
            });
            if (ev.t === "metric") setMetrics((m) => ({ ...m, [ev.key]: ev.value }));
          } catch {
            /* ignore malformed */
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setEvents((prev) => [...prev, { t: "error", message: (e as Error).message, at: Date.now() }]);
      }
    } finally {
      setRunning(false);
    }
  }

  function stop() {
    ctrlRef.current?.abort();
    setRunning(false);
  }

  return (
    <div className="min-h-screen scanlines">
      <header className="sticky top-0 z-50 glass-header">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link href="/"><Wordmark size={26} /></Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link href="/os" className="btn-pixel success">★ DelOS</Link>
            <Link href="/" className="btn-pixel ghost hidden sm:inline-flex">Home</Link>
            <Link href="/memory" className="btn-pixel ghost hidden sm:inline-flex">Memory</Link>
            <Link href="/docs" className="btn-pixel ghost hidden md:inline-flex">Docs</Link>
          </nav>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-8 pb-4">
        <span className="pill pill-muted" style={{ fontSize: 10 }}>★ CHAOS DEMO</span>
        <h1 className="font-pixel text-3xl sm:text-4xl mt-3 mb-2 tracking-wider">
          inject chaos. watch agents <span style={{ color: "var(--accent)" }}>survive</span>.
        </h1>
        <p className="text-[color:var(--muted)] text-sm">Toggle failures + interrupts on the left. Hit start. See live trace.</p>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 pb-12 grid lg:grid-cols-5 gap-4 sm:gap-6">
        <section className="lg:col-span-2 space-y-4">
          <h2 className="font-pixel text-xl tracking-wider">Mission</h2>
          <textarea
            className="input-pixel min-h-[120px]"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            disabled={running}
          />
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setGoal(p.goal)}
                disabled={running}
                className="pill pill-muted hover:pill-info cursor-pointer"
                style={{ cursor: running ? "not-allowed" : "pointer" }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <h2 className="font-pixel text-xl tracking-wider mt-6">Chaos</h2>
          <ChaosControls selected={chaos} onChange={setChaos} disabled={running} />

          <label className="card-pixel flex items-center gap-3 cursor-pointer" style={{ cursor: running ? "not-allowed" : "pointer" }}>
            <input
              type="checkbox"
              checked={interrupt}
              onChange={(e) => setInterrupt(e.target.checked)}
              disabled={running}
              className="w-5 h-5"
            />
            <div>
              <div className="font-pixel text-sm tracking-wider">USER INTERRUPT (WARP ZONE)</div>
              <div className="text-xs text-[color:var(--muted)]">Inject a new goal after step 1 — watch the planner adapt.</div>
            </div>
          </label>

          <div className="flex gap-3 pt-2">
            <button onClick={run} disabled={running} className="btn-pixel">
              {running ? "RUNNING…" : "▶ START RUN"}
            </button>
            {running && (
              <button onClick={stop} className="btn-pixel danger">■ STOP</button>
            )}
          </div>
        </section>

        <section className="lg:col-span-3 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-pixel text-xl tracking-wider">Live Trace</h2>
            <span className="pill pill-muted">{events.length} events</span>
          </div>
          <RunMetrics metrics={metrics} events={events} />
          {shareRun && (
            <div
              className="card-pixel flex items-center justify-between gap-3 toast-pop"
              style={{ borderColor: "var(--success)", background: "rgba(var(--surface-rgb), 0.6)", backdropFilter: "blur(8px)" }}
              data-share-link={shareRun.url}
            >
              <div className="min-w-0 flex-1">
                <div className="font-pixel text-[11px] tracking-widest mb-1" style={{ color: "var(--success)" }}>★ RUN SAVED</div>
                <code className="font-mono text-[10px] block truncate" style={{ color: "var(--fg)" }}>{shareRun.url}</code>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button onClick={copyShare} className="pill pill-ok" style={{ cursor: "pointer", fontSize: 10 }}>
                  {shareCopied ? "✓ COPIED" : "📋 COPY"}
                </button>
                <Link href={`/run/${shareRun.runId}`} className="pill pill-info" style={{ cursor: "pointer", fontSize: 10, textDecoration: "none" }}>
                  REPLAY →
                </Link>
                <button onClick={() => setShareRun(null)} className="pill pill-muted" style={{ cursor: "pointer", fontSize: 10 }}>×</button>
              </div>
            </div>
          )}
          <HydraPanel events={events} />
          <AgentConstellation events={events} />
          <AgentLog events={events} base={base} />
        </section>
      </main>
    </div>
  );
}
