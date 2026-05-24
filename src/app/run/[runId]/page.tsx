"use client";
import { use, useEffect, useState, useRef } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/Logo";
import { AgentLog } from "@/components/AgentLog";
import { HydraPanel } from "@/components/HydraPanel";
import { AgentConstellation } from "@/components/AgentConstellation";
import { EmptyState } from "@/components/ui/EmptyState";
import type { RunEvent } from "@/lib/types";

type RunRecord = {
  runId: string;
  tenantId: string;
  goal: string;
  startedAt: number;
  endedAt?: number;
  events: RunEvent[];
  answer?: string;
  drift?: number;
  replans?: number;
  success?: boolean;
};

export default function RunReplayPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params);
  const [record, setRecord] = useState<RunRecord | null>(null);
  const [played, setPlayed] = useState<RunEvent[]>([]);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const [copied, setCopied] = useState(false);
  const stopRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Client-side cache first (durable across Lambda cold starts)
    try {
      const cached = localStorage.getItem(`delos.runlog.${runId}`);
      if (cached) {
        const r = JSON.parse(cached) as RunRecord;
        if (r.events && r.events.length > 0) {
          setRecord(r);
          return;
        }
      }
    } catch {}
    // Network fallback — hits API which checks hot Map + HydraDB recall
    fetch(`/api/run-log/${encodeURIComponent(runId)}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setRecord(j.run);
        else setError(j.error ?? "not found");
      })
      .catch((e) => setError((e as Error).message));
  }, [runId]);

  async function replay() {
    if (!record || playing) return;
    setPlaying(true);
    stopRef.current = false;
    setPlayed([]);
    const events = record.events;
    const base = events[0]?.at ?? Date.now();
    for (let i = 0; i < events.length; i++) {
      if (stopRef.current) break;
      const ev = events[i];
      const next = events[i + 1];
      setPlayed((p) => [...p, ev]);
      if (next) {
        const delta = (next.at - ev.at) / speed;
        if (delta > 0) await new Promise((r) => setTimeout(r, Math.min(delta, 2000)));
      }
    }
    setPlaying(false);
  }

  function stop() {
    stopRef.current = true;
    setPlaying(false);
  }

  function copyLink() {
    const url = typeof window !== "undefined" ? window.location.href : "";
    if (!url) return;
    if (!navigator.clipboard?.writeText) {
      window.prompt("Copy:", url);
      return;
    }
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 glass-header">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link href="/"><Wordmark size={26} /></Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link href="/os" className="btn-pixel success">★ DelOS</Link>
            <Link href="/play" className="btn-pixel ghost hidden sm:inline-flex">Play</Link>
            <Link href="/live" className="btn-pixel ghost hidden sm:inline-flex">Live</Link>
            <Link href="/scorecard" className="btn-pixel ghost hidden md:inline-flex">Score</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <section>
          <span className="pill pill-muted" style={{ fontSize: 10 }}>★ RUN REPLAY</span>
          <h1 className="font-pixel text-2xl sm:text-3xl mt-3 mb-1 tracking-wider" style={{ color: "var(--fg)" }}>
            run <span style={{ color: "var(--accent)" }}>{runId}</span>
          </h1>
          {record && (
            <p className="text-[color:var(--muted)] font-mono text-[11px] truncate">{record.goal}</p>
          )}
          {error && (
            <EmptyState
              icon="⏳"
              title={error === "not_found" ? "This run has aged out" : `Couldn't load: ${error}`}
              body="Vercel keeps recent runs hot in-memory + caches yours in localStorage. Cross-Lambda replays need the run you started yourself — make a fresh one and the toast on /play will hand you the share link."
              action={{ label: "▶ START A NEW RUN", href: "/play" }}
              secondary={{ label: "Open Live Feed →", href: "/live" }}
            />
          )}
        </section>

        {record && (
          <>
            <section className="flex flex-wrap items-center gap-2">
              {!playing ? (
                <button onClick={replay} className="btn-pixel success">▶ REPLAY</button>
              ) : (
                <button onClick={stop} className="btn-pixel danger">■ STOP</button>
              )}
              <span className="font-mono text-[10px]" style={{ color: "var(--muted)" }}>speed:</span>
              {[1, 2, 4, 8].map((s) => (
                <button
                  key={s}
                  onClick={() => setSpeed(s)}
                  className="pill"
                  style={{
                    fontSize: 9,
                    cursor: "pointer",
                    background: speed === s ? "var(--accent)" : "var(--surface)",
                    color: speed === s ? "var(--on-accent)" : "var(--fg)",
                    border: "1px solid var(--surface-2)",
                  }}
                >
                  {s}×
                </button>
              ))}
              <button onClick={copyLink} className="pill pill-muted" style={{ fontSize: 9, cursor: "pointer" }}>
                {copied ? "✓ copied" : "📋 copy share link"}
              </button>
              <span className="pill pill-info" style={{ fontSize: 9 }}>{played.length}/{record.events.length} events</span>
              {record.drift !== undefined && <span className="pill pill-muted" style={{ fontSize: 9 }}>drift {record.drift.toFixed(2)}</span>}
              {record.replans !== undefined && <span className="pill pill-muted" style={{ fontSize: 9 }}>{record.replans} replans</span>}
            </section>

            <section className="grid lg:grid-cols-5 gap-4">
              <div className="lg:col-span-2 space-y-3">
                <HydraPanel events={played} />
                <AgentConstellation events={played} />
              </div>
              <div className="lg:col-span-3">
                <AgentLog events={played} base={record.startedAt} />
              </div>
            </section>

            {record.answer && (
              <section className="card-pixel" style={{ borderColor: "var(--accent)" }}>
                <span className="font-pixel text-xs tracking-widest" style={{ color: "var(--accent)" }}>★ FINAL ANSWER</span>
                <p className="mt-2 font-mono text-[12px] whitespace-pre-wrap" style={{ color: "var(--fg)" }}>{record.answer}</p>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
