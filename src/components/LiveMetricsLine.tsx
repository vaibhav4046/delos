"use client";
import { useEffect, useState } from "react";

export function LiveMetricsLine() {
  const [line, setLine] = useState<string>("v2.0 · grounded traces with recovery logs");
  useEffect(() => {
    let alive = true;
    async function pull() {
      try {
        const r = await fetch("/api/stats", { cache: "no-store" });
        const j = (await r.json()) as { metrics_line?: string; features?: number; endpoints?: number; tools?: { total?: number } };
        if (!alive || !j.metrics_line) return;
        const v = `v2.0 · ${j.features ?? 51} features · ${j.endpoints ?? 19} endpoints · ${j.tools?.total ?? 17} tools · ${j.metrics_line}`;
        setLine(v);
      } catch {}
    }
    pull();
    // 60s — coalesce with CounterStrip + landing revalidate=60.
    const t = setInterval(pull, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return <span>{line}</span>;
}
