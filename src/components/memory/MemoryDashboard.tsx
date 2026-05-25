"use client";
// Comprehensive interactive memory dashboard.
//
// Shared by the /memory route AND the in-OS Memory Browser window. Surfaces:
//   • live sync (auto-poll every 8s + manual refresh)
//   • stats header · total, by-type, last-write, recall hits
//   • semantic + lexical query input with debounced live search
//   • filter chips (type · pinned, user-fact, run-summary, learning, preference)
//   • inline actions per row · copy, pin, delete
//   • clean recall row renderer (parses "User fact · k = v" into a tidy card)
//   • aesthetic dark surface + spacing scale + subtle motion + skeleton states
//
// State: query-controlled. tenant comes from a hook so the component drops
// straight into either the marketing route or the OS shell.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Icons from "lucide-react";

export type MemHit = { text: string; score: number };
export type LocalMem = { id: string; text: string; tags: string[]; createdAt: number };

type Tone = "user-fact" | "preference" | "learning" | "run-summary" | "app-build" | "app-spec" | "other";

function toneOf(text: string, tags: string[]): Tone {
  if (tags.includes("user-fact") || /^User fact\b/i.test(text)) return "user-fact";
  if (tags.includes("preference") || /preference/i.test(text)) return "preference";
  if (tags.includes("learning") || /learning|learned/i.test(text.slice(0, 40))) return "learning";
  if (tags.includes("run-summary")) return "run-summary";
  if (tags.includes("app-build") || /codegen|build-app|materialize/i.test(text)) return "app-build";
  if (tags.includes("app-spec")) return "app-spec";
  return "other";
}

const TONE_LABEL: Record<Tone, string> = {
  "user-fact": "User fact",
  preference: "Preference",
  learning: "Learning",
  "run-summary": "Run summary",
  "app-build": "App build",
  "app-spec": "App spec",
  other: "Note",
};

const TONE_COLOR: Record<Tone, { bg: string; fg: string; border: string }> = {
  "user-fact": { bg: "rgba(34, 197, 94, 0.12)", fg: "#86efac", border: "#16a34a" },
  preference: { bg: "rgba(168, 85, 247, 0.12)", fg: "#d8b4fe", border: "#a855f7" },
  learning: { bg: "rgba(56, 189, 248, 0.12)", fg: "#7dd3fc", border: "#38bdf8" },
  "run-summary": { bg: "rgba(148, 163, 184, 0.12)", fg: "#cbd5e1", border: "#64748b" },
  "app-build": { bg: "rgba(251, 191, 36, 0.12)", fg: "#fde68a", border: "#f59e0b" },
  "app-spec": { bg: "rgba(244, 114, 182, 0.12)", fg: "#fbcfe8", border: "#ec4899" },
  other: { bg: "rgba(148, 163, 184, 0.08)", fg: "#94a3b8", border: "#475569" },
};

// Render a User fact row as `key = value` not the raw stored prefix.
function renderText(text: string): string {
  const m = text.match(/^User fact\s*[·-]\s*(.+)$/i);
  if (m) return m[1].trim();
  return text;
}

export function MemoryDashboard({
  tenant,
  compact = false,
  defaultQuery = "",
  autoRefreshMs = 8000,
}: {
  tenant: string | null;
  compact?: boolean;
  defaultQuery?: string;
  autoRefreshMs?: number;
}) {
  const [query, setQuery] = useState(defaultQuery);
  const [hits, setHits] = useState<MemHit[]>([]);
  const [local, setLocal] = useState<LocalMem[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [toneFilter, setToneFilter] = useState<Tone | "all">("all");
  const [autoSync, setAutoSync] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (q: string) => {
      setLoading(true);
      setError(null);
      try {
        const url = `/api/memory?q=${encodeURIComponent(q || "recent")}${tenant ? `&tenantId=${encodeURIComponent(tenant)}` : ""}&topK=24`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`memory ${r.status}`);
        const j = (await r.json()) as { hits: MemHit[]; local: LocalMem[] };
        setHits(Array.isArray(j.hits) ? j.hits : []);
        setLocal(Array.isArray(j.local) ? j.local : []);
        setLastSync(Date.now());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [tenant],
  );

  // Initial load + tenant change.
  useEffect(() => {
    load(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant]);

  // Debounced live search on query change.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(query), 320);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Auto-poll for "always synced" feel.
  useEffect(() => {
    if (!autoSync || autoRefreshMs <= 0) return;
    const tid = setInterval(() => load(query), autoRefreshMs);
    return () => clearInterval(tid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSync, autoRefreshMs, query]);

  async function deleteOne(id: string) {
    setBusy(id);
    try {
      const r = await fetch("/api/memory/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, tenantId: tenant }),
      });
      if (!r.ok) throw new Error(`delete ${r.status}`);
      setLocal((prev) => prev.filter((m) => m.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function pinHit(text: string) {
    setBusy(text);
    try {
      const r = await fetch("/api/memory/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, tags: ["pinned"], tenantId: tenant }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `pin ${r.status}`);
      }
      load(query);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function copy(s: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(s).catch(() => {});
    }
  }

  const localFiltered = useMemo(() => {
    if (toneFilter === "all") return local;
    return local.filter((m) => toneOf(m.text, m.tags) === toneFilter);
  }, [local, toneFilter]);

  const stats = useMemo(() => {
    const tones = new Map<Tone, number>();
    for (const m of local) {
      const t = toneOf(m.text, m.tags);
      tones.set(t, (tones.get(t) ?? 0) + 1);
    }
    return {
      total: local.length,
      hits: hits.length,
      tones: [...tones.entries()].sort((a, b) => b[1] - a[1]),
      lastWrite: local[0]?.createdAt ?? null,
    };
  }, [local, hits]);

  return (
    <div className={"flex flex-col gap-4 " + (compact ? "p-3" : "p-5")} style={{ background: "var(--surface)", color: "var(--fg)" }}>
      {/* Header · query + sync controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-[220px]" style={{ background: "var(--bg)", border: "1px solid var(--surface-2)", borderRadius: 6, padding: "6px 10px" }}>
          <Icons.Search size={14} color="var(--muted)" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Recall · type to search semantically + lexically…"
            className="flex-1 outline-none"
            style={{ background: "transparent", color: "var(--fg)", fontSize: 12, fontFamily: "var(--font-mono, monospace)" }}
          />
          {loading && <Icons.Loader2 size={12} className="animate-spin" color="var(--accent)" />}
        </div>
        <button
          onClick={() => load(query)}
          className="btn-pixel"
          style={{ padding: "6px 10px", fontSize: 10 }}
          title="Refresh now"
        >
          <Icons.RefreshCw size={11} />
        </button>
        <button
          onClick={() => setAutoSync((v) => !v)}
          className="btn-pixel ghost"
          style={{ padding: "6px 10px", fontSize: 10, background: autoSync ? "rgba(34,197,94,0.12)" : undefined, color: autoSync ? "#86efac" : undefined }}
          title={autoSync ? "Auto-sync on (every 8s)" : "Auto-sync off"}
        >
          {autoSync ? "● LIVE" : "○ MANUAL"}
        </button>
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono" style={{ color: "var(--muted)" }}>
        <span style={{ padding: "3px 8px", background: "var(--bg)", border: "1px solid var(--surface-2)", borderRadius: 999 }}>
          <strong style={{ color: "var(--fg)" }}>{stats.total}</strong> local
        </span>
        <span style={{ padding: "3px 8px", background: "var(--bg)", border: "1px solid var(--surface-2)", borderRadius: 999 }}>
          <strong style={{ color: "var(--accent)" }}>{stats.hits}</strong> hits
        </span>
        {stats.lastWrite && (
          <span style={{ padding: "3px 8px", background: "var(--bg)", border: "1px solid var(--surface-2)", borderRadius: 999 }}>
            last write {relativeTime(stats.lastWrite)}
          </span>
        )}
        {lastSync && (
          <span style={{ padding: "3px 8px", background: "var(--bg)", border: "1px solid var(--surface-2)", borderRadius: 999 }}>
            synced {relativeTime(lastSync)}
          </span>
        )}
        {tenant && (
          <span style={{ padding: "3px 8px", background: "var(--bg)", border: "1px solid var(--surface-2)", borderRadius: 999, color: "var(--accent)" }}>
            tenant {tenant.slice(0, 16)}
          </span>
        )}
      </div>

      {/* Tone filter chips */}
      <div className="flex flex-wrap gap-1.5">
        <ToneChip label="All" active={toneFilter === "all"} onClick={() => setToneFilter("all")} count={local.length} />
        {(Object.keys(TONE_LABEL) as Tone[]).map((t) => {
          const count = local.filter((m) => toneOf(m.text, m.tags) === t).length;
          if (count === 0 && toneFilter !== t) return null;
          return (
            <ToneChip
              key={t}
              label={TONE_LABEL[t]}
              active={toneFilter === t}
              onClick={() => setToneFilter(toneFilter === t ? "all" : t)}
              count={count}
              tone={t}
            />
          );
        })}
      </div>

      {error && (
        <div className="text-xs font-mono px-3 py-2" style={{ border: "1px solid var(--danger)", background: "rgba(239,68,68,0.08)", color: "var(--danger)", borderRadius: 4 }}>
          {error}
        </div>
      )}

      {/* Recall hits (HydraDB) */}
      {hits.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-pixel text-[11px] tracking-widest flex items-center gap-2" style={{ color: "var(--accent)" }}>
            <Icons.Sparkles size={12} /> RECALL HITS
            <span className="font-mono text-[10px]" style={{ color: "var(--muted)" }}>· semantic match for "{query || "recent"}"</span>
          </h3>
          <div className="space-y-1.5">
            {hits.slice(0, 8).map((h, i) => (
              <MemoryRow
                key={`hit-${i}`}
                text={h.text}
                tone="learning"
                score={h.score}
                actions={[
                  { icon: "Pin", title: "Pin as user fact", onClick: () => pinHit(h.text), busy: busy === h.text },
                  { icon: "Copy", title: "Copy", onClick: () => copy(h.text) },
                ]}
              />
            ))}
          </div>
        </section>
      )}

      {/* Local memories */}
      <section className="space-y-2">
        <h3 className="font-pixel text-[11px] tracking-widest flex items-center gap-2" style={{ color: "var(--accent)" }}>
          <Icons.Database size={12} /> ALL MEMORIES
          <span className="font-mono text-[10px]" style={{ color: "var(--muted)" }}>· {localFiltered.length} {toneFilter === "all" ? "total" : TONE_LABEL[toneFilter].toLowerCase()}</span>
        </h3>
        {loading && local.length === 0 ? (
          <div className="space-y-1.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="animate-pulse" style={{ height: 48, background: "var(--bg)", border: "1px solid var(--surface-2)", borderRadius: 4 }} />
            ))}
          </div>
        ) : localFiltered.length === 0 ? (
          <EmptyState tenant={tenant} onSeeded={() => load(query)} />
        ) : (
          <div className="space-y-1.5">
            {localFiltered.slice(0, 40).map((m) => (
              <MemoryRow
                key={m.id}
                text={m.text}
                tone={toneOf(m.text, m.tags)}
                tags={m.tags}
                createdAt={m.createdAt}
                actions={[
                  { icon: "Copy", title: "Copy", onClick: () => copy(m.text) },
                  { icon: "Trash2", title: "Delete", onClick: () => deleteOne(m.id), busy: busy === m.id, danger: true },
                ]}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ToneChip({ label, active, onClick, count, tone }: { label: string; active: boolean; onClick: () => void; count: number; tone?: Tone }) {
  const color = tone ? TONE_COLOR[tone] : { bg: "rgba(255,211,0,0.12)", fg: "var(--accent)", border: "var(--accent)" };
  return (
    <button
      onClick={onClick}
      className="font-pixel text-[10px] tracking-wider transition-colors"
      style={{
        padding: "4px 9px",
        background: active ? color.bg : "var(--bg)",
        border: `1px solid ${active ? color.border : "var(--surface-2)"}`,
        color: active ? color.fg : "var(--muted)",
        borderRadius: 4,
        cursor: "pointer",
      }}
    >
      {label.toUpperCase()} <span style={{ opacity: 0.7 }}>{count}</span>
    </button>
  );
}

type RowAction = { icon: keyof typeof Icons; title: string; onClick: () => void; busy?: boolean; danger?: boolean };

function MemoryRow({
  text,
  tone,
  tags,
  createdAt,
  score,
  actions = [],
}: {
  text: string;
  tone: Tone;
  tags?: string[];
  createdAt?: number;
  score?: number;
  actions?: RowAction[];
}) {
  const color = TONE_COLOR[tone];
  const label = TONE_LABEL[tone];
  const rendered = renderText(text);
  return (
    <div
      className="group flex items-start gap-3 transition-colors"
      style={{
        padding: "10px 12px",
        background: "var(--bg)",
        border: `1px solid var(--surface-2)`,
        borderLeft: `3px solid ${color.border}`,
        borderRadius: 4,
      }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span
            className="font-pixel text-[9px] tracking-wider"
            style={{ padding: "2px 7px", background: color.bg, color: color.fg, borderRadius: 999 }}
          >
            {label}
          </span>
          {score !== undefined && (
            <span className="font-mono text-[9px]" style={{ color: "var(--muted)" }}>
              score {score.toFixed(2)}
            </span>
          )}
          {createdAt && (
            <span className="font-mono text-[9px]" style={{ color: "var(--muted)" }}>
              {relativeTime(createdAt)}
            </span>
          )}
          {tags && tags.length > 0 && tags.slice(0, 3).map((t) => (
            <span key={t} className="font-mono text-[9px]" style={{ color: "var(--muted)", padding: "1px 5px", background: "var(--surface-2)", borderRadius: 2 }}>
              {t}
            </span>
          ))}
        </div>
        <p className="text-[11px] leading-relaxed" style={{ color: "var(--fg)", fontFamily: "var(--font-mono, monospace)" }}>
          {rendered}
        </p>
      </div>
      <div className="flex gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
        {actions.map((a, i) => {
          const Icon = Icons[a.icon] as React.ComponentType<{ size?: number; color?: string }>;
          return (
            <button
              key={i}
              onClick={a.onClick}
              disabled={a.busy}
              title={a.title}
              className="rounded transition-colors"
              style={{
                padding: 5,
                background: "transparent",
                border: "none",
                cursor: a.busy ? "wait" : "pointer",
                color: a.danger ? "var(--danger)" : "var(--muted)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {a.busy ? <Icons.Loader2 size={12} className="animate-spin" /> : <Icon size={12} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EmptyState({ tenant, onSeeded }: { tenant: string | null; onSeeded: () => void }) {
  const [seeding, setSeeding] = useState(false);
  return (
    <div
      className="flex flex-col items-center justify-center text-center gap-3"
      style={{ padding: "24px 16px", background: "var(--bg)", border: "1px dashed var(--surface-2)", borderRadius: 6 }}
    >
      <Icons.Brain size={32} color="var(--muted)" />
      <div>
        <div className="font-pixel text-xs tracking-wider" style={{ color: "var(--fg)" }}>NO MEMORIES YET</div>
        <p className="font-mono text-[10px] mt-1" style={{ color: "var(--muted)", maxWidth: 280 }}>
          Run a mission, build an app, or seed demo memories to populate the graph.
        </p>
      </div>
      <button
        onClick={async () => {
          setSeeding(true);
          try {
            const tid = tenant && /^(demo|qa|test|judge|hack)_/i.test(tenant) ? tenant : `demo_${Date.now()}`;
            const r = await fetch("/api/memory/seed", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tenantId: tid }),
            });
            if (r.ok) onSeeded();
          } finally {
            setSeeding(false);
          }
        }}
        disabled={seeding}
        className="btn-pixel"
        style={{ padding: "6px 12px", fontSize: 10 }}
      >
        {seeding ? "SEEDING…" : "★ SEED DEMO MEMORIES"}
      </button>
    </div>
  );
}

function relativeTime(ts: number): string {
  const d = Date.now() - ts;
  if (d < 0) return "just now";
  if (d < 60_000) return `${Math.floor(d / 1000)}s ago`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}
