"use client";
import { useState } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/Logo";

type Member = { index: number; model: string; status: "spawn" | "done" | "fail"; text?: string; ms?: number; error?: string };
type Verdict = { winnerIndex: number; rationale: string; scores: Array<{ index: number; score: number }>; merged: string };

// Gemini free quota burns out daily in production — swap to Kimi K2 (Groq).
const MEMBERS = [
  "groq:openai/gpt-oss-120b",
  "groq:meta-llama/llama-4-scout-17b-16e-instruct",
  "groq:moonshotai/kimi-k2-instruct-0905",
] as const;

const PRESETS = [
  "Why do graph DBs beat vector DBs for AI agent memory? Be concise.",
  "Explain quantum entanglement in 4 lines, no jargon.",
  "Best framework for building an AI-OS in 2026: Next.js / Astro / SvelteKit. Pick one with reasoning.",
  "Write a 6-line haiku about agents under pressure.",
  "The fastest way to ship a multi-agent app this weekend.",
];

export default function ArenaPage() {
  const [goal, setGoal] = useState(PRESETS[0]);
  const [members, setMembers] = useState<Member[]>([]);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function race() {
    if (running) return;
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
          members: MEMBERS,
          judge: "mistral:mistral-large-latest",
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
    return m.split(":").pop() ?? m;
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
          <span className="pill pill-warn" style={{ fontSize: 10 }}>★ BATTLE ROYALE</span>
          <h1 className="font-pixel text-3xl sm:text-5xl mt-3 mb-2 tracking-wider">
            3 models · 1 goal · <span style={{ color: "var(--accent)" }}>1 judge</span>.
          </h1>
          <p className="text-[color:var(--muted)] text-sm sm:text-base max-w-2xl">
            Three LLMs race on the same prompt. Judge LLM scores and merges. Spectacle.
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
              {PRESETS.map((p) => (
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
            </div>
            <button onClick={race} disabled={running} className="btn-pixel success" style={{ padding: "6px 14px", fontSize: 12 }}>
              {running ? "RACING…" : "▶ START RACE"}
            </button>
          </div>
        </section>

        {err && <div className="card-pixel pill pill-bad">{err}</div>}

        <section className="grid md:grid-cols-3 gap-4">
          {MEMBERS.map((m, i) => {
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
