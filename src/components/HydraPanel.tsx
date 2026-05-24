"use client";
import { useMemo } from "react";
import type { RunEvent } from "@/lib/types";

// HydraDB recall + write panel — highlights memory operations during run.
// Shows what was recalled, what got stored. Key proof of HydraDB integration.

export function HydraPanel({ events }: { events: RunEvent[] }) {
  const recalls = useMemo(
    () => events.filter((e): e is Extract<RunEvent, { t: "memory_recall" }> => e.t === "memory_recall"),
    [events],
  );
  const writes = useMemo(
    () => events.filter((e): e is Extract<RunEvent, { t: "memory_write" }> => e.t === "memory_write"),
    [events],
  );
  const phases = useMemo(
    () =>
      events.filter(
        (e): e is Extract<RunEvent, { t: "phase" }> => e.t === "phase" && (e.phase === "recall" || e.phase === "store"),
      ),
    [events],
  );

  const totalRecallHits = recalls.reduce((acc, r) => acc + r.hits, 0);
  const writeCount = writes.length;

  return (
    <div
      className="card-pixel"
      style={{
        borderColor: "var(--accent)",
        background: "rgba(var(--surface-rgb), 0.6)",
        backdropFilter: "blur(8px)",
        padding: 12,
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="font-pixel text-sm tracking-widest" style={{ color: "var(--accent)" }}>
          ★ HYDRADB SAVE-STATE
        </span>
        <div className="flex gap-1 text-[10px] font-mono">
          <span className="pill pill-info" style={{ fontSize: 9 }}>
            {totalRecallHits} recall hits
          </span>
          <span className="pill pill-ok" style={{ fontSize: 9 }}>
            {writeCount} writes
          </span>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="font-mono text-[11px]" style={{ color: "var(--muted)" }}>
          Run a mission to see HydraDB recall + write events live.
        </div>
      ) : (
        <div className="space-y-1.5">
          {phases.map((p, i) => (
            <div key={`p-${i}`} className="flex items-center gap-2 font-mono text-[10px]">
              <span
                className="pill"
                style={{
                  fontSize: 9,
                  background: p.phase === "recall" ? "var(--accent)" : "var(--success)",
                  color: "var(--on-accent)",
                }}
              >
                {p.phase.toUpperCase()}
              </span>
              <span style={{ color: "var(--fg)" }}>{p.note}</span>
            </div>
          ))}
          {recalls.map((r, i) => (
            <div
              key={`r-${i}`}
              className="font-mono text-[10px] pl-2"
              style={{
                borderLeft: "2px solid var(--accent)",
                color: "var(--fg)",
              }}
            >
              ← <strong>{r.hits}</strong> matching memories for &quot;{r.query.slice(0, 60)}&quot;
              {r.hits > 0 && (
                <span style={{ color: "var(--success)" }}> → fed into planner context</span>
              )}
              {r.hits === 0 && (
                <span style={{ color: "var(--muted)" }}> → planner runs cold (first time)</span>
              )}
            </div>
          ))}
          {writes.map((w, i) => (
            <div
              key={`w-${i}`}
              className="font-mono text-[10px] pl-2"
              style={{
                borderLeft: "2px solid var(--success)",
                color: "var(--fg)",
              }}
            >
              → <strong>stored</strong>: {w.preview.slice(0, 100)}…
              <div style={{ color: "var(--muted)", fontSize: 9 }}>
                key=<code style={{ color: "var(--accent)" }}>{w.key}</code> · queryable on next run
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 pt-2 border-t border-[color:var(--surface-2)] text-[9px] font-mono" style={{ color: "var(--muted)" }}>
        every run reads + writes here · cross-device via tenant ID · <a href="/memory" style={{ color: "var(--accent)", textDecoration: "underline" }}>browse memory →</a>
      </div>
    </div>
  );
}
