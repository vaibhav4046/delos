"use client";
import * as Icons from "lucide-react";
import { useNotifs, notifStore, type Notif, type NotifTone } from "@/lib/notifications";

const TONE_COLOR: Record<NotifTone, string> = {
  ok: "#86efac",
  info: "#7dd3fc",
  warn: "#fde68a",
  bad: "#fca5a5",
  system: "var(--accent)",
};

const TONE_BG: Record<NotifTone, string> = {
  ok: "rgba(34,197,94,0.10)",
  info: "rgba(56,189,248,0.10)",
  warn: "rgba(245,158,11,0.10)",
  bad: "rgba(239,68,68,0.10)",
  system: "rgba(255,211,0,0.10)",
};

export function NotificationCenter() {
  const items = useNotifs();
  const unread = items.filter((n) => !n.read);
  return (
    <div className="flex flex-col h-full" style={{ background: "var(--surface)", color: "var(--fg)" }}>
      <header className="flex items-center justify-between p-3" style={{ borderBottom: "1px solid var(--surface-2)" }}>
        <div className="flex items-center gap-2">
          <Icons.Bell size={14} color="var(--accent)" />
          <span className="font-pixel text-xs tracking-wider" style={{ color: "var(--accent)" }}>NOTIFICATIONS</span>
          <span className="font-mono text-[10px]" style={{ color: "var(--muted)" }}>
            {unread.length} unread · {items.length} total
          </span>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => notifStore.markAllRead()}
            disabled={unread.length === 0}
            className="font-mono text-[10px] px-2 py-1 rounded"
            style={{ background: "var(--bg)", border: "1px solid var(--surface-2)", color: "var(--muted)", cursor: unread.length === 0 ? "default" : "pointer", opacity: unread.length === 0 ? 0.5 : 1 }}
          >
            ✓ MARK ALL READ
          </button>
          <button
            onClick={() => notifStore.clear()}
            disabled={items.length === 0}
            className="font-mono text-[10px] px-2 py-1 rounded"
            style={{ background: "var(--bg)", border: "1px solid var(--surface-2)", color: "var(--danger)", cursor: items.length === 0 ? "default" : "pointer", opacity: items.length === 0 ? 0.5 : 1 }}
          >
            ✕ CLEAR
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-2 space-y-1.5">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center" style={{ color: "var(--muted)" }}>
            <Icons.BellOff size={28} />
            <p className="font-mono text-[10px] mt-2">No notifications yet</p>
          </div>
        ) : (
          items.map((n) => <NotifRow key={n.id} n={n} />)
        )}
      </div>
    </div>
  );
}

function NotifRow({ n }: { n: Notif }) {
  const color = TONE_COLOR[n.tone];
  const bg = TONE_BG[n.tone];
  return (
    <div
      className="group flex items-start gap-2 transition-colors"
      style={{
        padding: "8px 10px",
        background: n.read ? "var(--bg)" : bg,
        border: "1px solid var(--surface-2)",
        borderLeft: `3px solid ${color}`,
        borderRadius: 4,
        opacity: n.read ? 0.6 : 1,
      }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          {n.source && (
            <span className="font-pixel text-[8px] tracking-wider" style={{ padding: "1px 5px", background: "var(--surface-2)", color: color, borderRadius: 999 }}>
              {n.source.toUpperCase()}
            </span>
          )}
          <span className="font-mono text-[9px]" style={{ color: "var(--muted)" }}>
            {relativeTime(n.at)}
          </span>
          {!n.read && <span style={{ width: 6, height: 6, background: color, borderRadius: 999 }} />}
        </div>
        <p className="text-[11px] leading-relaxed" style={{ color: "var(--fg)", fontFamily: "var(--font-mono, monospace)" }}>
          {n.text}
        </p>
        {n.actionLabel && n.actionAppId && (
          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent("delos-launch-app", { detail: { id: n.actionAppId } }));
              notifStore.markRead(n.id);
            }}
            className="mt-1 font-mono text-[10px] underline"
            style={{ color: color, background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
          >
            {n.actionLabel} →
          </button>
        )}
      </div>
      <div className="flex gap-0.5 opacity-50 group-hover:opacity-100 transition-opacity">
        {!n.read && (
          <button onClick={() => notifStore.markRead(n.id)} title="Mark read" style={{ padding: 4, background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer" }}>
            <Icons.Check size={11} />
          </button>
        )}
        <button onClick={() => notifStore.remove(n.id)} title="Dismiss" style={{ padding: 4, background: "transparent", border: "none", color: "var(--danger)", cursor: "pointer" }}>
          <Icons.X size={11} />
        </button>
      </div>
    </div>
  );
}

function relativeTime(ts: number): string {
  const d = Date.now() - ts;
  if (d < 0) return "now";
  if (d < 60_000) return `${Math.floor(d / 1000)}s ago`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}
