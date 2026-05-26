"use client";
// WIN-2 · live provider cascade pill for the OS top bar. Polls /api/llm/audit
// once a minute (cheap · backend caches 15-min anyway), shows healthy/total
// model count. Color flips to warn when any provider is down · visible cue
// that the cascade is "Under Pressure" and recovering automatically.
//
// Direct response to Agentos's "Inject Gemini Outage" fault-injector. They
// gate a single toggle; we show the actual live cascade state in real time.

import { useEffect, useState } from "react";
import * as Icons from "lucide-react";

type Audit = {
  healthy?: string[];
  unhealthy?: Array<{ model: string; err?: string }>;
  results?: Array<{ model: string; ok: boolean }>;
};

export function ProviderHealthPill({ onOpen }: { onOpen?: () => void }) {
  const [data, setData] = useState<Audit | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    async function probe() {
      if (!alive) return;
      setLoading(true);
      try {
        const r = await fetch("/api/llm/audit", { cache: "no-store" });
        const j = (await r.json()) as Audit;
        if (alive) setData(j);
      } catch {
        /* swallow · the pill never blocks the OS */
      } finally {
        if (alive) setLoading(false);
      }
    }
    probe();
    const t = setInterval(probe, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const healthy = data?.healthy?.length ?? 0;
  const total = (data?.results?.length ?? 0) || healthy + (data?.unhealthy?.length ?? 0);
  const allHealthy = total > 0 && healthy === total;
  const fallbackActive = total > 0 && healthy < total;

  const pillClass = !data
    ? "pill pill-muted"
    : allHealthy
      ? "pill pill-ok"
      : "pill pill-warn";

  const label = !data
    ? "PROVIDERS"
    : allHealthy
      ? `${healthy} PROVIDERS HEALTHY`
      : `${healthy}/${total} HEALTHY · CASCADE`;

  const title = !data
    ? "Probing 6-provider LLM cascade · Groq + Mistral + Gemini + NIM + Cerebras + Bytez + OpenRouter"
    : allHealthy
      ? `${total} providers healthy · cascade ready to handle outages`
      : `${total - healthy} provider${total - healthy === 1 ? "" : "s"} unhealthy · cascade routing around. Click for Terminal to inspect.`;

  return (
    <button
      onClick={onOpen}
      className={`${pillClass} hidden md:inline-flex cursor-pointer items-center gap-1`}
      style={{ fontSize: 10, padding: "2px 8px" }}
      title={title}
      aria-label={label}
    >
      <span
        className="w-2 h-2 inline-block"
        style={{
          background: allHealthy
            ? "var(--success)"
            : fallbackActive
              ? "var(--warn)"
              : "var(--muted)",
        }}
      />
      {loading && !data ? (
        <Icons.Loader2 size={10} className="animate-spin" />
      ) : null}
      <span className="font-mono" style={{ letterSpacing: "0.04em" }}>{label}</span>
    </button>
  );
}
