"use client";
import type { ChaosKind } from "@/lib/types";

const opts: Array<{ k: ChaosKind; label: string; desc: string }> = [
  { k: "tool_flake", label: "Tool flake", desc: "60% transient error rate per call" },
  { k: "tool_outage", label: "Tool outage", desc: "Search + fetch fail hard — force fallback" },
  { k: "context_flood", label: "Context flood", desc: "Inject 20 irrelevant memories" },
];

export function ChaosControls({
  selected,
  onChange,
  disabled,
}: {
  selected: Set<ChaosKind>;
  onChange: (next: Set<ChaosKind>) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid sm:grid-cols-3 gap-2">
      {opts.map((o) => {
        const on = selected.has(o.k);
        return (
          <button
            key={o.k}
            type="button"
            disabled={disabled}
            onClick={() => {
              const next = new Set(selected);
              if (on) next.delete(o.k);
              else next.add(o.k);
              onChange(next);
            }}
            className="card-pixel text-left"
            style={{
              borderColor: on ? "var(--danger)" : "var(--surface-2)",
              boxShadow: on ? "0 4px 0 0 #7a1f15" : undefined,
              opacity: disabled ? 0.6 : 1,
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-pixel text-sm tracking-wider">{o.label.toUpperCase()}</span>
              <span className={`pill ${on ? "pill-bad" : "pill-muted"}`}>{on ? "ON" : "OFF"}</span>
            </div>
            <p className="text-xs text-[color:var(--muted)]">{o.desc}</p>
          </button>
        );
      })}
    </div>
  );
}
