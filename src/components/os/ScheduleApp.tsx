"use client";
// In-OS scheduled actions manager. Templates for common workflows:
// daily email digest, weekly cohort review, hourly mission, one-shot draft.
import * as Icons from "lucide-react";
import { useEffect, useState } from "react";
import { pushNotif } from "@/lib/notifications";

type ScheduledAction = {
  id: string;
  kind: string;
  label: string;
  payload: Record<string, unknown>;
  createdAt: number;
  runAt?: number;
  everyMs?: number;
  nextRunAt: number;
  lastRunAt?: number;
  enabled: boolean;
  history: Array<{ at: number; ok: boolean; note?: string }>;
};

const TEMPLATES: Array<{
  key: string;
  label: string;
  icon: keyof typeof Icons;
  kind: string;
  defaultLabel: string;
  defaultPayload: Record<string, unknown>;
  defaultEveryMs: number;
}> = [
  { key: "daily-digest", label: "Daily email digest", icon: "Mail", kind: "read_email", defaultLabel: "Morning email digest", defaultPayload: { max: 5 }, defaultEveryMs: 86_400_000 },
  { key: "weekly-cohort", label: "Weekly cohort review", icon: "Users", kind: "cohort", defaultLabel: "Weekly cohort: what changed?", defaultPayload: { question: "Summarize this week's significant changes in our market in 3 bullets." }, defaultEveryMs: 604_800_000 },
  { key: "hourly-notify", label: "Hourly notification", icon: "BellRing", kind: "notify", defaultLabel: "Hourly check-in", defaultPayload: { text: "Hourly check-in · review priorities" }, defaultEveryMs: 3_600_000 },
  { key: "draft-email", label: "Draft email (one-shot)", icon: "PenTool", kind: "draft_email", defaultLabel: "Draft follow-up email", defaultPayload: { to: "", subject: "Follow-up", body: "Hi — circling back on our last conversation." }, defaultEveryMs: 0 },
  { key: "research-mission", label: "Daily research mission", icon: "Compass", kind: "run_mission", defaultLabel: "Daily research scan", defaultPayload: { goal: "Surface the 3 most-cited HN front-page items in AI agents from the last 24 hours." }, defaultEveryMs: 86_400_000 },
];

export function ScheduleApp() {
  const [actions, setActions] = useState<ScheduledAction[]>([]);
  const [, setLoading] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/schedule");
      const j = (await r.json()) as { actions: ScheduledAction[] };
      setActions(j.actions ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Initial fetch + 10s poll; load() flips the loading flag synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const tid = setInterval(load, 10_000);
    return () => clearInterval(tid);
  }, []);

  async function quickAdd(tplKey: string) {
    const tpl = TEMPLATES.find((t) => t.key === tplKey);
    if (!tpl) return;
    setAdding(tplKey);
    try {
      const r = await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: tpl.kind,
          label: tpl.defaultLabel,
          payload: tpl.defaultPayload,
          everyMs: tpl.defaultEveryMs || undefined,
        }),
      });
      if (r.ok) {
        pushNotif({ text: `Scheduled · ${tpl.defaultLabel}`, tone: "ok", source: "schedule" });
        load();
      }
    } finally {
      setAdding(null);
    }
  }

  async function runNow(id: string) {
    try {
      const r = await fetch("/api/schedule/run-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const j = (await r.json().catch(() => ({}))) as { result?: { note?: string } };
      pushNotif({ text: r.ok ? `Action fired · ${j.result?.note ?? "ok"}` : "Action failed", tone: r.ok ? "ok" : "bad", source: "schedule" });
      load();
    } catch {
      pushNotif({ text: "Action failed", tone: "bad", source: "schedule" });
    }
  }

  async function remove(id: string) {
    await fetch(`/api/schedule?id=${id}`, { method: "DELETE" });
    setActions((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--surface)", color: "var(--fg)" }}>
      <header className="p-3" style={{ borderBottom: "1px solid var(--surface-2)" }}>
        <div className="flex items-center gap-2">
          <Icons.CalendarClock size={14} color="var(--accent)" />
          <span className="font-pixel text-xs tracking-wider" style={{ color: "var(--accent)" }}>SCHEDULED ACTIONS</span>
          <span className="font-mono text-[10px]" style={{ color: "var(--muted)" }}>{actions.length} active</span>
        </div>
        <p className="font-mono text-[10px] mt-1" style={{ color: "var(--muted)" }}>
          Drafts emails, reads inbox, posts to Notion, runs missions on a schedule.
        </p>
      </header>

      <div className="p-3 space-y-3 overflow-auto flex-1">
        <section>
          <h3 className="font-pixel text-[10px] tracking-widest mb-2" style={{ color: "var(--muted)" }}>QUICK ADD</h3>
          <div className="grid grid-cols-2 gap-2">
            {TEMPLATES.map((t) => {
              const Icon = Icons[t.icon] as React.ComponentType<{ size?: number; color?: string }>;
              return (
                <button
                  key={t.key}
                  onClick={() => quickAdd(t.key)}
                  disabled={adding === t.key}
                  className="flex items-center gap-2 p-2 transition-colors"
                  style={{ background: "var(--bg)", border: "1px solid var(--surface-2)", borderRadius: 4, cursor: "pointer", textAlign: "left" }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--surface-2)")}
                >
                  <Icon size={14} color="var(--accent)" />
                  <span className="font-mono text-[11px]" style={{ color: "var(--fg)" }}>
                    {adding === t.key ? "adding…" : t.label}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <h3 className="font-pixel text-[10px] tracking-widest mb-2" style={{ color: "var(--muted)" }}>ACTIVE SCHEDULES</h3>
          {actions.length === 0 ? (
            <div style={{ padding: 14, background: "var(--bg)", border: "1px dashed var(--surface-2)", borderRadius: 4, textAlign: "center" }}>
              <p className="font-mono text-[10px]" style={{ color: "var(--muted)" }}>No scheduled actions yet. Pick a template above.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {actions.map((a) => (
                <ActionRow key={a.id} a={a} onRunNow={runNow} onRemove={remove} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ActionRow({ a, onRunNow, onRemove }: { a: ScheduledAction; onRunNow: (id: string) => void; onRemove: (id: string) => void }) {
  const isRecurring = a.everyMs && a.everyMs > 0;
  const cadence = isRecurring ? humanInterval(a.everyMs!) : "one-shot";
  const next = a.enabled ? humanFromNow(a.nextRunAt) : "paused";
  return (
    <div className="group" style={{ padding: 10, background: "var(--bg)", border: "1px solid var(--surface-2)", borderLeft: `3px solid ${a.enabled ? "var(--accent)" : "var(--surface-2)"}`, borderRadius: 4 }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-pixel text-[9px] tracking-wider" style={{ padding: "2px 7px", background: "var(--surface-2)", color: "var(--accent)", borderRadius: 999 }}>
              {a.kind.toUpperCase().replace(/_/g, " ")}
            </span>
            <span className="font-mono text-[9px]" style={{ color: "var(--muted)" }}>
              every {cadence} · next {next}
            </span>
          </div>
          <p className="text-[11px]" style={{ fontFamily: "var(--font-mono, monospace)" }}>{a.label}</p>
          {a.history.length > 0 && (
            <p className="font-mono text-[9px] mt-1" style={{ color: a.history[0].ok ? "#86efac" : "var(--danger)" }}>
              last · {a.history[0].ok ? "✓" : "✗"} {a.history[0].note ?? "ran"}
            </p>
          )}
        </div>
        <div className="flex gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
          <button onClick={() => onRunNow(a.id)} title="Run now" style={{ padding: 5, background: "transparent", border: "none", cursor: "pointer", color: "var(--accent)" }}>
            <Icons.Play size={11} />
          </button>
          <button onClick={() => onRemove(a.id)} title="Remove" style={{ padding: 5, background: "transparent", border: "none", cursor: "pointer", color: "var(--danger)" }}>
            <Icons.Trash2 size={11} />
          </button>
        </div>
      </div>
    </div>
  );
}

function humanInterval(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}

function humanFromNow(ts: number): string {
  const d = ts - Date.now();
  if (d < 0) return "due";
  if (d < 60_000) return `${Math.round(d / 1000)}s`;
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h`;
  return `${Math.round(d / 86_400_000)}d`;
}
