"use client";
import type { RunEvent } from "@/lib/types";

const phaseLabel: Record<string, string> = {
  boot: "BOOT",
  recall: "RECALL",
  plan: "PLAN",
  act: "ACT",
  observe: "OBSERVE",
  critic: "CRITIC",
  replan: "REPLAN",
  store: "STORE",
  done: "DONE",
  fail: "FAIL",
};

function ts(at: number, base: number) {
  const s = ((at - base) / 1000).toFixed(2);
  return s.padStart(6, " ") + "s";
}

export function AgentLog({ events, base }: { events: RunEvent[]; base: number }) {
  return (
    <div className="card-pixel font-mono text-xs leading-relaxed max-h-[60vh] overflow-y-auto">
      {events.length === 0 ? (
        <div className="text-[color:var(--muted)]">
          Waiting for events <span className="cursor" />
        </div>
      ) : (
        events.map((e, i) => <Line key={i} ev={e} base={base} />)
      )}
    </div>
  );
}

function Line({ ev, base }: { ev: RunEvent; base: number }) {
  const t = ts(ev.at, base);
  const tag = (cls: string, label: string) => (
    <span className={`pill ${cls} mr-2`} style={{ fontSize: 10, padding: "0px 6px" }}>
      {label}
    </span>
  );
  switch (ev.t) {
    case "phase":
      return (
        <div className="py-0.5">
          <span className="text-[color:var(--muted)]">{t} </span>
          {tag("pill-info", phaseLabel[ev.phase] ?? ev.phase)}
          <span className="text-[color:var(--fg)]">{ev.note ?? ""}</span>
        </div>
      );
    case "thought":
      return (
        <div className="py-0.5">
          <span className="text-[color:var(--muted)]">{t} </span>
          {tag("pill-muted", ev.agent)}
          <span>{ev.text}</span>
        </div>
      );
    case "tool_call":
      return (
        <div className="py-0.5">
          <span className="text-[color:var(--muted)]">{t} </span>
          {tag("pill-info", "→ tool")}
          <span style={{ color: "var(--accent)" }}>{ev.name}</span>{" "}
          <span className="text-[color:var(--muted)]">{JSON.stringify(ev.args).slice(0, 140)}</span>
        </div>
      );
    case "tool_result":
      return (
        <div className="py-0.5">
          <span className="text-[color:var(--muted)]">{t} </span>
          {tag(ev.ok ? "pill-ok" : "pill-bad", ev.ok ? "✓ result" : "✗ error")}
          <span style={{ color: ev.ok ? "var(--success)" : "var(--danger)" }}>{ev.name}</span>{" "}
          <span className="text-[color:var(--muted)]">
            {ev.ok ? JSON.stringify(ev.result).slice(0, 140) : ev.error}
          </span>
        </div>
      );
    case "memory_write":
      return (
        <div className="py-0.5 powerup-flash">
          <span className="text-[color:var(--muted)]">{t} </span>
          {tag("pill-info", "★ save-state")}
          <span>{ev.preview}</span>
        </div>
      );
    case "memory_recall":
      return (
        <div className="py-0.5">
          <span className="text-[color:var(--muted)]">{t} </span>
          {tag("pill-info", "recall")}
          <span>{ev.hits} hits for &quot;{ev.query.slice(0, 60)}&quot;</span>
        </div>
      );
    case "recover":
      return (
        <div className="py-0.5">
          <span className="text-[color:var(--muted)]">{t} </span>
          {tag("pill-ok", "1-UP")}
          <span style={{ color: "var(--success)" }}>{ev.strategy}</span>{" "}
          <span className="text-[color:var(--muted)]">— {ev.reason}</span>
        </div>
      );
    case "adapt":
      return (
        <div className="py-0.5">
          <span className="text-[color:var(--muted)]">{t} </span>
          {tag("pill-warn", "WARP")}
          <span>{ev.reason}</span>{" "}
          <span className="text-[color:var(--muted)]">{ev.from.slice(0, 40)} → {ev.to.slice(0, 40)}</span>
        </div>
      );
    case "subagent":
      return (
        <div className="py-0.5">
          <span className="text-[color:var(--muted)]">{t} </span>
          {tag(ev.status === "done" ? "pill-ok" : ev.status === "fail" ? "pill-bad" : "pill-warn", `sub-agent ${ev.status}`)}
          <span style={{ color: "var(--accent)" }}>{ev.id.slice(-5)}</span>{" "}
          <span className="text-[color:var(--muted)]">{ev.result ?? ev.goal.slice(0, 80)}</span>
        </div>
      );
    case "usage":
      return (
        <div className="py-0.5">
          <span className="text-[color:var(--muted)]">{t} </span>
          {tag("pill-muted", "llm")}
          <span style={{ color: "var(--accent)" }}>{ev.role}</span>{" "}
          <span className="text-[color:var(--muted)]">{ev.model}</span>{" "}
          <span style={{ color: "var(--fg)" }}>{ev.promptTokens}→{ev.completionTokens} tok</span>{" "}
          <span className="text-[color:var(--muted)]">{ev.ms}ms</span>
        </div>
      );
    case "metric":
      return (
        <div className="py-0.5">
          <span className="text-[color:var(--muted)]">{t} </span>
          {tag("pill-muted", "metric")}
          <span>{ev.key} = </span>
          <span style={{ color: "var(--accent)" }}>{ev.value}</span>
        </div>
      );
    case "answer":
      return (
        <div className="py-2 my-2 px-3 border-l-4" style={{ borderColor: "var(--accent)" }}>
          <span className="text-[color:var(--muted)]">{t} </span>
          {tag("pill-info", "answer")}
          <div className="mt-1 text-[color:var(--fg)] whitespace-pre-wrap">{ev.text}</div>
        </div>
      );
    case "error":
      return (
        <div className="py-0.5">
          <span className="text-[color:var(--muted)]">{t} </span>
          {tag("pill-bad", "GAME OVER")}
          <span style={{ color: "var(--danger)" }}>{ev.message}</span>
        </div>
      );
    default:
      return null;
  }
}
