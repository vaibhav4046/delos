"use client";
import { useEffect, useState } from "react";
import * as Icons from "lucide-react";

// DevFactory OS — agents as cores.
// Live grid showing each agent role as a CPU core with BUSY / CRSH / IDLE / SYNC.
// Subscribes to the intent bus broadcastAgent events already fired by /api/run + Terminal.

type CoreId = "C01" | "C02" | "C03" | "C04";
type CoreStatus = "BUSY" | "CRSH" | "IDLE" | "SYNC";

type Core = {
  id: CoreId;
  label: string;
  role: string;
  status: CoreStatus;
  detail: string;
  lastUpdate: number;
  uptimeStart: number;
};

const INITIAL: Record<CoreId, Core> = {
  C01: { id: "C01", label: "PM agent", role: "planner", status: "IDLE", detail: "routing logic", lastUpdate: 0, uptimeStart: Date.now() },
  C02: { id: "C02", label: "Architect", role: "executor", status: "IDLE", detail: "tool dispatch", lastUpdate: 0, uptimeStart: Date.now() },
  C03: { id: "C03", label: "Security", role: "critic", status: "IDLE", detail: "drift check", lastUpdate: 0, uptimeStart: Date.now() },
  C04: { id: "C04", label: "QA eval", role: "memory", status: "IDLE", detail: "hydra recall", lastUpdate: 0, uptimeStart: Date.now() },
};

const STATUS_COLORS: Record<CoreStatus, { bg: string; fg: string; border: string }> = {
  BUSY: { bg: "rgba(34, 197, 94, 0.18)", fg: "#22c55e", border: "#22c55e" },
  CRSH: { bg: "rgba(239, 68, 68, 0.18)", fg: "#ef4444", border: "#ef4444" },
  IDLE: { bg: "rgba(123, 123, 153, 0.10)", fg: "#9ca3af", border: "#7b7b99" },
  SYNC: { bg: "rgba(59, 130, 246, 0.18)", fg: "#3b82f6", border: "#3b82f6" },
};

// Map intent-bus agent states to core status.
function mapState(state: string): CoreStatus {
  if (state === "thinking" || state === "tool") return "BUSY";
  if (state === "done") return "SYNC";
  if (state === "idle") return "IDLE";
  if (state === "error") return "CRSH";
  return "IDLE";
}

// Map agent role to core id.
const ROLE_TO_CORE: Record<string, CoreId> = {
  planner: "C01",
  executor: "C02",
  critic: "C03",
  memory: "C04",
};

export function CoresApp() {
  const [cores, setCores] = useState<Record<CoreId, Core>>(INITIAL);
  const [autopatch, setAutopatch] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    function onAgent(e: Event) {
      const d = (e as CustomEvent).detail as { id?: string; status?: string };
      if (!d?.id || !d?.status) return;
      const coreId = ROLE_TO_CORE[d.id];
      if (!coreId) return;
      const status = mapState(d.status);
      setCores((prev) => ({
        ...prev,
        [coreId]: { ...prev[coreId], status, lastUpdate: Date.now() },
      }));
      // Auto-patch animation when a core moves to CRSH
      if (status === "CRSH") {
        const target: CoreId = coreId === "C01" ? "C02" : "C01";
        setAutopatch(`core ${coreId} raised exception · rerouting context to ${target}`);
        setTimeout(() => setAutopatch(null), 4000);
      }
    }
    window.addEventListener("delos-agent-activity", onAgent as EventListener);
    return () => window.removeEventListener("delos-agent-activity", onAgent as EventListener);
  }, []);

  // Re-render every second for uptime ticker
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Ticks once a second (see effect above) so uptime stays live at render.
  // eslint-disable-next-line react-hooks/purity
  const uptimeMs = Date.now() - Math.min(...Object.values(cores).map((c) => c.uptimeStart));
  const uptimeStr = formatUptime(uptimeMs);
  const busyCount = Object.values(cores).filter((c) => c.status === "BUSY").length;

  // suppress unused warning — `tick` is the heartbeat dependency
  void tick;

  return (
    <div className="p-3 space-y-3 text-xs">
      <div className="flex items-center gap-2">
        <Icons.Cpu size={14} color="var(--accent)" />
        <span className="font-pixel text-sm tracking-wider" style={{ color: "var(--accent)" }}>
          DEVFACTORY · CORES
        </span>
        <span className="pill pill-muted" style={{ fontSize: 9 }}>agents as cores</span>
      </div>

      <p className="font-mono text-[color:var(--muted)]">
        Treat AI agents the way an OS treats CPU cores. Live task manager. Crashes auto-route.
      </p>

      <div className="card-pixel">
        <div className="flex items-center justify-between mb-2">
          <span className="font-pixel text-[10px] tracking-widest" style={{ color: "var(--success)" }}>
            ● CLUSTER · {busyCount} ACTIVE · UPTIME {uptimeStr}
          </span>
          <span className="font-mono" style={{ fontSize: 9, color: "var(--muted)" }}>
            {"// CORE ALLOCATION"}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {Object.values(cores).map((c) => {
            const col = STATUS_COLORS[c.status];
            return (
              <div
                key={c.id}
                className="card-pixel"
                style={{
                  background: col.bg,
                  borderColor: col.border,
                  borderWidth: 2,
                  padding: 8,
                  transition: "all 200ms",
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-pixel text-[11px] tracking-wider" style={{ color: col.fg }}>
                    {c.id}
                  </span>
                  <span
                    className="font-pixel text-[10px] tracking-widest"
                    style={{ color: col.fg }}
                  >
                    {c.status}
                  </span>
                </div>
                <div className="font-mono mt-1" style={{ color: "var(--fg)", fontSize: 11 }}>
                  {c.label}
                </div>
                <div className="font-mono" style={{ color: "var(--muted)", fontSize: 9 }}>
                  {c.detail}
                </div>
              </div>
            );
          })}
        </div>

        {autopatch && (
          <div
            className="card-pixel mt-2 animate-pulse"
            style={{ borderColor: "var(--warn)", padding: 6 }}
          >
            <span className="font-mono" style={{ color: "var(--warn)", fontSize: 10 }}>
              [auto-patch] {autopatch}
            </span>
          </div>
        )}
      </div>

      <div className="card-pixel" style={{ padding: 6 }}>
        <div className="font-pixel text-[10px] tracking-widest mb-1" style={{ color: "var(--accent)" }}>
          ★ HOW IT WORKS
        </div>
        <ul className="font-mono space-y-0.5" style={{ fontSize: 10, color: "var(--muted)" }}>
          <li>· Each core maps to one agent role (planner/executor/critic/memory).</li>
          <li>· Status updates fire live from the intent bus — open Terminal and run a goal.</li>
          <li>· Crashes trigger auto-patch: context reroutes to a healthy core.</li>
          <li>· Idle cores draw zero tokens. Pay only for what runs.</li>
        </ul>
      </div>
    </div>
  );
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m ${sec}s`;
}
