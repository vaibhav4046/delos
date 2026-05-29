"use client";
import { useEffect, useMemo, useState } from "react";
import * as Icons from "lucide-react";
import { getTenantId } from "@/lib/useTenant";

type LocalMem = { id: string; text: string; tags: string[]; createdAt: number };

export function AnalyticsApp() {
  const [runs, setRuns] = useState<LocalMem[]>([]);
  const [counters, setCounters] = useState<{ tools: number; tokens: number }>({ tools: 0, tokens: 0 });
  const [achievements, setAchievements] = useState<string[]>([]);

  useEffect(() => {
    const tid = getTenantId();
    fetch(`/api/memory?q=Run+completed${tid ? `&tenantId=${encodeURIComponent(tid)}` : ""}&topK=50`)
      .then((r) => r.json())
      .then((j: { local?: LocalMem[] }) => setRuns(j.local ?? []))
      .catch(() => {});
    try {
      // Mount-only hydration from localStorage · setState in an effect is
      // intentional so SSR/first paint render the zero defaults and avoid a
      // hydration mismatch.
      /* eslint-disable react-hooks/set-state-in-effect */
      const c = JSON.parse(localStorage.getItem("delos.counters.v1") ?? '{"tools":0,"tokens":0}');
      setCounters(c);
      const a = JSON.parse(localStorage.getItem("delos.achievements.v1") ?? "[]");
      setAchievements(a);
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {}
  }, []);

  const byHour = useMemo(() => {
    const buckets = new Array(24).fill(0);
    for (const r of runs) {
      const h = new Date(r.createdAt).getHours();
      buckets[h] += 1;
    }
    return buckets;
  }, [runs]);

  const maxBucket = Math.max(1, ...byHour);

  const byTag = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of runs) {
      for (const t of r.tags ?? []) m.set(t, (m.get(t) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [runs]);

  const builtApps = runs.filter((r) => r.tags?.includes("app-build")).length;
  const missions = runs.filter((r) => r.tags?.includes("run-summary")).length;

  return (
    <div className="p-3 space-y-3 text-xs">
      <div className="font-pixel text-sm tracking-wider" style={{ color: "var(--accent)" }}>★ ANALYTICS</div>
      <p className="text-[color:var(--muted)] font-mono">
        Local activity for this device. Reset by clearing localStorage.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="missions" value={missions} icon="Rocket" />
        <Stat label="apps built" value={builtApps} icon="Sparkles" />
        <Stat label="tools called" value={counters.tools} icon="Wrench" />
        <Stat label="tokens streamed" value={counters.tokens.toLocaleString()} icon="Coins" />
      </div>

      <div className="card-pixel">
        <div className="font-pixel text-[11px] tracking-wider mb-2" style={{ color: "var(--accent)" }}>RUNS BY HOUR (LOCAL)</div>
        <div className="flex items-end gap-[2px] h-24">
          {byHour.map((v, i) => (
            <div key={i} className="flex-1" title={`${String(i).padStart(2, "0")}:00 — ${v}`}>
              <div
                style={{
                  height: `${(v / maxBucket) * 100}%`,
                  background: v ? "var(--accent)" : "var(--surface-2)",
                  minHeight: 2,
                  transition: "height 200ms steps(4)",
                }}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-between mt-1 font-mono text-[9px] text-[color:var(--muted)]">
          <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
        </div>
      </div>

      <div className="card-pixel">
        <div className="font-pixel text-[11px] tracking-wider mb-2" style={{ color: "var(--accent)" }}>BY TAG</div>
        {byTag.length === 0 && <div className="text-[color:var(--muted)] font-mono">no runs yet</div>}
        <div className="space-y-1">
          {byTag.map(([tag, count]) => {
            const pct = Math.round((count / Math.max(1, runs.length)) * 100);
            return (
              <div key={tag}>
                <div className="flex justify-between text-[11px]">
                  <span className="font-mono">{tag}</span>
                  <span className="text-[color:var(--muted)]">{count} · {pct}%</span>
                </div>
                <div className="h-2 mt-0.5" style={{ background: "var(--surface-2)" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)" }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card-pixel">
        <div className="flex items-center justify-between mb-2">
          <span className="font-pixel text-[11px] tracking-wider" style={{ color: "var(--accent)" }}>ACHIEVEMENTS</span>
          <span className="pill pill-muted">{achievements.length}/7</span>
        </div>
        {achievements.length === 0 && <div className="text-[color:var(--muted)] font-mono">no achievements yet — run a mission</div>}
        <div className="flex flex-wrap gap-1">
          {achievements.map((a) => (
            <span key={a} className="pill pill-ok" style={{ fontSize: 9 }}>🏆 {a.replace(/_/g, " ")}</span>
          ))}
        </div>
      </div>

      <div className="card-pixel">
        <div className="font-pixel text-[11px] tracking-wider mb-2" style={{ color: "var(--accent)" }}>RECENT RUNS</div>
        <ul className="space-y-1 max-h-40 overflow-y-auto">
          {runs.slice(0, 12).map((r) => (
            <li key={r.id} className="text-[11px] font-mono">
              <span className="text-[color:var(--muted)]">{new Date(r.createdAt).toLocaleTimeString()}</span>{" "}
              <span style={{ color: "var(--fg)" }}>{r.text.slice(0, 80)}…</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: number | string; icon: string }) {
  const All = Icons as unknown as Record<string, React.ComponentType<{ size?: number; color?: string }>>;
  const Cmp = All[icon] ?? Icons.Activity;
  return (
    <div className="card-pixel">
      <div className="flex items-center justify-between">
        <Cmp size={14} color="var(--accent)" />
        <span className="text-[10px] text-[color:var(--muted)] uppercase tracking-wider">{label}</span>
      </div>
      <div className="font-pixel text-2xl mt-1" style={{ color: "var(--accent)" }}>{value}</div>
    </div>
  );
}
