"use client";
import { useState, useEffect } from "react";
import * as Icons from "lucide-react";
import { MODEL_CATALOG, type ModelKey } from "@/lib/llm.catalog";
import { onIntent, broadcastAgent } from "@/lib/intentBus";
import { useSpeechToText } from "@/lib/useSpeech";

type Member = { index: number; model: ModelKey; status: "spawn" | "done" | "fail"; text?: string; ms?: number; error?: string };
type Verdict = { winnerIndex: number; rationale: string; scores: Array<{ index: number; score: number }>; merged: string; fallback?: boolean };

// Default to the three Groq models confirmed available on the hackathon
// account's free tier (gpt-oss-120b, llama-4-scout, gpt-oss-20b). Gemini
// + Kimi K2 + Maverick all hit FAIL on this account — Gemini blows its
// daily quota almost immediately, the others are gated to paid tier.
// User can still toggle them ON manually if they want.
const DEFAULT_MEMBERS: ModelKey[] = [
  "groq:openai/gpt-oss-120b",
  "groq:meta-llama/llama-4-scout-17b-16e-instruct",
  "groq:openai/gpt-oss-20b",
];

export function CohortApp() {
  const [goal, setGoal] = useState("Why is sleep important for memory consolidation? Be concise.");
  const [selected, setSelected] = useState<Set<ModelKey>>(new Set(DEFAULT_MEMBERS));
  const [judge, setJudge] = useState<ModelKey>("mistral:mistral-large-latest");
  const [members, setMembers] = useState<Member[]>([]);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Voice-to-goal mic · holds capture, on transcript fills goal input.
  const cohortStt = useSpeechToText();
  useEffect(() => {
    if (cohortStt.transcript && !running) {
      setGoal(cohortStt.transcript);
      cohortStt.setTranscript("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cohortStt.transcript]);
  const cohortMic = cohortStt.state === "listening" || cohortStt.state === "recording";

  useEffect(() => {
    return onIntent("cohort.run", (i) => {
      // Pass goal explicitly so run() doesn't capture the stale React state
      // from the moment this useEffect's closure was built. Same gotcha as
      // CodebaseApp — fixed there too.
      setGoal(i.goal);
      setTimeout(() => run(i.goal), 50);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(m: ModelKey) {
    const next = new Set(selected);
    if (next.has(m)) next.delete(m);
    else next.add(m);
    setSelected(next);
  }

  async function run(overrideGoal?: string) {
    const useGoal = overrideGoal ?? goal;
    setRunning(true);
    setErr(null);
    setMembers([]);
    setVerdict(null);
    broadcastAgent("planner", "thinking");
    broadcastAgent("executor", "tool");
    broadcastAgent("critic", "thinking");
    const list = [...selected];
    if (list.length < 2) {
      setErr("Select at least 2 members.");
      setRunning(false);
      broadcastAgent("planner", "idle");
      broadcastAgent("executor", "idle");
      broadcastAgent("critic", "idle");
      return;
    }
    try {
      const res = await fetch("/api/cohort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: useGoal, members: list, judge }),
      });
      if (!res.body) throw new Error("no stream");
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
            const ev = JSON.parse(line.slice(6)) as Record<string, unknown>;
            if (ev.t === "cohort_member") {
              const m = ev as unknown as Member & { t: string };
              setMembers((prev) => {
                const others = prev.filter((x) => x.index !== m.index);
                return [...others, { index: m.index, model: m.model, status: m.status, text: m.text, ms: m.ms, error: m.error }].sort((a, b) => a.index - b.index);
              });
            } else if (ev.t === "cohort_verdict") {
              setVerdict({
                winnerIndex: ev.winnerIndex as number,
                rationale: ev.rationale as string,
                scores: (ev.scores as Verdict["scores"]) ?? [],
                merged: ev.merged as string,
                fallback: ev.fallback as boolean | undefined,
              });
              broadcastAgent("critic", "done");
            } else if (ev.t === "error") {
              setErr(String(ev.message));
            }
          } catch {}
        }
      }
      broadcastAgent("planner", "done");
      broadcastAgent("executor", "done");
      broadcastAgent("memory", "done");
      setTimeout(() => {
        broadcastAgent("planner", "idle");
        broadcastAgent("executor", "idle");
        broadcastAgent("critic", "idle");
        broadcastAgent("memory", "idle");
      }, 1500);
    } catch (e) {
      setErr((e as Error).message);
      broadcastAgent("planner", "idle");
      broadcastAgent("executor", "idle");
      broadcastAgent("critic", "idle");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="p-3 space-y-3 text-xs">
      <div className="font-pixel text-sm tracking-wider" style={{ color: "var(--accent)" }}>★ COHORT COUNCIL</div>
      <p className="text-[color:var(--muted)] font-mono">
        Run the same goal across multiple models in parallel. A judge LLM scores them and writes a merged answer.
      </p>
      <div style={{ position: "relative" }}>
        <textarea className="input-pixel" rows={2} value={goal} onChange={(e) => setGoal(e.target.value)} disabled={running} style={{ paddingRight: 40 }} />
        <button
          onClick={() => { if (cohortMic) cohortStt.stop(); else cohortStt.start(); }}
          disabled={running}
          title={cohortMic ? "stop dictation" : "dictate goal"}
          style={{
            position: "absolute", top: 6, right: 6,
            width: 28, height: 28, borderRadius: 14,
            background: cohortMic ? "var(--danger)" : "var(--accent)",
            color: "var(--on-accent)", border: "2px solid var(--bg)",
            cursor: running ? "not-allowed" : "pointer",
            fontSize: 12, lineHeight: 1, boxShadow: cohortMic ? "0 0 0 4px rgba(255,80,80,0.35)" : "2px 2px 0 var(--shadow)",
          }}
        >
          {cohortStt.state === "transcribing" ? "…" : cohortMic ? "■" : "🎙"}
        </button>
      </div>

      <div>
        <div className="font-pixel text-[11px] tracking-wider mb-1" style={{ color: "var(--accent)" }}>MEMBERS ({selected.size})</div>
        <div className="grid grid-cols-2 gap-1 max-h-44 overflow-y-auto">
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
                  <span className="font-pixel text-[11px]">{m.label}</span>
                  <span className={`pill ${on ? "pill-info" : "pill-muted"}`} style={{ fontSize: 8 }}>{on ? "ON" : ""}</span>
                </div>
                <div className="text-[9px] text-[color:var(--muted)] font-mono">
                  {m.provider} · {m.ctx} · {m.tag}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="font-pixel text-[11px] tracking-wider mb-1" style={{ color: "var(--accent)" }}>JUDGE</div>
        <select className="input-pixel" value={judge} onChange={(e) => setJudge(e.target.value as ModelKey)} disabled={running}>
          {MODEL_CATALOG.map((m) => (
            <option key={m.key} value={m.key}>
              {m.provider} · {m.label}
            </option>
          ))}
        </select>
      </div>

      <button onClick={() => run()} disabled={running} className="btn-pixel success">
        {running ? "RUNNING…" : "▶ RUN COHORT"}
      </button>

      {err && <div className="pill pill-bad">{err}</div>}

      {members.length > 0 && (
        <div className="grid grid-cols-1 gap-2">
          {members.map((m) => (
            <div key={m.index} className="card-pixel" style={{ borderColor: verdict?.winnerIndex === m.index ? "var(--success)" : "var(--surface-2)" }}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-pixel text-[11px]" style={{ color: "var(--accent)" }}>[{m.index}] {m.model.split(":").pop()}</span>
                <div className="flex items-center gap-1">
                  {verdict?.scores.find((s) => s.index === m.index) && (
                    <span className="pill pill-info" style={{ fontSize: 9 }}>{verdict.scores.find((s) => s.index === m.index)!.score}/10</span>
                  )}
                  <span className={`pill ${m.status === "done" ? "pill-ok" : m.status === "fail" ? "pill-bad" : "pill-warn"}`} style={{ fontSize: 9 }}>{m.status}</span>
                  {m.ms !== undefined && <span className="pill pill-muted" style={{ fontSize: 9 }}>{m.ms}ms</span>}
                </div>
              </div>
              {m.status === "spawn" && (
                <div className="flex items-center gap-2 text-[color:var(--muted)] font-mono"><Icons.Loader2 size={12} className="animate-spin" /> thinking…</div>
              )}
              {m.text && <p className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap">{m.text}</p>}
              {m.error && <p className="font-mono text-[11px]" style={{ color: "var(--danger)" }}>err: {m.error}</p>}
            </div>
          ))}
        </div>
      )}

      {verdict && (
        <div className="card-pixel" style={{ borderColor: "var(--accent)", boxShadow: "0 4px 0 0 var(--accent-shadow)" }}>
          <div className="flex items-center justify-between mb-2">
            <span className="font-pixel text-sm tracking-wider" style={{ color: "var(--accent)" }}>★ JUDGE VERDICT</span>
            <span className="pill pill-ok" style={{ fontSize: 9 }}>winner: [{verdict.winnerIndex}]</span>
          </div>
          <p className="text-[color:var(--muted)] font-mono text-[11px] mb-2">{verdict.rationale}</p>
          <div className="font-pixel text-[10px] tracking-wider mb-1" style={{ color: "var(--accent)" }}>MERGED ANSWER</div>
          <p className="text-sm whitespace-pre-wrap">{verdict.merged}</p>
          {verdict.fallback && <div className="pill pill-muted mt-2" style={{ fontSize: 9 }}>scored by rubric · coverage + completeness + latency</div>}
        </div>
      )}
    </div>
  );
}
