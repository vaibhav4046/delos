"use client";
// Context Inspector
// ─────────────────
// Live window into the Swarm Context Engine. Polls /api/context/state for the
// caller's own context tree (resolved server-side, so this can only ever see
// the current tenant's frames) and visualizes it: the recursive frame tree
// (thread → run → sub-agent), recursion depth, per-frame token budget usage,
// folded "and beyond" summaries, and recent items by source. "Reset" clears the
// caller's own tree via DELETE.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Network,
  RefreshCw,
  Trash2,
  Layers,
  Cpu,
  Boxes,
  ChevronRight,
  ChevronDown,
  Pin,
  Activity,
} from "lucide-react";
import type { SwarmSnapshot, FrameSnapshot, ContextSource } from "@/lib/swarmContext";

// Color per context source — self-contained hex so the dots read clearly on
// any theme without depending on which CSS vars exist.
const SOURCE_COLOR: Record<ContextSource, string> = {
  user: "#FFD60A",
  assistant: "#34D3EE",
  agent: "#A78BFA",
  subagent: "#C084FC",
  tool: "#38BDF8",
  memory: "#F59E0B",
  system: "rgba(255,255,255,0.45)",
};

const SOURCE_LABEL: Record<ContextSource, string> = {
  user: "user",
  assistant: "asst",
  agent: "agent",
  subagent: "sub",
  tool: "tool",
  memory: "mem",
  system: "ctx",
};

const KIND_COLOR: Record<FrameSnapshot["kind"], string> = {
  thread: "#FFD60A",
  run: "#34D3EE",
  subagent: "#C084FC",
};

function relTime(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function Stat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string | number; accent?: string }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 78,
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "8px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 3,
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
        {icon}
        {label}
      </span>
      <span style={{ fontSize: 18, fontWeight: 700, fontFamily: "ui-monospace, monospace", color: accent ?? "var(--accent)" }}>{value}</span>
    </div>
  );
}

export function ContextInspectorApp() {
  const [snap, setSnap] = useState<SwarmSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [auto, setAuto] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [resetting, setResetting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/context/state", { headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(`state ${r.status}`);
      const data = (await r.json()) as SwarmSnapshot;
      setSnap(data);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Mount fetch — load() is async, so setState lands after the await, not
    // synchronously. The rule can't see through the promise; disable matches
    // the repo convention for legit on-mount loads (see os/page.tsx).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Poll while auto is on AND the tab is visible — no point burning requests
  // on a backgrounded window.
  useEffect(() => {
    if (!auto) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") load();
    };
    timerRef.current = setInterval(tick, 3500);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [auto, load]);

  const reset = useCallback(async () => {
    if (typeof window !== "undefined" && !window.confirm("Clear your entire context tree? Chat threads + run frames will be forgotten. This cannot be undone.")) return;
    setResetting(true);
    try {
      await fetch("/api/context/state", { method: "DELETE" });
      await load();
    } catch {
      // best-effort
    } finally {
      setResetting(false);
    }
  }, [load]);

  const budget = snap?.tokenBudget ?? 1400;
  const frames = snap?.frames ?? [];

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--surface)", color: "var(--text, #fff)" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface-2)",
        }}
      >
        <Network size={16} style={{ color: "var(--accent)" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.3 }}>Context Inspector</div>
          <div style={{ fontSize: 10, color: "var(--muted)" }}>recursive swarm-context window · live</div>
        </div>
        <button
          onClick={() => setAuto((v) => !v)}
          title={auto ? "Live updates on" : "Live updates paused"}
          style={{
            display: "flex", alignItems: "center", gap: 4, cursor: "pointer",
            fontSize: 10, padding: "4px 8px", borderRadius: 6,
            border: "1px solid var(--border)",
            background: auto ? "var(--accent-glow)" : "transparent",
            color: auto ? "var(--accent)" : "var(--muted)",
          }}
        >
          <Activity size={12} className={auto ? "ctx-pulse" : undefined} />
          {auto ? "Live" : "Paused"}
        </button>
        <button
          onClick={() => load()}
          title="Refresh now"
          style={{ display: "flex", alignItems: "center", cursor: "pointer", fontSize: 10, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)" }}
        >
          <RefreshCw size={12} />
        </button>
        <button
          onClick={reset}
          disabled={resetting || frames.length === 0}
          title="Clear context tree"
          style={{
            display: "flex", alignItems: "center", gap: 4, cursor: frames.length === 0 ? "not-allowed" : "pointer",
            fontSize: 10, padding: "4px 8px", borderRadius: 6,
            border: "1px solid var(--danger, #FF5577)",
            background: "transparent", color: "var(--danger, #FF5577)",
            opacity: resetting || frames.length === 0 ? 0.45 : 1,
          }}
        >
          <Trash2 size={12} />
          Reset
        </button>
      </div>

      {/* Totals */}
      <div style={{ display: "flex", gap: 8, padding: "10px 12px", flexWrap: "wrap" }}>
        <Stat icon={<Boxes size={11} />} label="Frames" value={snap?.totals.frames ?? 0} />
        <Stat icon={<Layers size={11} />} label="Items" value={snap?.totals.items ?? 0} accent="#34D3EE" />
        <Stat icon={<Cpu size={11} />} label="Tokens" value={snap?.totals.tokens ?? 0} accent="#F59E0B" />
        <Stat icon={<Network size={11} />} label="Max depth" value={snap?.totals.maxDepth ?? 0} accent="#C084FC" />
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: "auto", padding: "0 12px 12px" }}>
        {loading && !snap && <div style={{ fontSize: 11, color: "var(--muted)", padding: "16px 0", textAlign: "center", fontFamily: "ui-monospace, monospace" }}>loading context…</div>}
        {err && !snap && (
          <div style={{ fontSize: 11, color: "var(--danger, #FF5577)", padding: "16px 0", textAlign: "center" }}>
            could not load context: {err}
          </div>
        )}
        {snap && frames.length === 0 && (
          <div style={{ textAlign: "center", padding: "32px 16px", color: "var(--muted)" }}>
            <Network size={26} style={{ opacity: 0.4, marginBottom: 8 }} />
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>No context yet</div>
            <div style={{ fontSize: 11, lineHeight: 1.5 }}>
              Start a chat in Del Assistant or launch an agent run. Each thread, run,
              and sub-agent will appear here as a frame in the recursive window.
            </div>
          </div>
        )}

        {frames.map((f) => {
          const pct = Math.min(100, Math.round((f.tokens / budget) * 100));
          const open = expanded[f.id] ?? false;
          const hot = pct >= 85;
          return (
            <div key={f.id} style={{ marginBottom: 8, marginLeft: Math.min(f.depth, 6) * 14 }}>
              <div
                onClick={() => setExpanded((e) => ({ ...e, [f.id]: !open }))}
                style={{
                  display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                  background: "var(--surface-2)", border: "1px solid var(--border)",
                  borderLeft: `3px solid ${KIND_COLOR[f.kind]}`,
                  borderRadius: 8, padding: "8px 10px",
                }}
              >
                {open ? <ChevronDown size={13} style={{ color: "var(--muted)", flexShrink: 0 }} /> : <ChevronRight size={13} style={{ color: "var(--muted)", flexShrink: 0 }} />}
                <span
                  style={{
                    fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6,
                    color: KIND_COLOR[f.kind], background: "rgba(255,255,255,0.05)",
                    padding: "2px 6px", borderRadius: 4, flexShrink: 0,
                  }}
                >
                  {f.kind}
                </span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {f.label}
                </span>
                <span style={{ fontSize: 9, color: "var(--muted)", flexShrink: 0 }}>d{f.depth}</span>
                <span style={{ fontSize: 9, color: "var(--muted)", flexShrink: 0 }}>
                  {f.itemCount} item{f.itemCount === 1 ? "" : "s"}
                </span>
                <span style={{ fontSize: 9, fontFamily: "ui-monospace, monospace", color: hot ? "var(--danger, #FF5577)" : "var(--muted)", flexShrink: 0 }}>
                  {f.tokens}t
                </span>
              </div>

              {/* token budget bar */}
              <div style={{ height: 3, background: "var(--surface-3)", borderRadius: 2, margin: "3px 2px 0", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${pct}%`, background: hot ? "var(--danger, #FF5577)" : KIND_COLOR[f.kind], transition: "width .3s" }} />
              </div>

              {open && (
                <div style={{ padding: "8px 4px 2px 18px" }}>
                  {f.summarizedCount > 0 && (
                    <div style={{ fontSize: 10, color: "var(--muted)", fontStyle: "italic", marginBottom: 6 }}>
                      + {f.summarizedCount} older item{f.summarizedCount === 1 ? "" : "s"} folded into summary (&ldquo;and beyond&rdquo;)
                    </div>
                  )}
                  {f.recent.length === 0 && <div style={{ fontSize: 10, color: "var(--muted)" }}>no recent items</div>}
                  {f.recent.map((it, i) => (
                    <div key={i} style={{ display: "flex", gap: 7, alignItems: "flex-start", padding: "3px 0" }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: SOURCE_COLOR[it.source], marginTop: 4, flexShrink: 0 }} />
                      <span style={{ fontSize: 9, fontFamily: "ui-monospace, monospace", color: SOURCE_COLOR[it.source], width: 32, flexShrink: 0, textTransform: "uppercase" }}>
                        {SOURCE_LABEL[it.source]}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 11, lineHeight: 1.45, color: "var(--text, rgba(255,255,255,0.85))" }}>
                        {it.pinned && <Pin size={9} style={{ color: "var(--accent)", marginRight: 3, verticalAlign: "middle" }} />}
                        {it.text}
                      </span>
                      <span style={{ fontSize: 9, color: "var(--muted-2, var(--muted))", flexShrink: 0 }}>{relTime(it.at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <style>{`
        .ctx-pulse { animation: ctxpulse 1.4s ease-in-out infinite; }
        @keyframes ctxpulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
      `}</style>
    </div>
  );
}
