"use client";
import { useEffect, useState } from "react";

// Antigravity-style live counters in DelOS top bar.
// Listens to delos-counters CustomEvent + polls /api/stats every 8s.

type Counters = {
  agents: number;
  requests: number;
  tokens: number;
  usd: number;
};

const STORE_KEY = "delos.counters.live.v1";

const ZERO: Counters = { agents: 0, requests: 0, tokens: 0, usd: 0 };

function loadFromStorage(): Counters {
  if (typeof window === "undefined") return ZERO;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw) as Counters;
  } catch {}
  return ZERO;
}

export function CounterStrip() {
  // Was `useState(loadInit)` — lazy init read localStorage on client and
  // returned 0s on server, so the SSR HTML didn't match the first client
  // paint → React error #418. Start with ZERO on both sides, hydrate in
  // an effect that only runs after mount.
  const [c, setC] = useState<Counters>(ZERO);

  useEffect(() => {
    setC(loadFromStorage());
    function onInc(e: Event) {
      const d = (e as CustomEvent).detail as Partial<Counters>;
      setC((prev) => {
        const next = {
          agents: prev.agents + (d.agents ?? 0),
          requests: prev.requests + (d.requests ?? 0),
          tokens: prev.tokens + (d.tokens ?? 0),
          usd: Math.round((prev.usd + (d.usd ?? 0)) * 1e6) / 1e6,
        };
        try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); } catch {}
        return next;
      });
    }
    window.addEventListener("delos-counters", onInc as EventListener);
    return () => window.removeEventListener("delos-counters", onInc as EventListener);
  }, []);

  // Periodic /api/stats fetch — seeds runs_today, doesn't dominate locals
  useEffect(() => {
    let alive = true;
    async function pull() {
      try {
        const r = await fetch("/api/stats");
        const j = (await r.json()) as { runs_today?: number };
        if (!alive || typeof j.runs_today !== "number") return;
        // Don't overwrite local — just nudge if zero
        setC((prev) => prev.agents === 0 && j.runs_today! > 0 ? { ...prev, agents: j.runs_today! } : prev);
      } catch {}
    }
    pull();
    // 60s — was 12s, which combined with LiveMetricsLine's 30s tick and
    // landing's revalidate=60 hit /api/stats far too often. One minute matches
    // the SSG cache TTL so we never refetch faster than the data updates.
    const t = setInterval(pull, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const num = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  const usd = c.usd < 0.01 ? `$${c.usd.toFixed(4)}` : `$${c.usd.toFixed(2)}`;
  // Budget cap reference — Varun's $1000 / 2.6B tokens
  const budget = 1.0; // $1 visual cap
  const pct = Math.min(100, (c.usd / budget) * 100);

  function reset() {
    const next = { agents: 0, requests: 0, tokens: 0, usd: 0 };
    setC(next);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); } catch {}
  }

  return (
    <div
      data-counter-strip
      className="hidden md:inline-flex items-center gap-2 font-mono text-[10px] pill pill-muted relative counter-strip"
      title="agents · requests · tokens · cost (this session) — double-click to reset"
      onDoubleClick={reset}
      style={{ fontSize: 10, cursor: "pointer" }}
    >
      <span data-counter-strip-ag key={`ag-${c.agents}`} className={c.agents > 0 ? "counter-pulse" : ""}>
        <span style={{ color: "var(--accent)" }}>{num(c.agents)}</span> ag
      </span>
      <span style={{ color: "var(--muted)" }}>·</span>
      <span data-counter-strip-req key={`req-${c.requests}`} className={c.requests > 0 ? "counter-pulse" : ""}>
        <span style={{ color: "var(--accent)" }}>{num(c.requests)}</span> req
      </span>
      <span style={{ color: "var(--muted)" }}>·</span>
      <span data-counter-strip-tok key={`tok-${c.tokens}`} className={c.tokens > 0 ? "counter-pulse" : ""}>
        <span style={{ color: "var(--accent)" }}>{num(c.tokens)}</span> tok
      </span>
      <span style={{ color: "var(--muted)" }}>·</span>
      <span data-cost-meter data-counter-strip-cost key={`cost-${c.usd}`} className={c.usd > 0 ? "counter-pulse" : ""} style={{ color: pct > 80 ? "var(--warn)" : "var(--success)" }}>
        {usd}
      </span>
      <progress
        data-counter-strip-budget
        value={c.usd}
        max={budget}
        className="absolute bottom-0 left-0 right-0 w-full h-px"
        style={{ accentColor: pct > 80 ? "var(--warn)" : "var(--success)" }}
      />
    </div>
  );
}

// Helper for components to bump counters
export function bumpCounters(d: Partial<Counters>) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("delos-counters", { detail: d }));
}
