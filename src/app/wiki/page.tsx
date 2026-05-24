"use client";
import { useState } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/Logo";
import { EmptyState } from "@/components/ui/EmptyState";

export default function WikiPage() {
  const [topic, setTopic] = useState("Multi-agent orchestration");
  const [depth, setDepth] = useState<"brief" | "standard" | "deep">("standard");
  const [article, setArticle] = useState<string | null>(null);
  const [grounded, setGrounded] = useState<boolean | null>(null);
  const [words, setWords] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (!topic.trim()) return;
    setBusy(true);
    setError(null);
    setArticle(null);
    try {
      const r = await fetch("/api/wiki/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.trim(), depth }),
      });
      const j = await r.json();
      if (j.ok) {
        setArticle(j.article);
        setGrounded(j.grounded);
        setWords(j.words);
      } else {
        setError(j.error ?? "Unknown error");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function downloadMarkdown() {
    if (!article) return;
    const blob = new Blob([article], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${topic.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 glass-header">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link href="/"><Wordmark size={26} /></Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link href="/os" className="btn-pixel success">★ DelOS</Link>
            <Link href="/pitch" className="btn-pixel ghost hidden sm:inline-flex">Pitch</Link>
            <Link href="/ask" className="btn-pixel ghost hidden sm:inline-flex">Ask</Link>
            <Link href="/memory" className="btn-pixel ghost hidden md:inline-flex">Memory</Link>
          </nav>
        </div>
      </header>

      <main role="main" aria-label="DelOS Wiki" className="max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-6">
        <section>
          <span className="pill pill-muted" style={{ fontSize: 10 }}>★ WIKI · GROUNDED ARTICLES</span>
          <h1 className="font-pixel text-3xl sm:text-5xl mt-3 mb-2 tracking-wider">
            delos <span style={{ color: "var(--accent)" }}>wiki</span>.
          </h1>
          <p className="text-[color:var(--muted)] text-sm sm:text-base max-w-2xl">
            Generate encyclopedic articles grounded in real sources. Wikipedia anchor for known topics, [unverified] tags for speculative claims. Every article persists to HydraDB so the agent recalls it next session.
          </p>
        </section>

        <section className="card-pixel space-y-3">
          <div className="flex flex-wrap gap-2">
            <input
              className="input-pixel flex-1 min-w-[240px]"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && generate()}
              placeholder="Topic — e.g. Multi-agent orchestration"
              disabled={busy}
            />
            <select
              value={depth}
              onChange={(e) => setDepth(e.target.value as typeof depth)}
              className="font-mono text-xs"
              style={{
                background: "var(--surface)",
                color: "var(--fg)",
                border: "1px solid var(--surface-2)",
                padding: "4px 8px",
              }}
              disabled={busy}
            >
              <option value="brief">brief · ~250 words</option>
              <option value="standard">standard · ~600 words</option>
              <option value="deep">deep · ~1200 words</option>
            </select>
            <button
              onClick={generate}
              disabled={busy || !topic.trim()}
              className="btn-pixel success"
              style={{ padding: "6px 14px", fontSize: 12 }}
            >
              {busy ? "GENERATING…" : "▶ GENERATE"}
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {["Antigravity 2.0", "HydraDB graph memory", "RAG vs fine-tuning", "Multi-agent orchestration", "Pixel art aesthetic", "Cockatiel circuit breaker"].map((t) => (
              <button
                key={t}
                onClick={() => !busy && setTopic(t)}
                disabled={busy}
                className="pill pill-muted"
                style={{ cursor: busy ? "not-allowed" : "pointer", fontSize: 9 }}
              >
                {t}
              </button>
            ))}
          </div>
        </section>

        {error && (
          <div className="card-pixel" style={{ borderColor: "var(--danger)" }}>
            <span className="pill pill-bad">error</span>
            <span style={{ color: "var(--danger)", marginLeft: 8 }}>{error}</span>
          </div>
        )}

        {!article && !busy && !error && (
          <EmptyState
            icon="📖"
            title="No article yet"
            body="Pick a topic and hit GENERATE. Wikipedia-grounded when possible, [unverified] tags otherwise. Articles persist to HydraDB and recall on future runs."
            action={{ label: "▶ TRY 'Multi-agent orchestration'", onClick: () => { setTopic("Multi-agent orchestration"); setTimeout(generate, 100); } }}
          />
        )}

        {busy && (
          <div className="card-pixel text-center py-6 font-mono text-sm" style={{ color: "var(--muted)" }}>
            <div className="font-pixel text-base tracking-widest mb-2" style={{ color: "var(--accent)" }}>
              ★ GENERATING
            </div>
            <p>Anchoring on Wikipedia · structuring sections · drafting paragraphs · persisting to HydraDB…</p>
          </div>
        )}

        {article && (
          <article className="card-pixel" style={{ background: "var(--surface)", padding: 24 }}>
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="flex gap-2">
                <span className="pill pill-info" style={{ fontSize: 9 }}>{words} words</span>
                <span className="pill pill-info" style={{ fontSize: 9 }}>{depth}</span>
                <span className={`pill ${grounded ? "pill-ok" : "pill-warn"}`} style={{ fontSize: 9 }}>
                  {grounded ? "✓ Wikipedia-grounded" : "⚠ unverified"}
                </span>
              </div>
              <div className="flex gap-1">
                <button onClick={downloadMarkdown} className="pill pill-muted" style={{ cursor: "pointer", fontSize: 10 }}>
                  ↓ MARKDOWN
                </button>
                <button
                  onClick={() => {
                    if (!navigator.clipboard?.writeText) {
                      window.prompt("Copy article:", article);
                      return;
                    }
                    navigator.clipboard.writeText(article).then(() => alert("Article copied"));
                  }}
                  className="pill pill-muted"
                  style={{ cursor: "pointer", fontSize: 10 }}
                >
                  📋 COPY
                </button>
              </div>
            </div>
            <pre
              className="font-mono text-[12px] leading-relaxed whitespace-pre-wrap"
              style={{ color: "var(--fg)", background: "transparent", padding: 0, border: "none" }}
            >
              {article}
            </pre>
          </article>
        )}
      </main>
    </div>
  );
}
