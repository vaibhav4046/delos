"use client";
import { useState } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/Logo";
import { MODEL_CATALOG, type ModelKey } from "@/lib/llm.catalog";

type Member = { index: number; model: string; status: "spawn" | "done" | "fail"; text?: string; ms?: number; error?: string };
type Verdict = { winnerIndex: number; rationale: string; scores: Array<{ index: number; score: number }>; merged: string };

// Battle Royale defaults · 5 diverse models from 3 providers so judges
// see real cross-vendor variance. Members are filtered through
// MODEL_CATALOG so any retirement (e.g. Kimi K2) is auto-pruned and
// can't desync the visible roster count from the actually-loaded list.
const DEFAULT_MEMBER_CANDIDATES: ModelKey[] = [
  "groq:openai/gpt-oss-120b",
  "groq:meta-llama/llama-4-scout-17b-16e-instruct",
  "groq:openai/gpt-oss-20b",
  "mistral:mistral-large-latest",
  "google:gemini-2.5-flash",
];
const DEFAULT_MEMBERS: ModelKey[] = DEFAULT_MEMBER_CANDIDATES.filter((k) =>
  MODEL_CATALOG.some((m) => m.key === k),
);
// Distinct provider count · derived live from the catalog so the
// "N providers" copy can never drift from the model list. P0-10.
const PROVIDER_COUNT = new Set(MODEL_CATALOG.map((m) => m.provider)).size;

const PRESETS = [
  "Why do graph DBs beat vector DBs for AI agent memory? Be concise.",
  "Explain quantum entanglement in 4 lines, no jargon.",
  "Best framework for building an AI-OS in 2026: Next.js / Astro / SvelteKit. Pick one with reasoning.",
  "Write a 6-line haiku about agents under pressure.",
  "The fastest way to ship a multi-agent app this weekend.",
  "Design a memory system for a coding agent that handles 10k+ files.",
  "Compare RAG vs fine-tuning for a customer support chatbot.",
];

export default function ArenaPage() {
  const [goal, setGoal] = useState(PRESETS[0]);
  const [selected, setSelected] = useState<Set<ModelKey>>(new Set(DEFAULT_MEMBERS));
  const [judge, setJudge] = useState<ModelKey>("mistral:mistral-large-latest");
  const [members, setMembers] = useState<Member[]>([]);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showMembers, setShowMembers] = useState(false);

  function toggle(k: ModelKey) {
    const next = new Set(selected);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setSelected(next);
  }

  async function race() {
    if (running) return;
    const memberList = [...selected];
    if (memberList.length < 2) {
      setErr("Pick at least 2 racers.");
      return;
    }
    setRunning(true);
    setMembers([]);
    setVerdict(null);
    setErr(null);
    try {
      const r = await fetch("/api/cohort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal,
          members: memberList,
          judge,
        }),
      });
      if (!r.body) throw new Error("no stream");
      const reader = r.body.getReader();
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
            const ev = JSON.parse(line.slice(6));
            if (ev.t === "cohort_member") {
              setMembers((prev) => {
                const others = prev.filter((x) => x.index !== ev.index);
                return [
                  ...others,
                  { index: ev.index, model: ev.model, status: ev.status, text: ev.text, ms: ev.ms, error: ev.error },
                ].sort((a, b) => a.index - b.index);
              });
            } else if (ev.t === "cohort_verdict") {
              setVerdict({
                winnerIndex: ev.winnerIndex,
                rationale: ev.rationale,
                scores: ev.scores ?? [],
                merged: ev.merged,
              });
            } else if (ev.t === "error") {
              setErr(String(ev.message));
            }
          } catch {}
        }
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  function shortModel(m: string) {
    const last = m.split(":").pop() ?? m;
    return last.replace(/-instruct.*$/, "").replace(/-latest$/, "").replace(/-/g, " ");
  }

  function shuffleGoal() {
    const next = PRESETS[Math.floor(Math.random() * PRESETS.length)];
    setGoal(next);
  }

  const memberKeys = [...selected];

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
          <span className="pill pill-warn" style={{ fontSize: 10 }}>★ BATTLE ROYALE</span>
          <h1 className="font-pixel text-3xl sm:text-5xl mt-3 mb-2 tracking-wider">
            <span className="font-pixel">{selected.size}</span> models · 1 goal · <span style={{ color: "var(--accent)" }}>1 judge</span>.
          </h1>
          <p className="text-[color:var(--muted)] text-sm sm:text-base max-w-2xl">
            Pick any subset of <span className="font-pixel" style={{ color: "var(--fg)" }}>{MODEL_CATALOG.length}</span> cross-vendor LLMs across <span className="font-pixel" style={{ color: "var(--fg)" }}>{PROVIDER_COUNT}</span> providers. They race on the same prompt in parallel.
            A judge model scores them, picks a winner, and writes a merged answer.
          </p>
        </section>

        <section className="card-pixel">
          <textarea
            className="input-pixel"
            rows={2}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            disabled={running}
            style={{ fontSize: 12 }}
          />
          <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
            <div className="flex gap-1 flex-wrap">
              {PRESETS.slice(0, 5).map((p) => (
                <button
                  key={p}
                  onClick={() => !running && setGoal(p)}
                  disabled={running}
                  className="pill pill-muted"
                  style={{ fontSize: 9, cursor: running ? "not-allowed" : "pointer" }}
                >
                  {p.slice(0, 28)}…
                </button>
              ))}
              <button
                onClick={shuffleGoal}
                disabled={running}
                className="pill pill-info"
                style={{ fontSize: 9, cursor: running ? "not-allowed" : "pointer" }}
                title="Random preset"
              >
                🎲 SHUFFLE
              </button>
            </div>
            <button onClick={race} disabled={running} className="btn-pixel success" style={{ padding: "6px 14px", fontSize: 12 }}>
              {running ? "RACING…" : "▶ START RACE"}
            </button>
          </div>

          {/* Member roster · collapsed by default. Click to expand and pick. */}
          <div className="mt-3 pt-3 border-t border-[color:var(--surface-2)]">
            <button
              onClick={() => setShowMembers((v) => !v)}
              className="font-pixel text-[10px] tracking-widest"
              style={{ color: "var(--muted)", cursor: "pointer", background: "transparent", border: "none" }}
            >
              {showMembers ? "▼" : "▶"} ROSTER · {selected.size} / {MODEL_CATALOG.length}
            </button>
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <span className="font-pixel text-[9px] tracking-widest" style={{ color: "var(--muted)" }}>JUDGE</span>
              <select
                className="input-pixel"
                value={judge}
                onChange={(e) => setJudge(e.target.value as ModelKey)}
                disabled={running}
                style={{ fontSize: 10, padding: "2px 4px" }}
              >
                {MODEL_CATALOG.map((m) => (
                  <option key={m.key} value={m.key}>{m.provider} · {m.label}</option>
                ))}
              </select>
            </div>
            {showMembers && (
              <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-1.5">
                {MODEL_CATALOG.map((m) => {
                  const on = selected.has(m.key);
                  return (
                    <button
                      key={m.key}
                      disabled={running}
                      onClick={() => toggle(m.key)}
                      className="card-pixel text-left"
                      style={{ padding: 6, borderColor: on ? "var(--accent)" : "var(--surface-2)" }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-pixel text-[10px]">{m.label}</span>
                        <span className={`pill ${on ? "pill-info" : "pill-muted"}`} style={{ fontSize: 8 }}>{on ? "ON" : ""}</span>
                      </div>
                      <div className="text-[8px] text-[color:var(--muted)] font-mono">
                        {m.provider} · {m.ctx} · {m.tag}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {err && <div className="card-pixel pill pill-bad">{err}</div>}

        <section
          className="grid gap-4"
          style={{ gridTemplateColumns: `repeat(${Math.min(memberKeys.length, 3)}, minmax(0, 1fr))` }}
        >
          {memberKeys.map((m, i) => {
            const member = members.find((x) => x.index === i);
            const score = verdict?.scores.find((s) => s.index === i)?.score;
            const isWinner = verdict?.winnerIndex === i;
            return (
              <div
                key={m}
                className="card-pixel"
                style={{
                  borderColor: isWinner ? "var(--success)" : member?.status === "done" ? "var(--accent)" : member?.status === "fail" ? "var(--danger)" : "var(--surface-2)",
                  boxShadow: isWinner ? "0 0 0 1px var(--bg), 0 0 0 3px var(--success), 4px 4px 0 var(--shadow)" : undefined,
                  minHeight: 240,
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-pixel text-[11px] tracking-widest" style={{ color: "var(--accent)" }}>
                    [{i}] {shortModel(m)}
                  </span>
                  {isWinner && <span className="pill pill-ok" style={{ fontSize: 9 }}>★ WINNER</span>}
                </div>
                {member?.status === "spawn" && (
                  <div className="font-mono text-[10px] flex items-center gap-1" style={{ color: "var(--muted)" }}>
                    <span className="accent-pulse" style={{ display: "inline-block", width: 6, height: 6, background: "var(--accent)" }} />
                    racing…
                  </div>
                )}
                {!member && running && (
                  <div className="font-mono text-[10px]" style={{ color: "var(--muted)" }}>spawning…</div>
                )}
                {member?.text && (
                  <p className="font-mono text-[10px] leading-relaxed whitespace-pre-wrap" style={{ color: "var(--fg)" }}>
                    {member.text}
                  </p>
                )}
                {member?.error && (
                  <p className="font-mono text-[10px]" style={{ color: "var(--danger)" }}>err: {member.error}</p>
                )}
                <div className="mt-2 pt-2 border-t border-[color:var(--surface-2)] flex justify-between items-center text-[10px] font-mono">
                  {member?.ms !== undefined && <span style={{ color: "var(--muted)" }}>{member.ms}ms</span>}
                  {score !== undefined && (
                    <span className="pill pill-info" style={{ fontSize: 9 }}>{score}/10</span>
                  )}
                </div>
              </div>
            );
          })}
        </section>

        {/* Live latency-race bar · visualises which model returned first when
            multiple have status "done". Re-renders on every member update. */}
        {members.some((m) => m.ms !== undefined) && (
          <section className="card-pixel">
            <span className="font-pixel text-[10px] tracking-widest" style={{ color: "var(--accent)" }}>★ LATENCY RACE</span>
            <div className="mt-2 space-y-1">
              {(() => {
                const done = members.filter((m) => m.ms !== undefined) as Array<Member & { ms: number }>;
                if (done.length === 0) return null;
                const maxMs = Math.max(...done.map((d) => d.ms));
                return done
                  .sort((a, b) => a.ms - b.ms)
                  .map((d) => (
                    <div key={d.index} className="flex items-center gap-2">
                      <span className="font-mono text-[9px] w-32 truncate" style={{ color: "var(--muted)" }}>
                        [{d.index}] {shortModel(d.model)}
                      </span>
                      <div className="flex-1 h-2" style={{ background: "var(--surface-2)" }}>
                        <div
                          style={{
                            width: `${(d.ms / maxMs) * 100}%`,
                            height: "100%",
                            background: d.status === "fail" ? "var(--danger)" : verdict?.winnerIndex === d.index ? "var(--success)" : "var(--accent)",
                          }}
                        />
                      </div>
                      <span className="font-mono text-[9px] w-14 text-right" style={{ color: "var(--fg)" }}>
                        {d.ms}ms
                      </span>
                    </div>
                  ));
              })()}
            </div>
          </section>
        )}

        {verdict && (
          <section className="card-pixel" style={{ borderColor: "var(--accent)", background: "rgba(var(--surface-rgb), 0.6)", backdropFilter: "blur(8px)" }}>
            <span className="font-pixel text-sm tracking-widest" style={{ color: "var(--accent)" }}>★ JUDGE VERDICT</span>
            <p className="text-[color:var(--muted)] font-mono text-[11px] mt-2">{verdict.rationale}</p>
            <div className="mt-3 font-pixel text-xs tracking-wider mb-1" style={{ color: "var(--accent)" }}>MERGED ANSWER</div>
            <p className="text-sm whitespace-pre-wrap" style={{ color: "var(--fg)" }}>{verdict.merged}</p>
          </section>
        )}
      </main>
    </div>
  );
}
