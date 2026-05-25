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
  // Skeleton flag · brand QA P0-08 demands "no-zero first paint". Until
  // we have either (a) a non-zero localStorage snapshot or (b) the first
  // /api/stats response, render dotted placeholders (`· · · AG`) so the
  // first thing judges see is never four sad zeros.
  const [seeded, setSeeded] = useState<boolean>(false);

  useEffect(() => {
    const initial = loadFromStorage();
    setC(initial);
    if (initial.agents > 0 || initial.requests > 0 || initial.tokens > 0 || initial.usd > 0) {
      setSeeded(true);
    }
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
      setSeeded(true);
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
        if (!alive) return;
        // First response always flips skeleton off even if the number is
        // zero — at that point we know the API succeeded, so the dots
        // would mislead more than the real value.
        setSeeded(true);
        if (typeof j.runs_today !== "number") return;
        // Don't overwrite local — just nudge if zero
        setC((prev) => prev.agents === 0 && j.runs_today! > 0 ? { ...prev, agents: j.runs_today! } : prev);
      } catch {
        // Even on failure we drop the skeleton after the first attempt so
        // the strip doesn't dot forever if /api/stats is wedged.
        if (alive) setSeeded(true);
      }
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

  // Brand QA P0-08 · render dotted skeleton on the very first paint so
  // judges never see four sad zeros. Real numbers fade in as soon as
  // events tick or /api/stats answers (success or failure).
  const skeletonDots = "· · ·";
  const dim = seeded ? "var(--accent)" : "var(--muted)";
  const display = {
    agents: seeded ? num(c.agents) : skeletonDots,
    requests: seeded ? num(c.requests) : skeletonDots,
    tokens: seeded ? num(c.tokens) : skeletonDots,
    usd: seeded ? usd : skeletonDots,
  };

  return (
    <div
      data-counter-strip
      data-seeded={seeded ? "1" : "0"}
      className="hidden md:inline-flex items-center gap-2 font-mono text-[10px] pill pill-muted relative counter-strip"
      title={seeded ? "agents · requests · tokens · cost (this session) — double-click to reset" : "waiting for first stats response…"}
      onDoubleClick={reset}
      style={{ fontSize: 10, cursor: "pointer", opacity: seeded ? 1 : 0.78 }}
    >
      <span data-counter-strip-ag key={`ag-${c.agents}-${seeded}`} className={seeded && c.agents > 0 ? "counter-pulse" : ""}>
        <span style={{ color: dim }}>{display.agents}</span> ag
      </span>
      <span style={{ color: "var(--muted)" }}>·</span>
      <span data-counter-strip-req key={`req-${c.requests}-${seeded}`} className={seeded && c.requests > 0 ? "counter-pulse" : ""}>
        <span style={{ color: dim }}>{display.requests}</span> req
      </span>
      <span style={{ color: "var(--muted)" }}>·</span>
      <span data-counter-strip-tok key={`tok-${c.tokens}-${seeded}`} className={seeded && c.tokens > 0 ? "counter-pulse" : ""}>
        <span style={{ color: dim }}>{display.tokens}</span> tok
      </span>
      <span style={{ color: "var(--muted)" }}>·</span>
      <span data-cost-meter data-counter-strip-cost key={`cost-${c.usd}-${seeded}`} className={seeded && c.usd > 0 ? "counter-pulse" : ""} style={{ color: !seeded ? "var(--muted)" : (pct > 80 ? "var(--warn)" : "var(--success)") }}>
        {display.usd}
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
