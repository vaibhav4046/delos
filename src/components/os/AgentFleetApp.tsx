"use client";
// CROWN · AgentFleetApp · spawn N parallel agents · each on isolated
// tenant subnamespace · each rendered in its own xterm terminal pane.
//
// Mirrors MissionControl's Agent Fleet view: side-by-side live terminals
// per agent, isolated context, shared memory backbone (HydraDB). The
// "git worktree isolation" they get from filesystem worktrees, we get
// from tenant subnamespace isolation in HydraDB (tenantId =
// "<base>__agent_<n>"). Writes never cross-contaminate.

import { useEffect, useMemo, useRef, useState } from "react";
import * as Icons from "lucide-react";
import { XtermPanel } from "./XtermPanel";

type FleetAgent = {
  id: string;
  name: string;
  goal: string;
  tenant: string;
  status: "idle" | "running" | "done" | "fail";
  lastAnswer?: string;
};

function readBaseTenant(): string {
  if (typeof window === "undefined") return "delrio_demo";
  try {
    const G = window as unknown as { __delos_tenant?: string };
    if (G.__delos_tenant) return G.__delos_tenant;
    const raw = window.localStorage.getItem("delos.tenant");
    if (raw) return raw;
  } catch {}
  return "delrio_demo";
}

// Suggested parallel goals · default deck demoes resilience under chaos:
// each agent in its own isolated subspace. Tweakable by user.
const DEFAULT_GOALS = [
  "research top 3 wireless earbuds under £50 with prices and key features",
  "summarize the four pillars of agents under pressure in five bullets",
  "compare graph databases vs vector databases for AI agent memory",
];

export function AgentFleetApp() {
  const baseTenant = useMemo(() => readBaseTenant(), []);
  const [agents, setAgents] = useState<FleetAgent[]>(() =>
    DEFAULT_GOALS.map((goal, i) => ({
      id: `agent-${Date.now().toString(36)}-${i}`,
      name: `Agent ${i + 1}`,
      goal,
      tenant: `judge_fleet_${baseTenant}_agent_${i + 1}`,
      status: "idle",
    })),
  );
  const [version, setVersion] = useState(0); // re-mount xterm panels on launch
  const launchedRef = useRef(0);

  function launchAll() {
    launchedRef.current++;
    setAgents((prev) =>
      prev.map((a, i) => ({
        ...a,
        id: `agent-${Date.now().toString(36)}-${i}-${launchedRef.current}`,
        tenant: `judge_fleet_${Date.now().toString(36)}_agent_${i + 1}`,
        status: "running" as const,
      })),
    );
    setVersion((v) => v + 1);
  }

  function updateGoal(i: number, goal: string) {
    setAgents((prev) => prev.map((a, idx) => (idx === i ? { ...a, goal } : a)));
  }

  function addAgent() {
    if (agents.length >= 6) return;
    const i = agents.length;
    setAgents((prev) => [
      ...prev,
      {
        id: `agent-${Date.now().toString(36)}-${i}`,
        name: `Agent ${i + 1}`,
        goal: "answer in two sentences: what is HydraDB",
        tenant: `judge_fleet_${baseTenant}_agent_${i + 1}`,
        status: "idle",
      },
    ]);
  }

  function removeAgent(i: number) {
    setAgents((prev) => prev.filter((_, idx) => idx !== i));
  }

  // Sync overall fleet state for header indicator.
  useEffect(() => {
    // noop · individual agents track their own status via xterm panel callbacks below
  }, [agents.length]);

  const runningCount = agents.filter((a) => a.status === "running").length;
  const doneCount = agents.filter((a) => a.status === "done").length;

  return (
    <div className="p-3 flex flex-col gap-2 h-full" style={{ background: "var(--surface)", color: "var(--fg)" }}>
      {/* Header · sponsor bait + fleet status */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="font-pixel"
          style={{
            fontSize: 10,
            letterSpacing: "0.18em",
            padding: "3px 8px",
            background: "var(--accent)",
            color: "var(--on-accent, #000)",
          }}
        >
          AGENT FLEET · PARALLEL
        </span>
        <span
          className="font-mono"
          style={{
            fontSize: 10,
            padding: "3px 8px",
            color: "var(--cyan, #5DE6FF)",
            border: "1px solid var(--cyan, #5DE6FF)",
          }}
          title="Each agent runs on an isolated tenant subnamespace in HydraDB. Memory writes never cross-contaminate · same pattern as git worktrees in MissionControl, but namespace-based for serverless deployments."
        >
          ● ISOLATED TENANTS · {agents.length} CORES
        </span>
        <span className="font-mono" style={{ fontSize: 10, color: "var(--muted)" }}>
          {runningCount} running · {doneCount} done
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          <button
            onClick={addAgent}
            disabled={agents.length >= 6}
            className="pill pill-muted cursor-pointer"
            style={{ fontSize: 10, padding: "3px 8px" }}
          >
            <Icons.Plus size={10} /> ADD
          </button>
          <button
            onClick={launchAll}
            className="pill pill-info cursor-pointer"
            style={{ fontSize: 10, padding: "3px 10px" }}
          >
            <Icons.Play size={10} /> LAUNCH FLEET
          </button>
        </div>
      </div>

      <div className="text-[10px] font-mono" style={{ color: "var(--muted)" }}>
        Spawns {agents.length} parallel agents · each writes to{" "}
        <code style={{ color: "var(--accent)" }}>tenantId = judge_fleet_…_agent_&lt;n&gt;</code> ·{" "}
        knowledge graph stays isolated per agent · matches MissionControl&apos;s git-worktree pattern
        for serverless deployments.
      </div>

      {/* Agent panes · 1×N column grid with mini xterm each */}
      <div
        className="grid gap-2 overflow-auto"
        style={{
          gridTemplateColumns: agents.length <= 2 ? "1fr" : "1fr 1fr",
          flex: 1,
          minHeight: 0,
        }}
      >
        {agents.map((a, i) => (
          <div
            key={`${a.id}-${version}`}
            className="flex flex-col"
            style={{
              border: "1px solid var(--surface-2)",
              background: "var(--bg)",
              minHeight: 220,
            }}
          >
            {/* Pane header */}
            <div
              className="flex items-center gap-2 px-2 py-1"
              style={{ background: "var(--surface-2)", borderBottom: "1px solid var(--bg)" }}
            >
              <span
                className="font-pixel"
                style={{ fontSize: 10, color: "var(--accent)", letterSpacing: "0.12em" }}
              >
                ★ {a.name}
              </span>
              <span
                className="font-mono"
                style={{ fontSize: 9, color: "var(--muted)" }}
              >
                {a.tenant.slice(0, 40)}
              </span>
              <button
                onClick={() => removeAgent(i)}
                className="ml-auto pill pill-muted"
                style={{ fontSize: 9, padding: "1px 6px", cursor: "pointer" }}
                title="Remove agent"
              >
                <Icons.X size={9} />
              </button>
            </div>
            {/* Goal input · always editable */}
            <input
              value={a.goal}
              onChange={(e) => updateGoal(i, e.target.value)}
              placeholder="mission · short, one-line goal"
              className="font-mono"
              style={{
                fontSize: 11,
                padding: "4px 8px",
                background: "var(--surface)",
                color: "var(--fg)",
                border: "none",
                borderBottom: "1px solid var(--surface-2)",
                outline: "none",
              }}
            />
            {/* Xterm pane · key includes version so it re-mounts on launch */}
            {version > 0 ? (
              <XtermPanel
                key={`xt-${a.id}`}
                goal={a.goal}
                tenant={a.tenant}
                height={220}
                autoStart
                onAnswer={(txt) =>
                  setAgents((prev) =>
                    prev.map((x, idx) =>
                      idx === i
                        ? { ...x, status: "done" as const, lastAnswer: txt.slice(0, 120) }
                        : x,
                    ),
                  )
                }
                onDone={() =>
                  setAgents((prev) =>
                    prev.map((x, idx) =>
                      idx === i && x.status === "running"
                        ? { ...x, status: "done" as const }
                        : x,
                    ),
                  )
                }
                prelude={`\x1b[90m# ${a.name} · tenant=${a.tenant}\r\n# waiting for LAUNCH FLEET click…\x1b[0m`}
              />
            ) : (
              <div
                className="font-mono"
                style={{
                  fontSize: 11,
                  padding: 12,
                  color: "var(--muted)",
                  background: "#07070B",
                  height: 220,
                  border: "1px solid var(--surface-2)",
                  overflow: "auto",
                }}
              >
                # {a.name} · tenant <code style={{ color: "var(--accent)" }}>{a.tenant}</code>
                <br />
                # press <code style={{ color: "var(--cyan)" }}>LAUNCH FLEET</code> to spawn this
                agent into its xterm
              </div>
            )}
            {a.lastAnswer && (
              <div
                className="font-mono"
                style={{
                  fontSize: 10,
                  padding: "4px 8px",
                  background: "var(--surface-2)",
                  color: "var(--success, #6AB04C)",
                  borderTop: "1px solid var(--bg)",
                }}
              >
                ✓ {a.lastAnswer}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
