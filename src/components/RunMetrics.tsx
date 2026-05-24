"use client";
import { useMemo } from "react";
import type { RunEvent } from "@/lib/types";

function fmt(key: string, v: number) {
  if (key === "elapsed_ms" || key === "wall_time_ms" || key === "llm_ms") return `${(v / 1000).toFixed(1)}s`;
  if (key === "drift") return v.toFixed(2);
  return v.toLocaleString();
}

const ORDER = ["drift", "elapsed_ms", "replans", "tool_calls", "successes", "llm_calls", "tok_in", "tok_out"];

export function RunMetrics({
  metrics,
  events,
}: {
  metrics: Record<string, number>;
  events?: RunEvent[];
}) {
  const usage = useMemo(() => {
    if (!events) return null;
    let pin = 0;
    let pout = 0;
    let calls = 0;
    for (const e of events) {
      if (e.t === "usage") {
        pin += e.promptTokens;
        pout += e.completionTokens;
        calls += 1;
      }
    }
    return { pin, pout, calls };
  }, [events]);

  const combined: Record<string, number> = { ...metrics };
  if (usage) {
    combined.tok_in = usage.pin;
    combined.tok_out = usage.pout;
    combined.llm_calls = usage.calls;
  }

  const entries = ORDER.filter((k) => k in combined).map((k) => [k, combined[k]] as const);
  if (entries.length === 0) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {entries.map(([k, v]) => (
        <div key={k} className="card-pixel text-center">
          <div className="font-pixel text-2xl" style={{ color: "var(--accent)" }}>{fmt(k, v)}</div>
          <div className="text-xs text-[color:var(--muted)] uppercase tracking-wider mt-1">
            {k.replace(/_/g, " ")}
          </div>
        </div>
      ))}
    </div>
  );
}
