"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/Logo";

type Row = {
  runId: string;
  tenantHash: string;
  startedAt: number;
  appsBuilt: number;
  subAgents: number;
  tokens: number;
  costUsd: number;
  wallTimeMs: number;
};

type SortKey = "cost-asc" | "cost-desc" | "apps-desc" | "tokens-asc" | "recent";

export default function LeaderboardPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [sort, setSort] = useState<SortKey>("cost-asc");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/leaderboard")
      .then((r) => r.json())
      .then((j: { ok: boolean; rows: Row[] }) => {
        if (j.ok) setRows(j.rows);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const sorted = [...rows].sort((a, b) => {
    if (sort === "cost-asc") return a.costUsd - b.costUsd;
    if (sort === "cost-desc") return b.costUsd - a.costUsd;
    if (sort === "apps-desc") return b.appsBuilt - a.appsBuilt;
    if (sort === "tokens-asc") return a.tokens - b.tokens;
    return b.startedAt - a.startedAt;
  });

  function fmtTokens(n: number) {
    return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  }

  function fmtCost(n: number) {
    return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`;
  }

  function fmtMs(ms: number) {
    if (ms === 0) return "—";
    return ms >= 60_000 ? `${(ms / 60_000).toFixed(1)}m` : `${(ms / 1000).toFixed(1)}s`;
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 glass-header">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link href="/"><Wordmark size={26} /></Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link href="/os" className="btn-pixel success">★ DelOS</Link>
            <Link href="/arena" className="btn-pixel ghost hidden sm:inline-flex">Arena</Link>
            <Link href="/live" className="btn-pixel ghost hidden sm:inline-flex">Live</Link>
            <Link href="/scorecard" className="btn-pixel ghost hidden md:inline-flex">Score</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 space-y-6">
        <section>
          <span className="pill pill-muted" style={{ fontSize: 10 }}>★ OS-BUILDER LEADERBOARD</span>
          <h1 className="font-pixel text-3xl sm:text-5xl mt-3 mb-2 tracking-wider">
            cheapest <span style={{ color: "var(--accent)" }}>OS builds</span>.
          </h1>
          <p className="text-[color:var(--muted)] text-sm sm:text-base max-w-2xl">
            Every os-builder mission anonymized. Apps built · sub-agents · tokens · USD · wall time. Antigravity-style cost-per-app race.
          </p>
        </section>

        <section className="flex flex-wrap gap-2">
          {([
            ["cost-asc", "cheapest first"],
            ["cost-desc", "spendiest first"],
            ["apps-desc", "most apps"],
            ["tokens-asc", "fewest tokens"],
            ["recent", "most recent"],
          ] as Array<[SortKey, string]>).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setSort(k)}
              className="pill"
              style={{
                fontSize: 10,
                cursor: "pointer",
                background: sort === k ? "var(--accent)" : "var(--surface)",
                color: sort === k ? "var(--on-accent)" : "var(--fg)",
                border: "1px solid var(--surface-2)",
              }}
            >
              {label}
            </button>
          ))}
          <Link href="/os" className="pill pill-success" style={{ fontSize: 10, marginLeft: "auto", cursor: "pointer", textDecoration: "none" }}>
            ▶ RUN OS-BUILDER →
          </Link>
        </section>

        <section className="card-pixel" style={{ padding: 0, overflow: "hidden" }}>
          {loading ? (
            <div className="p-6 text-center font-mono text-xs" style={{ color: "var(--muted)" }}>loading…</div>
          ) : (
            <table className="w-full font-mono text-[11px]">
              <thead style={{ background: "var(--surface-2)" }}>
                <tr>
                  <th className="text-left p-2">#</th>
                  <th className="text-left p-2">run</th>
                  <th className="text-left p-2 hidden sm:table-cell">tenant</th>
                  <th className="text-right p-2">apps</th>
                  <th className="text-right p-2 hidden sm:table-cell">sub-agents</th>
                  <th className="text-right p-2">tokens</th>
                  <th className="text-right p-2">cost</th>
                  <th className="text-right p-2 hidden md:table-cell">wall</th>
                  <th className="text-right p-2 hidden md:table-cell">when</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, i) => (
                  <tr key={r.runId} style={{ borderTop: "1px solid var(--surface-2)" }}>
                    <td className="p-2" style={{ color: i === 0 && sort === "cost-asc" ? "var(--success)" : "var(--muted)" }}>
                      {i === 0 && sort === "cost-asc" ? "★ 1" : i + 1}
                    </td>
                    <td className="p-2" style={{ color: "var(--fg)" }}>
                      <code style={{ fontSize: 10 }}>{r.runId}</code>
                    </td>
                    <td className="p-2 hidden sm:table-cell" style={{ color: "var(--muted)" }}>{r.tenantHash}</td>
                    <td className="p-2 text-right" style={{ color: "var(--accent)" }}>{r.appsBuilt}</td>
                    <td className="p-2 text-right hidden sm:table-cell" style={{ color: "var(--fg)" }}>{r.subAgents}</td>
                    <td className="p-2 text-right" style={{ color: "var(--fg)" }}>{fmtTokens(r.tokens)}</td>
                    <td className="p-2 text-right" style={{ color: "var(--success)" }}>{fmtCost(r.costUsd)}</td>
                    <td className="p-2 text-right hidden md:table-cell" style={{ color: "var(--muted)" }}>{fmtMs(r.wallTimeMs)}</td>
                    <td className="p-2 text-right hidden md:table-cell" style={{ color: "var(--muted)" }}>
                      {new Date(r.startedAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <p className="text-center text-[10px] font-mono" style={{ color: "var(--muted)" }}>
          Auto-refreshes every page load · tenants hashed for privacy · run yours from <Link href="/os" style={{ color: "var(--accent)" }}>/os</Link>
        </p>
      </main>
    </div>
  );
}
