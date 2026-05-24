"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import * as Icons from "lucide-react";
import { Wordmark } from "@/components/Logo";
import { useTenantId } from "@/lib/useTenant";

type MemHit = { text: string; score: number };
type LocalMem = { id: string; text: string; tags: string[]; createdAt: number };

type SortKey = "newest" | "oldest" | "longest" | "shortest" | "score";
type TagFilter = "all" | "app-build" | "run-summary";

export default function MemoryPage() {
  const [tenant] = useTenantId();
  const [query, setQuery] = useState("research run agent memory");
  const [hits, setHits] = useState<MemHit[]>([]);
  const [local, setLocal] = useState<LocalMem[]>([]);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<SortKey>("newest");
  const [tagFilter, setTagFilter] = useState<TagFilter>("all");
  const [textFilter, setTextFilter] = useState("");

  async function load(q: string) {
    setLoading(true);
    try {
      const url = `/api/memory?q=${encodeURIComponent(q)}${tenant ? `&tenantId=${encodeURIComponent(tenant)}` : ""}&topK=24`;
      const r = await fetch(url);
      const j = (await r.json()) as { hits: MemHit[]; local: LocalMem[] };
      setHits(j.hits);
      setLocal(j.local);
    } finally {
      setLoading(false);
    }
  }

  const allText = useMemo(() => [...hits.map((h) => h.text), ...local.map((l) => l.text)].join(" "), [hits, local]);
  const entities = useMemo(() => extractEntities(allText), [allText]);
  const cooccurrence = useMemo(() => extractCooccurrence(hits, local), [hits, local]);

  useEffect(() => {
    load(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredHits = useMemo(() => {
    const t = textFilter.trim().toLowerCase();
    let arr = hits.filter((h) => !t || h.text.toLowerCase().includes(t));
    if (sort === "longest") arr = [...arr].sort((a, b) => b.text.length - a.text.length);
    else if (sort === "shortest") arr = [...arr].sort((a, b) => a.text.length - b.text.length);
    else if (sort === "score") arr = [...arr].sort((a, b) => b.score - a.score);
    return arr;
  }, [hits, textFilter, sort]);

  const filteredLocal = useMemo(() => {
    const t = textFilter.trim().toLowerCase();
    let arr = local.filter((l) => !t || l.text.toLowerCase().includes(t));
    if (tagFilter !== "all") arr = arr.filter((l) => l.tags.includes(tagFilter));
    if (sort === "oldest") arr = [...arr].sort((a, b) => a.createdAt - b.createdAt);
    else if (sort === "longest") arr = [...arr].sort((a, b) => b.text.length - a.text.length);
    else if (sort === "shortest") arr = [...arr].sort((a, b) => a.text.length - b.text.length);
    else arr = [...arr].sort((a, b) => b.createdAt - a.createdAt);
    return arr;
  }, [local, textFilter, sort, tagFilter]);

  function copy(s: string) {
    navigator.clipboard?.writeText(s).catch(() => {});
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 glass-header">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link href="/"><Wordmark size={26} /></Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link href="/os" className="btn-pixel success">★ DelOS</Link>
            <Link href="/" className="btn-pixel ghost hidden sm:inline-flex">Home</Link>
            <Link href="/play" className="btn-pixel ghost hidden sm:inline-flex">Play</Link>
            <Link href="/docs" className="btn-pixel ghost hidden md:inline-flex">Docs</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div>
          <span className="pill pill-muted" style={{ fontSize: 10 }}>★ SAVE STATE</span>
          <h1 className="font-pixel text-3xl sm:text-4xl mt-3 mb-2 tracking-wider">memory <span style={{ color: "var(--accent)" }}>browser</span>.</h1>
          <p className="text-[color:var(--muted)] text-sm">Long-term memory in HydraDB. What the agents remember across runs.</p>
          {tenant && <p className="text-xs font-mono text-[color:var(--muted)] mt-1">tenant: <span style={{ color: "var(--accent)" }}>{tenant}</span></p>}
        </div>

        <div className="flex gap-2 flex-wrap">
          <input
            className="input-pixel flex-1 min-w-[200px]"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load(query)}
            placeholder="recall query (semantic + lexical)…"
          />
          <button onClick={() => load(query)} disabled={loading} className="btn-pixel">
            {loading ? "…" : "RECALL"}
          </button>
          <button onClick={() => load("")} className="btn-pixel ghost" title="Show everything">
            ★ SHOW ALL
          </button>
          <a
            href={`/api/memory/export${tenant ? `?tenantId=${encodeURIComponent(tenant)}` : ""}`}
            download
            className="btn-pixel ghost"
            title="Download tenant memory as JSON"
          >
            ↓ EXPORT
          </a>
          <label className="btn-pixel ghost cursor-pointer" title="Import JSON memories">
            ↑ IMPORT
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const txt = await f.text();
                  const data = JSON.parse(txt);
                  const r = await fetch("/api/memory/import", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ...data, tenantId: tenant || undefined }),
                  });
                  const j = await r.json();
                  alert(j.ok ? `Imported ${j.imported}/${j.total} memories` : `Import failed: ${j.error}`);
                  if (j.ok) load(query);
                } catch (err) {
                  alert("Import failed: " + (err as Error).message);
                }
              }}
            />
          </label>
        </div>

        <div className="card-pixel flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="font-pixel text-[11px] tracking-wider text-[color:var(--muted)]">FILTER</span>
            <input
              className="input-pixel"
              style={{ width: 180, padding: "4px 8px" }}
              placeholder="text contains…"
              value={textFilter}
              onChange={(e) => setTextFilter(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="font-pixel text-[11px] tracking-wider text-[color:var(--muted)]">SORT</span>
            <select className="input-pixel" style={{ width: 140, padding: "4px 8px" }} value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="newest">newest</option>
              <option value="oldest">oldest</option>
              <option value="longest">longest</option>
              <option value="shortest">shortest</option>
              <option value="score">score</option>
            </select>
          </div>
          <div className="flex items-center gap-1">
            <span className="font-pixel text-[11px] tracking-wider text-[color:var(--muted)]">TAGS</span>
            {(["all", "run-summary", "app-build"] as TagFilter[]).map((t) => (
              <button key={t} onClick={() => setTagFilter(t)} className={`pill ${tagFilter === t ? "pill-info" : "pill-muted"} cursor-pointer`}>{t}</button>
            ))}
          </div>
        </div>

        <EntityGraph entities={entities} edges={cooccurrence} />

        <div className="grid lg:grid-cols-2 gap-4">
          <section>
            <h2 className="font-pixel text-lg tracking-wider mb-2 flex items-center gap-2">
              <span className="coin" /> HYDRADB HITS
              <span className="pill pill-muted">{filteredHits.length}</span>
            </h2>
            <div className="space-y-2">
              {filteredHits.length === 0 && (
                <div className="card-pixel space-y-2">
                  <p className="text-[color:var(--muted)] text-sm">
                    No HydraDB hits yet. Seed 12 demo memories or run a mission to populate.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="btn-pixel"
                      style={{ fontSize: 11, padding: "6px 12px" }}
                      onClick={async () => {
                        try {
                          const r = await fetch("/api/memory/seed", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ tenantId: tenant }),
                          });
                          if (r.ok) await load(query);
                        } catch {}
                      }}
                    >
                      ★ SEED DEMO MEMORIES
                    </button>
                    <Link href="/play" className="btn-pixel ghost" style={{ fontSize: 11, padding: "6px 12px" }}>
                      ▶ RUN CHAOS DEMO
                    </Link>
                  </div>
                </div>
              )}
              {filteredHits.map((h, i) => (
                <div key={i} className="card-pixel">
                  <div className="flex items-center justify-between mb-1">
                    <span className="pill pill-info">#{i + 1}</span>
                    <div className="flex gap-1">
                      <span className="pill pill-muted">score {h.score.toFixed(2)}</span>
                      <button onClick={() => copy(h.text)} className="pill pill-muted cursor-pointer" title="Copy"><Icons.Copy size={10} /></button>
                    </div>
                  </div>
                  <p className="text-sm leading-relaxed">{h.text}</p>
                </div>
              ))}
            </div>
          </section>
          <section>
            <h2 className="font-pixel text-lg tracking-wider mb-2 flex items-center gap-2">
              <span className="coin" /> LOCAL FALLBACK
              <span className="pill pill-muted">{filteredLocal.length}</span>
            </h2>
            <div className="space-y-2">
              {filteredLocal.length === 0 && (
                <div className="card-pixel text-[color:var(--muted)] text-sm">
                  No matches.
                </div>
              )}
              {filteredLocal.map((m) => (
                <div key={m.id} className="card-pixel">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1">
                      <span className="pill pill-warn">FALLBACK</span>
                      {m.tags.map((t) => (
                        <span key={t} className="pill pill-muted" style={{ fontSize: 9 }}>{t}</span>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[color:var(--muted)] font-mono">
                        {new Date(m.createdAt).toLocaleTimeString()}
                      </span>
                      <button onClick={() => copy(m.text)} className="pill pill-muted cursor-pointer" title="Copy"><Icons.Copy size={10} /></button>
                    </div>
                  </div>
                  <p className="text-sm leading-relaxed">{m.text}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

const STOPWORDS = new Set([
  "Run", "Final", "Tools", "Used", "HydraDB", "Be", "Brief", "Mission", "DelOS", "App", "Action",
  "The", "And", "Of", "For", "From", "In", "On", "With", "By", "To", "An", "Is",
]);

function extractEntities(text: string): Array<{ name: string; count: number }> {
  const re = /\b([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+){0,2})\b/g;
  const counts = new Map<string, number>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = m[1];
    if (STOPWORDS.has(n.split(" ")[0])) continue;
    if (n.length < 3) continue;
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([name, count]) => ({ name, count }));
}

function extractCooccurrence(hits: MemHit[], local: LocalMem[]): Array<[string, string]> {
  const docs = [...hits.map((h) => h.text), ...local.map((l) => l.text)];
  const pairs = new Set<string>();
  for (const d of docs) {
    const found = (d.match(/\b([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+){0,2})\b/g) ?? [])
      .filter((s) => !STOPWORDS.has(s.split(" ")[0]) && s.length >= 3);
    const uniq = [...new Set(found)];
    for (let i = 0; i < uniq.length; i++) {
      for (let j = i + 1; j < uniq.length; j++) {
        pairs.add(`${uniq[i]}→${uniq[j]}`);
      }
    }
  }
  return [...pairs].slice(0, 24).map((s) => s.split("→") as [string, string]);
}

function EntityGraph({ entities, edges }: { entities: Array<{ name: string; count: number }>; edges: Array<[string, string]> }) {
  if (entities.length === 0) return null;
  const w = 760;
  const h = 220;
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(cx, cy) - 30;
  const pos = new Map<string, { x: number; y: number }>();
  entities.forEach((e, i) => {
    const a = (i / entities.length) * Math.PI * 2;
    pos.set(e.name, { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  });
  const maxCount = Math.max(...entities.map((e) => e.count));
  return (
    <div className="card-pixel">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-pixel text-lg tracking-wider" style={{ color: "var(--accent)" }}>★ ENTITY GRAPH</h2>
        <span className="pill pill-muted">{entities.length} entities · {edges.length} relations</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} shapeRendering="geometricPrecision" aria-hidden>
        {edges.map(([a, b], i) => {
          const pa = pos.get(a);
          const pb = pos.get(b);
          if (!pa || !pb) return null;
          return <line key={i} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="var(--surface-2)" strokeWidth={1} opacity={0.7} />;
        })}
        {entities.map((e) => {
          const p = pos.get(e.name)!;
          const radius = 6 + (e.count / maxCount) * 8;
          return (
            <g key={e.name}>
              <circle cx={p.x} cy={p.y} r={radius} fill="var(--accent)" opacity={0.35 + (e.count / maxCount) * 0.5} />
              <text x={p.x} y={p.y - radius - 4} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="10" fill="var(--fg)">{e.name}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
