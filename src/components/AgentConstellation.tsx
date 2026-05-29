"use client";
import { useMemo } from "react";
import type { RunEvent } from "@/lib/types";

type NodeKey = "planner" | "executor" | "critic" | "memory" | "tools";

const NODES: Record<NodeKey, { x: number; y: number; label: string; sublabel: string; tone: string }> = {
  planner: { x: 90, y: 60, label: "PLANNER", sublabel: "groq", tone: "var(--accent)" },
  executor: { x: 230, y: 60, label: "EXECUTOR", sublabel: "groq", tone: "var(--success)" },
  critic: { x: 370, y: 60, label: "CRITIC", sublabel: "groq", tone: "var(--warn)" },
  memory: { x: 160, y: 170, label: "SAVE STATE", sublabel: "hydradb", tone: "var(--accent)" },
  tools: { x: 300, y: 170, label: "POWER-UPS", sublabel: "tools", tone: "var(--pipe)" },
};

function shortModel(m: string | undefined): string | null {
  if (!m) return null;
  // Strip provider prefix + version suffix → "gpt-oss-20b"
  const last = m.split(":").pop() ?? m;
  return last.split("/").pop() ?? last;
}

const EDGES: Array<[NodeKey, NodeKey]> = [
  ["planner", "executor"],
  ["executor", "critic"],
  ["critic", "planner"],
  ["planner", "memory"],
  ["executor", "tools"],
  ["memory", "executor"],
];

export function AgentConstellation({ events, compact = false }: { events: RunEvent[]; compact?: boolean }) {
  const recent = useMemo(() => events.slice(-12), [events]);
  // Render-time clock — drives the relative "active Xs ago" pulse below.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  // Pull dynamic model labels from usage events — first usage per role wins
  const modelByRole = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of events) {
      if (e.t === "usage" && !m[e.role]) m[e.role] = e.model;
    }
    return m;
  }, [events]);
  const dynamicNodes: typeof NODES = useMemo(() => ({
    ...NODES,
    planner: { ...NODES.planner, sublabel: shortModel(modelByRole.planner) ?? NODES.planner.sublabel },
    executor: { ...NODES.executor, sublabel: shortModel(modelByRole.executor) ?? NODES.executor.sublabel },
    critic: { ...NODES.critic, sublabel: shortModel(modelByRole.critic) ?? NODES.critic.sublabel },
  }), [modelByRole]);
  const recencyFor = (n: NodeKey): number => {
    let best = 0;
    for (const e of recent) {
      let role: NodeKey | null = null;
      if (e.t === "thought") role = e.agent === "planner" ? "planner" : e.agent === "executor" ? "executor" : "critic";
      else if (e.t === "tool_call" || e.t === "tool_result") role = "tools";
      else if (e.t === "memory_write" || e.t === "memory_recall") role = "memory";
      else if (e.t === "usage") {
        role = e.role === "subagent" ? "executor" : e.role === "appBuilder" ? "planner" : (e.role as NodeKey);
      }
      if (role === n) best = Math.max(best, 1 - Math.min(1, (now - e.at) / 4000));
    }
    return best;
  };

  const subagents = useMemo(() => {
    const map = new Map<string, { id: string; goal: string; status: "spawn" | "done" | "fail" }>();
    for (const e of events) {
      if (e.t === "subagent") map.set(e.id, { id: e.id, goal: e.goal, status: e.status });
    }
    return [...map.values()];
  }, [events]);

  const width = 460;
  const height = compact ? 220 : 260;

  return (
    <div className="card-pixel" style={{ padding: 8 }}>
      <div className="flex items-center justify-between mb-1">
        <span className="font-pixel text-xs tracking-wider" style={{ color: "var(--accent)" }}>★ AGENT CONSTELLATION</span>
        <span className="pill pill-muted" style={{ fontSize: 9 }}>{subagents.length} sub-agents</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} shapeRendering="crispEdges" aria-hidden>
        {EDGES.map(([a, b], i) => {
          const ra = recencyFor(a);
          const rb = recencyFor(b);
          const r = Math.max(ra, rb);
          return (
            <line
              key={i}
              x1={NODES[a].x}
              y1={NODES[a].y}
              x2={NODES[b].x}
              y2={NODES[b].y}
              stroke={r > 0.05 ? "var(--accent)" : "var(--surface-2)"}
              strokeWidth={r > 0.05 ? 1.5 + r * 1.5 : 1}
              opacity={0.35 + r * 0.65}
              strokeDasharray={r > 0.05 ? "6 2" : "0"}
            >
              {r > 0.05 && (
                <animate attributeName="stroke-dashoffset" from="0" to="-16" dur="0.6s" repeatCount="indefinite" />
              )}
            </line>
          );
        })}

        {(Object.keys(NODES) as NodeKey[]).map((k) => {
          const n = dynamicNodes[k];
          const r = recencyFor(k);
          const active = r > 0.05;
          const radius = 28;
          return (
            <g key={k}>
              {active && (
                <circle cx={n.x} cy={n.y} r={radius + 10 + r * 8} fill="none" stroke={n.tone} strokeWidth={2} opacity={r * 0.4} />
              )}
              <rect x={n.x - radius} y={n.y - 18} width={radius * 2} height={36} fill="var(--surface)" stroke={n.tone} strokeWidth={active ? 2 : 1} />
              <rect x={n.x - radius + 3} y={n.y - 15} width={radius * 2 - 6} height={3} fill={n.tone} opacity={active ? 1 : 0.4} />
              <text x={n.x} y={n.y - 2} textAnchor="middle" fontFamily="var(--font-pixel)" fontSize="9" fill="var(--fg)" letterSpacing="0.5">{n.label}</text>
              <text x={n.x} y={n.y + 11} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="8" fill="var(--muted)">{n.sublabel}</text>
            </g>
          );
        })}

        {subagents.slice(0, 5).map((s, i) => {
          const angle = (i / Math.max(1, subagents.length)) * Math.PI - Math.PI / 2;
          const cx = 230 + Math.cos(angle) * 130;
          const cy = 60 + Math.sin(angle) * 50;
          const color = s.status === "done" ? "var(--success)" : s.status === "fail" ? "var(--danger)" : "var(--warn)";
          return (
            <g key={s.id}>
              <line x1={NODES.executor.x} y1={NODES.executor.y} x2={cx} y2={cy} stroke={color} strokeWidth={1} opacity={0.5} strokeDasharray={s.status === "spawn" ? "3 2" : "0"}>
                {s.status === "spawn" && (
                  <animate attributeName="stroke-dashoffset" from="0" to="-10" dur="0.4s" repeatCount="indefinite" />
                )}
              </line>
              <circle cx={cx} cy={cy} r={8} fill="var(--surface)" stroke={color} strokeWidth={1.5} />
              <text x={cx} y={cy + 2} textAnchor="middle" fontFamily="var(--font-pixel)" fontSize="7" fill={color}>S{i + 1}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
