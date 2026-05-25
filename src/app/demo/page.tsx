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

// Hackathon 5-step scripted trace:
// voice command → investor CRM build → memory recall → cohort race → export
const HK_BASE = 1700010000000;
const HACKATHON: RunEvent[] = [
  // Step 1: Voice command → app build intent
  { t: "meta", runId: "hk-demo-voice-01", at: HK_BASE + 0 },
  { t: "phase", phase: "boot", note: "voice command received — Whisper transcription", at: HK_BASE + 80 },
  { t: "thought", agent: "planner", text: "Voice: 'build me an investor CRM with commitment scoring and warm intro graph'. Intent=build_app. Routing to AppBuilder.", at: HK_BASE + 340 },
  { t: "tool_call", name: "codegen_app", args: { prompt: "investor CRM — commitment score, warm intro graph, risk flags, diligence checklist, portfolio board" }, at: HK_BASE + 600 },
  // Step 2: Domain playbook fires — investor CRM
  { t: "phase", phase: "act", note: "step 1/5: domain playbook — investor-crm detected", at: HK_BASE + 900 },
  { t: "thought", agent: "executor", text: "Matched domain: investor-crm. Scaffold: CommitmentScore + WarmIntroGraph + RiskFlags + DiligenceChecklist + PortfolioBoard. Coverage check: 8/8 required terms present (100%).", at: HK_BASE + 1200 },
  { t: "tool_result", name: "codegen_app", ok: true, result: { files: 8, domain: "investor-crm", coveragePct: 100 }, at: HK_BASE + 2800 },
  { t: "metric", key: "build_ms", value: 1900, at: HK_BASE + 2820 },
  { t: "thought", agent: "critic", text: "pass (drift=0.03): investor CRM produced CommitmentScore, WarmIntroGraph, RiskFlags — all domain-critical surfaces present.", at: HK_BASE + 3000 },
  { t: "metric", key: "drift", value: 0.03, at: HK_BASE + 3020 },
  // Step 3: Memory recall — cross-session learning
  { t: "phase", phase: "recall", note: "step 2/5: HydraDB cross-session recall", at: HK_BASE + 3200 },
  { t: "memory_recall", query: "investor CRM prior runs and user preferences", hits: 4, at: HK_BASE + 3500 },
  { t: "thought", agent: "executor", text: "Recalled: User fact · preferred_export = csv. User fact · risk_threshold = high. Applied to portfolio board defaults.", at: HK_BASE + 3800 },
  { t: "metric", key: "recall_hits", value: 4, at: HK_BASE + 3820 },
  // Step 4: Cohort race — 3 models judge the output
  { t: "phase", phase: "act", note: "step 3/5: cohort race — 3 models evaluate CRM quality", at: HK_BASE + 4000 },
  { t: "thought", agent: "planner", text: "Spawning 3 sub-agents: kimi-k2, gemini-2.5-flash, gpt-oss-120b. Each scores CRM output on domain fidelity.", at: HK_BASE + 4200 },
  { t: "tool_call", name: "cohort_race", args: { models: ["kimi-k2", "gemini-2.5-flash", "gpt-oss-120b"], task: "score investor CRM domain fidelity" }, at: HK_BASE + 4400 },
  { t: "tool_result", name: "cohort_race", ok: true, result: { winner: "kimi-k2", score: "9.1/10", verdict: "CommitmentScore algorithm is sound; WarmIntroGraph edge traversal is the key differentiator vs generic CRM" }, at: HK_BASE + 6200 },
  { t: "thought", agent: "critic", text: "Cohort consensus: 9.1/10. kimi-k2 named WarmIntroGraph traversal as the domain differentiator. Merged into answer.", at: HK_BASE + 6500 },
  { t: "metric", key: "cohort_score", value: 9.1, at: HK_BASE + 6520 },
  // Step 5: Memory write + export
  { t: "phase", phase: "store", note: "step 4/5: pinning facts + export", at: HK_BASE + 6700 },
  { t: "memory_write", key: "hk-demo-voice-01", preview: "Investor CRM built — 8 files, CommitmentScore + WarmIntroGraph + RiskFlags. Cohort score 9.1/10. Export CSV ready.", at: HK_BASE + 7000 },
  { t: "phase", phase: "done", at: HK_BASE + 7200 },
  { t: "answer", text: "✓ Investor CRM built in 1.9s\n\n• 8 files — CommitmentScore, WarmIntroGraph, RiskFlags, DiligenceChecklist, PortfolioBoard, PartnerFollowUp\n• Coverage: 100% (8/8 domain terms)\n• Cohort score: 9.1/10 — kimi-k2 winner\n• Cross-session memory applied: export=csv, risk_threshold=high\n• CSV export surface mounted — ready for download", at: HK_BASE + 7240 },
  { t: "metric", key: "elapsed_ms", value: 7240, at: HK_BASE + 7260 },
  { t: "metric", key: "tool_calls", value: 5, at: HK_BASE + 7280 },
  { t: "metric", key: "successes", value: 5, at: HK_BASE + 7300 },
];

type DemoTrack = "research" | "hackathon";

export default function DemoPage() {
  const [played, setPlayed] = useState<RunEvent[]>([]);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const [track, setTrack] = useState<DemoTrack>("research");
  const stopRef = useRef(false);

  async function play(events: RunEvent[] = track === "hackathon" ? HACKATHON : CANNED) {
    if (playing) return;
    setPlaying(true);
    stopRef.current = false;
    setPlayed([]);
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

  function switchAndPlay(t: DemoTrack) {
    stop();
    setTrack(t);
    setTimeout(() => play(t === "hackathon" ? HACKATHON : CANNED), 80);
  }

  useEffect(() => {
    // Auto-play on first mount
    const t = setTimeout(() => play(CANNED), 600);
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
            Pre-recorded traces. Zero network calls — survives bad conference Wi-Fi.
          </p>
        </section>

        {/* Track selector */}
        <section className="flex flex-wrap gap-2">
          <button
            onClick={() => switchAndPlay("research")}
            className="btn-pixel"
            style={{
              background: track === "research" ? "var(--accent)" : "var(--surface)",
              color: track === "research" ? "var(--on-accent)" : "var(--fg)",
              border: "1px solid var(--surface-2)",
            }}
          >
            ◉ Research loop
          </button>
          <button
            onClick={() => switchAndPlay("hackathon")}
            className="btn-pixel"
            style={{
              background: track === "hackathon" ? "#f59e0b" : "var(--surface)",
              color: track === "hackathon" ? "#0f172a" : "var(--fg)",
              border: track === "hackathon" ? "1px solid #f59e0b" : "1px solid var(--surface-2)",
              fontWeight: track === "hackathon" ? 700 : undefined,
            }}
          >
            ★ HACKATHON DEMO
          </button>
          {track === "hackathon" && (
            <span className="pill" style={{ fontSize: 9, background: "#422006", color: "#fde68a", border: "1px solid #92400e" }}>
              voice → investor CRM → memory → cohort → export
            </span>
          )}
        </section>

        <section className="flex flex-wrap items-center gap-2">
          {!playing ? (
            <button onClick={() => play()} className="btn-pixel success">▶ REPLAY</button>
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
          <span className="pill pill-info" style={{ fontSize: 9 }}>{played.length}/{(track === "hackathon" ? HACKATHON : CANNED).length} events</span>
        </section>

        <section className="grid lg:grid-cols-5 gap-4">
          <div className="lg:col-span-2 space-y-3">
            <HydraPanel events={played} />
            <AgentConstellation events={played} />
          </div>
          <div className="lg:col-span-3">
            <AgentLog events={played} base={track === "hackathon" ? HK_BASE : BASE} />
          </div>
        </section>
      </main>
    </div>
  );
}
