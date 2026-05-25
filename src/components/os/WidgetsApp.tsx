"use client";
// Widgets dashboard · clock styles + reminders + quick-add inline.
// Each widget is independently togglable. Persisted in localStorage.

import * as Icons from "lucide-react";
import { useEffect, useState } from "react";
import { pushNotif } from "@/lib/notifications";

type Reminder = { id: string; text: string; dueAt: number; done: boolean };
type ClockStyle = "digital" | "binary" | "word" | "analog";

const REMINDERS_KEY = "delos.reminders.v1";
const CLOCK_STYLE_KEY = "delos.widget.clockStyle";

export function WidgetsApp() {
  const [clockStyle, setClockStyle] = useState<ClockStyle>("digital");
  const [now, setNow] = useState(new Date());
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [draft, setDraft] = useState("");
  const [draftMinutes, setDraftMinutes] = useState(30);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(REMINDERS_KEY);
      if (raw) setReminders(JSON.parse(raw));
      const cs = localStorage.getItem(CLOCK_STYLE_KEY) as ClockStyle | null;
      if (cs) setClockStyle(cs);
    } catch {}
  }, []);

  // 1Hz tick
  useEffect(() => {
    const tid = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(tid);
  }, []);

  // Reminder due check every 30s
  useEffect(() => {
    const tid = setInterval(() => {
      const t = Date.now();
      setReminders((prev) =>
        prev.map((r) => {
          if (!r.done && r.dueAt <= t && r.dueAt > t - 60_000) {
            pushNotif({ text: `⏰ Reminder: ${r.text}`, tone: "warn", source: "reminder" });
            return { ...r, done: true };
          }
          return r;
        }),
      );
    }, 30_000);
    return () => clearInterval(tid);
  }, []);

  function saveReminders(next: Reminder[]) {
    setReminders(next);
    try { localStorage.setItem(REMINDERS_KEY, JSON.stringify(next)); } catch {}
  }

  function pickClockStyle(s: ClockStyle) {
    setClockStyle(s);
    try { localStorage.setItem(CLOCK_STYLE_KEY, s); } catch {}
  }

  function addReminder() {
    const text = draft.trim();
    if (!text) return;
    const r: Reminder = {
      id: `rm-${Date.now()}`,
      text,
      dueAt: Date.now() + draftMinutes * 60_000,
      done: false,
    };
    saveReminders([r, ...reminders]);
    setDraft("");
    pushNotif({ text: `Reminder set · ${text} in ${draftMinutes}m`, tone: "info", source: "reminder" });
  }

  function toggleDone(id: string) {
    saveReminders(reminders.map((r) => (r.id === id ? { ...r, done: !r.done } : r)));
  }

  function removeReminder(id: string) {
    saveReminders(reminders.filter((r) => r.id !== id));
  }

  const upcoming = reminders.filter((r) => !r.done).slice(0, 6);
  const done = reminders.filter((r) => r.done).slice(0, 4);

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--surface)", color: "var(--fg)" }}>
      <header className="p-3" style={{ borderBottom: "1px solid var(--surface-2)" }}>
        <div className="flex items-center gap-2">
          <Icons.LayoutDashboard size={14} color="var(--accent)" />
          <span className="font-pixel text-xs tracking-wider" style={{ color: "var(--accent)" }}>WIDGETS</span>
        </div>
      </header>

      <div className="p-3 space-y-4 overflow-auto flex-1">
        {/* CLOCK */}
        <section style={{ padding: 12, background: "var(--bg)", border: "1px solid var(--surface-2)", borderRadius: 4 }}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-pixel text-[10px] tracking-widest" style={{ color: "var(--muted)" }}>CLOCK</h3>
            <div className="flex gap-1">
              {(["digital", "binary", "word", "analog"] as ClockStyle[]).map((s) => (
                <button
                  key={s}
                  onClick={() => pickClockStyle(s)}
                  className="font-mono text-[9px] px-2 py-1"
                  style={{
                    background: clockStyle === s ? "var(--accent)" : "var(--bg)",
                    color: clockStyle === s ? "var(--on-accent)" : "var(--muted)",
                    border: "1px solid var(--surface-2)",
                    borderRadius: 3,
                    cursor: "pointer",
                  }}
                >
                  {s.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <ClockDisplay style={clockStyle} now={now} />
        </section>

        {/* REMINDERS */}
        <section style={{ padding: 12, background: "var(--bg)", border: "1px solid var(--surface-2)", borderRadius: 4 }}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-pixel text-[10px] tracking-widest" style={{ color: "var(--muted)" }}>REMINDERS</h3>
            <span className="font-mono text-[9px]" style={{ color: "var(--muted)" }}>{upcoming.length} upcoming</span>
          </div>
          <div className="flex gap-2 mb-3">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addReminder()}
              placeholder="Remind me to…"
              className="flex-1 outline-none"
              style={{ padding: "6px 10px", background: "var(--surface)", border: "1px solid var(--surface-2)", borderRadius: 4, color: "var(--fg)", fontSize: 11, fontFamily: "var(--font-mono, monospace)" }}
            />
            <select
              value={draftMinutes}
              onChange={(e) => setDraftMinutes(Number(e.target.value))}
              style={{ padding: "6px 8px", background: "var(--surface)", border: "1px solid var(--surface-2)", borderRadius: 4, color: "var(--fg)", fontSize: 11 }}
            >
              <option value={5}>in 5m</option>
              <option value={15}>in 15m</option>
              <option value={30}>in 30m</option>
              <option value={60}>in 1h</option>
              <option value={180}>in 3h</option>
              <option value={1440}>tomorrow</option>
            </select>
            <button
              onClick={addReminder}
              className="btn-pixel"
              style={{ padding: "6px 12px", fontSize: 10 }}
            >
              ADD
            </button>
          </div>
          <div className="space-y-1">
            {upcoming.length === 0 && (
              <p className="font-mono text-[10px] text-center py-2" style={{ color: "var(--muted)" }}>
                No upcoming reminders
              </p>
            )}
            {upcoming.map((r) => (
              <ReminderRow key={r.id} r={r} onToggle={toggleDone} onRemove={removeReminder} />
            ))}
            {done.length > 0 && (
              <details className="mt-3">
                <summary className="font-mono text-[10px] cursor-pointer" style={{ color: "var(--muted)" }}>
                  {done.length} done
                </summary>
                <div className="mt-1 space-y-1">
                  {done.map((r) => (
                    <ReminderRow key={r.id} r={r} onToggle={toggleDone} onRemove={removeReminder} />
                  ))}
                </div>
              </details>
            )}
          </div>
        </section>

        {/* QUICK STATS */}
        <section style={{ padding: 12, background: "var(--bg)", border: "1px solid var(--surface-2)", borderRadius: 4 }}>
          <h3 className="font-pixel text-[10px] tracking-widest mb-2" style={{ color: "var(--muted)" }}>SYSTEM</h3>
          <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
            <Stat label="day" value={now.toLocaleDateString(undefined, { weekday: "long" })} />
            <Stat label="date" value={now.toLocaleDateString(undefined, { month: "short", day: "numeric" })} />
            <Stat label="week" value={`week ${weekNumber(now)}`} />
            <Stat label="iso" value={now.toISOString().slice(11, 19)} />
          </div>
        </section>
      </div>
    </div>
  );
}

function ClockDisplay({ style, now }: { style: ClockStyle; now: Date }) {
  if (style === "digital") {
    return (
      <div className="flex items-baseline justify-center gap-2" style={{ padding: "8px 0" }}>
        <span className="font-pixel" style={{ fontSize: 48, color: "var(--accent)", letterSpacing: 4 }}>
          {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}
        </span>
        <span className="font-pixel" style={{ fontSize: 18, color: "var(--muted)" }}>
          :{String(now.getSeconds()).padStart(2, "0")}
        </span>
      </div>
    );
  }
  if (style === "binary") {
    const h = now.getHours();
    const m = now.getMinutes();
    const s = now.getSeconds();
    return (
      <div className="flex flex-col items-center gap-1 py-2 font-mono" style={{ fontSize: 18, color: "var(--accent)", letterSpacing: 2 }}>
        <BinaryRow label="H" v={h} bits={6} />
        <BinaryRow label="M" v={m} bits={6} />
        <BinaryRow label="S" v={s} bits={6} />
      </div>
    );
  }
  if (style === "word") {
    return (
      <div className="text-center py-3">
        <p className="font-pixel" style={{ fontSize: 22, color: "var(--accent)", lineHeight: 1.4 }}>
          {timeAsWords(now)}
        </p>
      </div>
    );
  }
  // analog
  const h = now.getHours() % 12;
  const m = now.getMinutes();
  const s = now.getSeconds();
  const hourA = ((h + m / 60) / 12) * 360;
  const minA = ((m + s / 60) / 60) * 360;
  const secA = (s / 60) * 360;
  return (
    <div className="flex justify-center py-2">
      <svg width="140" height="140" viewBox="-50 -50 100 100">
        <circle cx="0" cy="0" r="46" fill="var(--bg)" stroke="var(--surface-2)" strokeWidth="2" />
        {[...Array(12)].map((_, i) => {
          const angle = (i * 30 - 90) * (Math.PI / 180);
          return (
            <line
              key={i}
              x1={Math.cos(angle) * 40}
              y1={Math.sin(angle) * 40}
              x2={Math.cos(angle) * 44}
              y2={Math.sin(angle) * 44}
              stroke="var(--muted)"
              strokeWidth="1.5"
            />
          );
        })}
        <line x1="0" y1="0" x2={Math.sin((hourA * Math.PI) / 180) * 22} y2={-Math.cos((hourA * Math.PI) / 180) * 22} stroke="var(--fg)" strokeWidth="3" strokeLinecap="round" />
        <line x1="0" y1="0" x2={Math.sin((minA * Math.PI) / 180) * 34} y2={-Math.cos((minA * Math.PI) / 180) * 34} stroke="var(--fg)" strokeWidth="2" strokeLinecap="round" />
        <line x1="0" y1="0" x2={Math.sin((secA * Math.PI) / 180) * 38} y2={-Math.cos((secA * Math.PI) / 180) * 38} stroke="var(--accent)" strokeWidth="1" strokeLinecap="round" />
        <circle cx="0" cy="0" r="2" fill="var(--accent)" />
      </svg>
    </div>
  );
}

function BinaryRow({ label, v, bits }: { label: string; v: number; bits: number }) {
  const s = v.toString(2).padStart(bits, "0");
  return (
    <div className="flex items-center gap-2">
      <span style={{ color: "var(--muted)", fontSize: 10, width: 12 }}>{label}</span>
      {s.split("").map((b, i) => (
        <span key={i} style={{ width: 14, height: 14, background: b === "1" ? "var(--accent)" : "var(--surface-2)", border: "1px solid var(--surface-2)", display: "inline-block", borderRadius: 2 }} />
      ))}
    </div>
  );
}

function timeAsWords(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const hour12 = h % 12 || 12;
  const period = h >= 12 ? "pm" : "am";
  const hourWords = ["twelve", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"][hour12];
  if (m === 0) return `${hourWords} o'clock ${period}`;
  if (m === 15) return `quarter past ${hourWords}`;
  if (m === 30) return `half past ${hourWords}`;
  if (m === 45) return `quarter to ${nextHour(hour12)}`;
  if (m < 30) return `${minuteWords(m)} past ${hourWords}`;
  return `${minuteWords(60 - m)} to ${nextHour(hour12)}`;
}

function nextHour(h12: number): string {
  return ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"][h12 % 12];
}

function minuteWords(m: number): string {
  const small: Record<number, string> = { 1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten", 11: "eleven", 12: "twelve", 13: "thirteen", 14: "fourteen", 15: "fifteen", 16: "sixteen", 17: "seventeen", 18: "eighteen", 19: "nineteen", 20: "twenty", 25: "twenty-five", 30: "thirty" };
  return small[m] ?? `${m}`;
}

function weekNumber(d: Date): number {
  const a = new Date(d.getFullYear(), 0, 1);
  return Math.ceil((((d.getTime() - a.getTime()) / 86_400_000) + a.getDay() + 1) / 7);
}

function ReminderRow({ r, onToggle, onRemove }: { r: Reminder; onToggle: (id: string) => void; onRemove: (id: string) => void }) {
  const overdue = !r.done && r.dueAt < Date.now();
  return (
    <div className="group flex items-center gap-2" style={{ padding: "6px 8px", background: "var(--surface)", border: "1px solid var(--surface-2)", borderRadius: 3 }}>
      <button onClick={() => onToggle(r.id)} style={{ background: "transparent", border: "none", padding: 2, cursor: "pointer", color: r.done ? "var(--accent)" : "var(--muted)" }}>
        {r.done ? <Icons.CheckCircle size={12} /> : <Icons.Circle size={12} />}
      </button>
      <span className="flex-1 font-mono text-[11px]" style={{ color: r.done ? "var(--muted)" : "var(--fg)", textDecoration: r.done ? "line-through" : undefined }}>
        {r.text}
      </span>
      <span className="font-mono text-[9px]" style={{ color: overdue ? "var(--danger)" : "var(--muted)" }}>
        {humanWhen(r.dueAt)}
      </span>
      <button onClick={() => onRemove(r.id)} className="opacity-0 group-hover:opacity-100 transition-opacity" style={{ padding: 2, background: "transparent", border: "none", cursor: "pointer", color: "var(--danger)" }}>
        <Icons.X size={11} />
      </button>
    </div>
  );
}

function humanWhen(ts: number): string {
  const d = ts - Date.now();
  if (d <= 0) return "due";
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h`;
  return `${Math.round(d / 86_400_000)}d`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: "6px 8px", background: "var(--surface)", border: "1px solid var(--surface-2)", borderRadius: 3 }}>
      <div style={{ color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, fontSize: 8 }}>{label}</div>
      <div style={{ color: "var(--fg)", marginTop: 2 }}>{value}</div>
    </div>
  );
}
