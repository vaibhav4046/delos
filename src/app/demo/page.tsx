"use client";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/Logo";
import { AgentLog } from "@/components/AgentLog";
import { HydraPanel } from "@/components/HydraPanel";
import { AgentConstellation } from "@/components/AgentConstellation";
import type { RunEvent } from "@/lib/types";

// Canned event log — Wi-Fi failsafe. Plays without ANY network requests after first load.

const BASE = 1700000000000;
const CANNED: RunEvent[] = [
  { t: "meta", runId: "demo-CANNED-3xK9", at: BASE + 0 },
  { t: "phase", phase: "boot", note: "run demo-CANNED-3xK9", at: BASE + 60 },
  { t: "phase", phase: "recall", note: "querying HydraDB save-state", at: BASE + 320 },
  { t: "memory_recall", query: "graph DBs vs vector DBs for agent memory", hits: 3, at: BASE + 540 },
  { t: "phase", phase: "plan", at: BASE + 580 },
  { t: "thought", agent: "planner", text: "Decomposed into: web_search, fetch, summarize. 3 steps. Memory hints 3 prior runs reused.", at: BASE + 920 },
  { t: "usage", role: "planner", model: "groq:moonshotai/kimi-k2-instruct-0905", promptTokens: 612, completionTokens: 184, ms: 612, at: BASE + 940 },
  { t: "phase", phase: "act", note: "step 1/3: search authoritative sources", at: BASE + 1100 },
  { t: "thought", agent: "executor", text: "Calling web_search with refined query", at: BASE + 1250 },
  { t: "tool_call", name: "web_search", args: { query: "graph databases vs vector databases agent memory benchmarks" }, at: BASE + 1280 },
  { t: "tool_result", name: "web_search", ok: true, result: { results: [{ title: "Why graph wins", url: "neo4j.com/agent-memory" }] }, at: BASE + 2020 },
  { t: "usage", role: "executor", model: "groq:openai/gpt-oss-120b", promptTokens: 1247, completionTokens: 312, ms: 740, at: BASE + 2040 },
  { t: "phase", phase: "critic", at: BASE + 2110 },
  { t: "thought", agent: "critic", text: "pass (drift=0.08): step intent satisfied — search returned relevant sources", at: BASE + 2380 },
  { t: "metric", key: "drift", value: 0.08, at: BASE + 2400 },
  { t: "phase", phase: "act", note: "step 2/3: fetch + summarize", at: BASE + 2520 },
  { t: "tool_call", name: "fetch", args: { url: "neo4j.com/agent-memory" }, at: BASE + 2540 },
  { t: "recover", reason: "rate limited", strategy: "switching to fallback tool: wiki_search", at: BASE + 2800 },
  { t: "tool_call", name: "wiki_search", args: { query: "graph database vs vector database" }, at: BASE + 2820 },
  { t: "tool_result", name: "wiki_search", ok: true, result: { text: "Graph databases use traversal..." }, at: BASE + 3340 },
  { t: "usage", role: "executor", model: "groq:openai/gpt-oss-120b", promptTokens: 890, completionTokens: 240, ms: 520, at: BASE + 3360 },
  { t: "phase", phase: "critic", at: BASE + 3420 },
  { t: "thought", agent: "critic", text: "pass (drift=0.05): recovered cleanly, found equivalent source", at: BASE + 3680 },
  { t: "metric", key: "drift", value: 0.05, at: BASE + 3700 },
  { t: "phase", phase: "act", note: "step 3/3: synthesize", at: BASE + 3820 },
  { t: "tool_call", name: "final_answer", args: { text: "Graph DBs beat vectors for agent memory: traversal preserves causal chains (run→tool→error→retry→success) that semantic similarity loses." }, at: BASE + 3840 },
  { t: "tool_result", name: "final_answer", ok: true, result: { ok: true }, at: BASE + 3870 },
  { t: "usage", role: "executor", model: "groq:openai/gpt-oss-120b", promptTokens: 1124, completionTokens: 184, ms: 380, at: BASE + 3880 },
  { t: "phase", phase: "done", at: BASE + 3920 },
  { t: "answer", text: "Graph databases beat vector databases for AI agent memory:\n\n1. Traversal preserves causal chains. Agent runs naturally form chains (tool→error→retry→success). Graph edges encode them. Vectors collapse them into semantic neighborhood.\n\n2. Exact recall. Need a specific past run by ID? Graph lookup is O(1). Vector top-k might miss the actual neighbor.\n\n3. Cheap updates. Append edges. No re-embedding pipeline.\n\nHybrid systems (HydraDB) layer both — graph for structure, vectors for semantic search across edges.", at: BASE + 3960 },
  { t: "phase", phase: "store", at: BASE + 4020 },
  { t: "memory_write", key: "demo-CANNED-3xK9", preview: "Run completed for goal: \"graph DBs vs vector DBs\". Final answer: Graph databases beat...", at: BASE + 4180 },
  { t: "metric", key: "elapsed_ms", value: 4180, at: BASE + 4200 },
  { t: "metric", key: "replans", value: 0, at: BASE + 4220 },
  { t: "metric", key: "tool_calls", value: 3, at: BASE + 4240 },
  { t: "metric", key: "successes", value: 3, at: BASE + 4260 },
  { t: "metric", key: "wall_time_ms", value: 4260, at: BASE + 4280 },
];

export default function DemoPage() {
  const [played, setPlayed] = useState<RunEvent[]>([]);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const stopRef = useRef(false);

  async function play() {
    if (playing) return;
    setPlaying(true);
    stopRef.current = false;
    setPlayed([]);
    const events = CANNED;
    for (let i = 0; i < events.length; i++) {
      if (stopRef.current) break;
      const ev = events[i];
      const next = events[i + 1];
      setPlayed((p) => [...p, ev]);
      if (next) {
        const delta = (next.at - ev.at) / speed;
        if (delta > 0) await new Promise((r) => setTimeout(r, Math.min(delta, 1200)));
      }
    }
    setPlaying(false);
  }

  function stop() {
    stopRef.current = true;
    setPlaying(false);
  }

  useEffect(() => {
    // Auto-play on first mount
    const t = setTimeout(() => play(), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 glass-header">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link href="/"><Wordmark size={26} /></Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link href="/os" className="btn-pixel success">★ DelOS</Link>
            <Link href="/play" className="btn-pixel ghost hidden sm:inline-flex">Real run</Link>
            <Link href="/live" className="btn-pixel ghost hidden sm:inline-flex">Live</Link>
            <Link href="/scorecard" className="btn-pixel ghost hidden md:inline-flex">Score</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <section>
          <span className="pill pill-warn" style={{ fontSize: 10 }}>★ OFFLINE FAILSAFE</span>
          <h1 className="font-pixel text-3xl sm:text-4xl mt-3 mb-2 tracking-wider">
            canned <span style={{ color: "var(--accent)" }}>demo</span>.
          </h1>
          <p className="text-[color:var(--muted)] text-sm max-w-2xl">
            90-second pre-recorded trace. Plays back the full planner→executor→critic→memory loop, including a tool-failure recovery and the final-answer tool call. Zero network calls after first paint — survives bad conference Wi-Fi.
          </p>
        </section>

        <section className="flex flex-wrap items-center gap-2">
          {!playing ? (
            <button onClick={play} className="btn-pixel success">▶ REPLAY</button>
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
          <span className="pill pill-info" style={{ fontSize: 9 }}>{played.length}/{CANNED.length} events</span>
        </section>

        <section className="grid lg:grid-cols-5 gap-4">
          <div className="lg:col-span-2 space-y-3">
            <HydraPanel events={played} />
            <AgentConstellation events={played} />
          </div>
          <div className="lg:col-span-3">
            <AgentLog events={played} base={BASE} />
          </div>
        </section>
      </main>
    </div>
  );
}
