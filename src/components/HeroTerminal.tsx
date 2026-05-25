"use client";
import { useEffect, useState } from "react";

const SCRIPT: Array<{ text: string; tone: "info" | "ok" | "warn" | "accent" }> = [
  { text: "$ delos run --goal=\"research ai memory architectures\"", tone: "accent" },
  { text: "0.06s BOOT      run_id k7nP4mq · tenant=hackathon", tone: "info" },
  { text: "0.32s RECALL    3 hits from HydraDB (graph + vec)", tone: "info" },
  { text: "0.65s PLAN      planner=kimi-k2 · 3 steps", tone: "info" },
  { text: "1.21s STEP 1/3  web_search \"agent memory\"", tone: "info" },
  { text: "1.55s ✓         9 results · 1247 tok", tone: "ok" },
  { text: "2.11s CRITIC    drift=0.08 → on-goal", tone: "ok" },
  { text: "2.40s STEP 2/3  fetch + summarize", tone: "info" },
  { text: "2.71s ★ SAVE    stored under tenant", tone: "ok" },
  { text: "3.02s STEP 3/3  synthesize", tone: "info" },
  { text: "3.45s ANSWER    Graph DBs beat vectors when…", tone: "accent" },
  { text: "3.50s METRIC    tok=1.6k · cost=$0.0004 · ms=3445", tone: "info" },
];

export function HeroTerminal() {
  const [lines, setLines] = useState<typeof SCRIPT>([]);
  const [typed, setTyped] = useState("");
  const [idx, setIdx] = useState(0);
  const [cursor, setCursor] = useState(true);

  // Cursor blink
  useEffect(() => {
    const t = setInterval(() => setCursor((c) => !c), 500);
    return () => clearInterval(t);
  }, []);

  // Type-out machine
  useEffect(() => {
    if (idx >= SCRIPT.length) {
      // restart after pause
      const t = setTimeout(() => {
        setIdx(0);
        setLines([]);
        setTyped("");
      }, 4500);
      return () => clearTimeout(t);
    }
    const line = SCRIPT[idx];
    if (typed.length < line.text.length) {
      const delay = idx === 0 ? 28 : 8;
      const t = setTimeout(() => setTyped(line.text.slice(0, typed.length + 1)), delay);
      return () => clearTimeout(t);
    }
    // Line complete
    const t = setTimeout(() => {
      setLines((prev) => [...prev, line]);
      setTyped("");
      setIdx((i) => i + 1);
    }, idx === 0 ? 320 : 110);
    return () => clearTimeout(t);
  }, [typed, idx]);

  function toneColor(t: "info" | "ok" | "warn" | "accent") {
    if (t === "ok") return "var(--success)";
    if (t === "warn") return "var(--warn)";
    if (t === "accent") return "var(--accent)";
    return "var(--muted)";
  }

  return (
    <div
      className="card-pixel font-mono text-[11px] leading-[1.6]"
      style={{
        padding: 0,
        overflow: "hidden",
        borderColor: "var(--accent)",
        background: "var(--surface)",
        boxShadow: "0 0 0 2px var(--bg), 0 0 0 4px var(--accent), 8px 8px 0 var(--shadow)",
        minHeight: 320,
      }}
    >
      <div
        className="px-3 py-2 flex items-center justify-between"
        style={{ background: "var(--accent)", color: "var(--on-accent)" }}
      >
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5" style={{ background: "var(--danger)" }} />
          <span className="w-2.5 h-2.5" style={{ background: "var(--warn)" }} />
          <span className="w-2.5 h-2.5" style={{ background: "var(--success)" }} />
          <span className="font-pixel text-xs tracking-widest ml-2">★ DELOS TERMINAL · LIVE</span>
        </div>
        <span className="font-mono text-[10px] flex items-center gap-1">
          <span className="w-1.5 h-1.5 accent-pulse" style={{ background: "var(--on-accent)", display: "inline-block" }} />
          {idx >= SCRIPT.length ? "done" : "running"}
        </span>
      </div>
      <div
        className="p-4 min-h-[260px]"
        style={{
          color: "var(--fg)",
          wordBreak: "break-word",
          overflowWrap: "anywhere",
        }}
      >
        {lines.map((l, i) => (
          <div key={i} style={{ color: toneColor(l.tone) }}>{l.text}</div>
        ))}
        {idx < SCRIPT.length && (
          <div style={{ color: toneColor(SCRIPT[idx].tone) }}>
            {typed}
            <span style={{ opacity: cursor ? 1 : 0, color: "var(--accent)" }}>▌</span>
          </div>
        )}
      </div>
    </div>
  );
}
