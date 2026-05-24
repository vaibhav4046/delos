"use client";
import { useEffect, useState } from "react";
import * as Icons from "lucide-react";

type Agent = { id: string; name: string; role: string; model: string; status: "idle" | "thinking" | "tool" | "done" };

const ROSTER: Agent[] = [
  { id: "planner", name: "Planner", role: "decompose", model: "kimi-k2", status: "idle" },
  { id: "executor", name: "Executor", role: "run tools", model: "llama-3.3", status: "idle" },
  { id: "critic", name: "Critic", role: "verify", model: "qwen-2.5", status: "idle" },
  { id: "tooler", name: "Tooler", role: "MCP / web", model: "gpt-oss", status: "idle" },
  { id: "memory", name: "Memory", role: "HydraDB", model: "embedded", status: "idle" },
];

// Tiny widget — bottom-left, shows active agents pulsing.
// Click to expand, click again to collapse, hover for tooltip.
export function AgentPulse({ onOpen }: { onOpen: () => void }) {
  const [agents, setAgents] = useState<Agent[]>(ROSTER);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    // Simulate light activity — random agent flickers
    const t = setInterval(() => {
      setAgents((prev) =>
        prev.map((a) => {
          const r = Math.random();
          if (r < 0.04) return { ...a, status: "thinking" };
          if (r < 0.06) return { ...a, status: "tool" };
          if (r < 0.10) return { ...a, status: "done" };
          if (a.status !== "idle" && r < 0.4) return { ...a, status: "idle" };
          return a;
        }),
      );
    }, 1100);
    return () => clearInterval(t);
  }, []);

  // Listen for real agent activity from intent bus
  useEffect(() => {
    function onActivity(e: Event) {
      const d = (e as CustomEvent).detail as { id?: string; status?: Agent["status"] };
      if (!d?.id) return;
      setAgents((prev) => prev.map((a) => (a.id === d.id ? { ...a, status: d.status ?? a.status } : a)));
    }
    window.addEventListener("delos-agent-activity", onActivity as EventListener);
    return () => window.removeEventListener("delos-agent-activity", onActivity as EventListener);
  }, []);

  const activeCount = agents.filter((a) => a.status !== "idle").length;

  return (
    <div
      className="fixed left-3 z-[90]"
      style={{ bottom: 70 }}
    >
      {expanded && (
        <div
          className="card-pixel mb-2 p-2 min-w-[200px] animate-[fadeIn_180ms_ease-out]"
          style={{ background: "var(--surface)", borderColor: "var(--accent)" }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="font-pixel text-[10px] tracking-widest" style={{ color: "var(--accent)" }}>
              ★ AGENTS
            </span>
            <button
              onClick={onOpen}
              className="text-[9px] font-mono"
              style={{ color: "var(--muted)", cursor: "pointer" }}
            >
              open →
            </button>
          </div>
          <ul className="space-y-1">
            {agents.map((a) => {
              const dotColor =
                a.status === "thinking"
                  ? "var(--accent)"
                  : a.status === "tool"
                    ? "var(--warn)"
                    : a.status === "done"
                      ? "var(--success)"
                      : "var(--surface-2)";
              return (
                <li key={a.id} className="flex items-center gap-2 text-[10px] font-mono" style={{ color: "var(--fg)" }}>
                  <span
                    className={a.status !== "idle" ? "accent-pulse" : ""}
                    style={{
                      width: 6,
                      height: 6,
                      background: dotColor,
                      display: "inline-block",
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ color: "var(--fg)", flex: 1 }}>{a.name}</span>
                  <span style={{ color: "var(--muted)", fontSize: 9 }}>{a.model}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <button
        onClick={() => setExpanded((x) => !x)}
        className="card-pixel flex items-center gap-2"
        style={{
          padding: "6px 10px",
          cursor: "pointer",
          background: "var(--surface)",
          borderColor: activeCount > 0 ? "var(--accent)" : "var(--surface-2)",
          boxShadow: activeCount > 0 ? "0 0 0 1px var(--bg), 0 0 0 2px var(--accent), 2px 2px 0 var(--shadow)" : undefined,
        }}
        title="Agents constellation"
        aria-label={`${activeCount} agents active`}
      >
        <Icons.Cpu size={12} color="var(--accent)" className={activeCount > 0 ? "accent-pulse" : ""} />
        <span className="font-pixel text-[9px] tracking-widest" style={{ color: "var(--fg)" }}>
          {activeCount > 0 ? `${activeCount} ACTIVE` : "AGENTS"}
        </span>
        <span className="flex gap-0.5">
          {agents.map((a) => (
            <span
              key={a.id}
              style={{
                width: 4,
                height: 4,
                display: "inline-block",
                background:
                  a.status === "thinking"
                    ? "var(--accent)"
                    : a.status === "tool"
                      ? "var(--warn)"
                      : a.status === "done"
                        ? "var(--success)"
                        : "var(--surface-2)",
              }}
            />
          ))}
        </span>
      </button>
    </div>
  );
}
