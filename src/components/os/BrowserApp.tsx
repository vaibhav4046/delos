"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import * as Icons from "lucide-react";
import { onIntent } from "@/lib/intentBus";

type Bookmark = { id: string; title: string; url: string; category?: BookmarkCategory };
type BookmarkCategory = "delos" | "search" | "ai" | "finance" | "edu" | "tools" | "games" | "productivity";
type SearchHit = { title: string; url: string; snippet: string };

const DEFAULT_BOOKMARKS: Bookmark[] = [
  // DelOS core
  { id: "del", title: "DelOS", url: "/", category: "delos" },
  { id: "docs", title: "Docs", url: "/docs", category: "delos" },
  { id: "memory", title: "Memory", url: "/memory", category: "delos" },
  { id: "status", title: "Status", url: "/status", category: "delos" },
  // Search + reference
  { id: "duck", title: "DuckDuckGo", url: "https://duckduckgo.com", category: "search" },
  { id: "wiki", title: "Wikipedia", url: "https://wikipedia.org", category: "search" },
  { id: "hn", title: "Hacker News", url: "https://news.ycombinator.com", category: "search" },
  { id: "mdn", title: "MDN", url: "https://developer.mozilla.org", category: "search" },
  // AI / OSS frameworks
  { id: "pi", title: "Pi (earendil-works)", url: "https://github.com/earendil-works/pi", category: "ai" },
  { id: "understand-anything", title: "Understand Anything", url: "https://github.com/Lum1104/Understand-Anything", category: "ai" },
  { id: "codegraph", title: "CodeGraph", url: "https://github.com/colbymchenry/codegraph", category: "ai" },
  { id: "karpathy-skills", title: "Karpathy Skills", url: "https://github.com/multica-ai/andrej-karpathy-skills", category: "ai" },
  { id: "cyber-skills", title: "Anthropic Cybersec Skills", url: "https://github.com/mukul975/Anthropic-Cybersecurity-Skills", category: "ai" },
  { id: "multica", title: "Multica (multi-agent)", url: "https://github.com/multica-ai/multica", category: "ai" },
  { id: "longlive", title: "NVlabs LongLive", url: "https://github.com/NVlabs/LongLive", category: "ai" },
  // Finance / Productivity / Education
  { id: "fincept", title: "Fincept Terminal", url: "https://github.com/Fincept-Corporation/FinceptTerminal", category: "finance" },
  { id: "ai-eng", title: "AI Engineering from Scratch", url: "https://github.com/rohitg00/ai-engineering-from-scratch", category: "edu" },
  { id: "secret-knowledge", title: "Book of Secret Knowledge", url: "https://github.com/trimstray/the-book-of-secret-knowledge", category: "edu" },
  { id: "presenton", title: "Presenton (slides)", url: "https://github.com/presenton/presenton", category: "productivity" },
  { id: "odoo", title: "Odoo (ERP)", url: "https://github.com/odoo/odoo", category: "productivity" },
  // Tools
  { id: "hydra", title: "HydraDB", url: "https://hydradb.com", category: "tools" },
  { id: "groq", title: "Groq Console", url: "https://console.groq.com", category: "tools" },
];

const CATEGORY_LABELS: Record<BookmarkCategory, string> = {
  delos: "DELOS",
  search: "SEARCH",
  ai: "AI · AGENTS",
  finance: "FINANCE",
  edu: "EDUCATION",
  productivity: "PRODUCTIVITY",
  tools: "TOOLS",
  games: "GAMES",
};

const CATEGORY_ORDER: BookmarkCategory[] = [
  "delos",
  "ai",
  "search",
  "productivity",
  "finance",
  "edu",
  "tools",
  "games",
];

const STORE_KEY = "delos.browser.v1";

function normalize(u: string): string {
  const v = u.trim();
  if (!v) return "";
  if (v.startsWith("/")) return v;
  if (/^https?:\/\//i.test(v)) return v;
  if (v.includes(".") && !v.includes(" ")) return "https://" + v;
  // Render search internally via the "search:" pseudo-scheme. Avoids hitting
  // the iframe-blocked duckduckgo.com page and lets us show real results.
  return `search:${v}`;
}

function isSearchUrl(u: string): boolean {
  return u.startsWith("search:");
}
function extractSearchQuery(u: string): string {
  return u.startsWith("search:") ? u.slice("search:".length) : "";
}

// Known X-Frame-Options: DENY / SAMEORIGIN sites. Trying to iframe these
// silently renders blank — we proactively detect and surface the embed-block
// card instead of staring at an empty grey rectangle. Match by hostname suffix
// so subdomains count.
const KNOWN_EMBED_BLOCKERS = [
  "google.com",
  "duckduckgo.com",
  "youtube.com",
  "twitter.com",
  "x.com",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "github.com",
  "stackoverflow.com",
  "reddit.com",
  "amazon.com",
  "netflix.com",
  "spotify.com",
  "tiktok.com",
  "discord.com",
  "notion.so",
  "figma.com",
  "vercel.app", // self-frame OK, third-party vercel.app subdomains often deny
];

function isLikelyEmbedBlocked(url: string): boolean {
  try {
    const u = new URL(url, "https://delrio.vercel.app");
    // Same-origin frames always allowed.
    if (u.origin === "https://delrio.vercel.app") return false;
    if (!u.hostname) return false;
    return KNOWN_EMBED_BLOCKERS.some((b) => u.hostname === b || u.hostname.endsWith("." + b));
  } catch {
    return false;
  }
}

export function BrowserApp() {
  // Default to a built-in DelOS Search homepage so the first impression is
  // a real product, not "blocked iframe" or "doc viewer".
  const [url, setUrl] = useState("search:");
  const [input, setInput] = useState("");
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(DEFAULT_BOOKMARKS);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [iframeError, setIframeError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchAnswer, setSearchAnswer] = useState<string>("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const currentQuery = useMemo(() => extractSearchQuery(url), [url]);

  useEffect(() => {
    // Mount-only hydration from localStorage · keeps SSR/first paint on the
    // empty defaults to avoid a hydration mismatch.
    /* eslint-disable react-hooks/set-state-in-effect */
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const v = JSON.parse(raw) as { bookmarks?: Bookmark[]; history?: string[] };
        if (v.bookmarks?.length) setBookmarks(v.bookmarks);
        if (v.history?.length) setHistory(v.history);
      }
    } catch {}
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // Voice intent: { kind: "browser.search", query: "..." }
  useEffect(() => {
    return onIntent("browser.search" as never, ((i: { query: string }) => {
      if (i.query) navigate(i.query);
    }) as never);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ bookmarks, history })); } catch {}
  }, [bookmarks, history]);

  function navigate(target: string) {
    const u = normalize(target);
    if (!u) return;
    setUrl(u);
    setInput(u.startsWith("search:") ? u.slice("search:".length) : u);
    if (isSearchUrl(u)) {
      // Built-in search results view — no iframe, no X-Frame-Options drama.
      setIframeError(null);
      setLoading(false);
      void runSearch(extractSearchQuery(u));
    } else if (isLikelyEmbedBlocked(u)) {
      // Proactive check: if this is a known X-Frame-Options blocker, show the
      // embed-block card immediately instead of rendering a blank iframe.
      setIframeError(
        "This site blocks iframe embedding (X-Frame-Options). Open it in a new tab to use it.",
      );
      setLoading(false);
    } else {
      setIframeError(null);
      setLoading(true);
    }
    setHistory((prev) => {
      const trimmed = prev.slice(0, historyIdx + 1);
      const next = [...trimmed, u];
      setHistoryIdx(next.length - 1);
      return next.slice(-50);
    });
  }

  async function runSearch(q: string) {
    const query = q.trim();
    if (!query) {
      setSearchHits([]);
      setSearchAnswer("");
      setSearchError(null);
      return;
    }
    setSearchBusy(true);
    setSearchError(null);
    setSearchHits([]);
    setSearchAnswer("");
    try {
      // Use the existing web_search tool — DuckDuckGo Instant Answer, free, no key.
      const r = await fetch("/api/tool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "web_search", args: { query, topK: 8 } }),
      });
      const j = (await r.json()) as { ok: boolean; data?: { results?: SearchHit[]; abstract?: string }; error?: string };
      if (!j.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setSearchHits(j.data?.results ?? []);
      setSearchAnswer(j.data?.abstract ?? "");
    } catch (e) {
      setSearchError((e as Error).message);
    } finally {
      setSearchBusy(false);
    }
  }

  function back() {
    if (historyIdx <= 0) return;
    const i = historyIdx - 1;
    setHistoryIdx(i);
    setUrl(history[i]);
    setInput(history[i]);
    setIframeError(null);
    setLoading(true);
  }

  function forward() {
    if (historyIdx >= history.length - 1) return;
    const i = historyIdx + 1;
    setHistoryIdx(i);
    setUrl(history[i]);
    setInput(history[i]);
    setIframeError(null);
    setLoading(true);
  }

  function reload() {
    setIframeError(null);
    setLoading(true);
    if (iframeRef.current) {
      // Re-set src to force reload
      const u = iframeRef.current.src;
      iframeRef.current.src = "about:blank";
      setTimeout(() => {
        if (iframeRef.current) iframeRef.current.src = u;
      }, 30);
    }
  }

  function addBookmark() {
    if (!url) return;
    const title = (() => {
      try { return new URL(url, window.location.origin).hostname; } catch { return url.slice(0, 40); }
    })();
    const id = `bm-${Date.now()}`;
    setBookmarks((prev) => [...prev, { id, title, url }]);
  }

  function removeBookmark(id: string) {
    setBookmarks((prev) => prev.filter((b) => b.id !== id));
  }

  function openExternal() {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  // Many sites set X-Frame-Options: DENY. We can't reliably detect inside iframe,
  // but we use a 4-sec timeout heuristic: if iframe hasn't fired onload, show fallback.
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => {
      if (loading) setIframeError("Site may block embedding (X-Frame-Options). Use 'Open in tab'.");
    }, 4500);
    return () => clearTimeout(t);
  }, [loading, url]);

  return (
    <div className="p-3 h-full flex flex-col gap-2 text-xs">
      <div className="flex items-center gap-1">
        <button onClick={back} disabled={historyIdx <= 0} className="pill pill-muted cursor-pointer" title="Back">
          <Icons.ChevronLeft size={12} />
        </button>
        <button onClick={forward} disabled={historyIdx >= history.length - 1} className="pill pill-muted cursor-pointer" title="Forward">
          <Icons.ChevronRight size={12} />
        </button>
        <button onClick={reload} className="pill pill-muted cursor-pointer" title="Reload"><Icons.RotateCw size={12} /></button>
        <input
          className="input-pixel flex-1"
          style={{ padding: "4px 8px", fontSize: 11 }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && navigate(input)}
          placeholder="https://… or search…"
        />
        <button onClick={() => navigate(input)} className="btn-pixel" style={{ padding: "4px 8px", fontSize: 11 }}>GO</button>
        <button onClick={addBookmark} className="pill pill-warn cursor-pointer" title="Bookmark"><Icons.Star size={12} /></button>
        <button onClick={openExternal} className="pill pill-muted cursor-pointer" title="Open in new tab"><Icons.ExternalLink size={12} /></button>
      </div>

      <div className="flex gap-3 overflow-x-auto" style={{ maxHeight: 60, paddingBottom: 4 }}>
        {CATEGORY_ORDER.map((cat) => {
          const inCat = bookmarks.filter((b) => (b.category ?? "tools") === cat);
          if (inCat.length === 0) return null;
          return (
            <div key={cat} className="flex flex-col gap-0.5 flex-shrink-0" style={{ minWidth: 0 }}>
              <span className="font-pixel text-[8px] tracking-widest" style={{ color: "var(--muted)" }}>
                {CATEGORY_LABELS[cat]}
              </span>
              <div className="flex gap-1">
                {inCat.map((b) => (
                  <span
                    key={b.id}
                    className="pill pill-muted flex items-center gap-1 cursor-pointer flex-shrink-0"
                    onClick={() => navigate(b.url)}
                  >
                    <Icons.Bookmark size={9} />
                    <span style={{ maxWidth: 110 }} className="truncate">{b.title}</span>
                    <button onClick={(e) => { e.stopPropagation(); removeBookmark(b.id); }} aria-label="remove">
                      <Icons.X size={9} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex-1 relative overflow-auto" style={{ background: "var(--surface)", border: "2px solid var(--surface-2)" }}>
        {isSearchUrl(url) ? (
          <SearchView
            query={currentQuery}
            hits={searchHits}
            answer={searchAnswer}
            busy={searchBusy}
            error={searchError}
            onNavigate={(target) => navigate(target)}
            onRunQuery={(q) => navigate(q)}
          />
        ) : (
          <>
            {iframeError && (
              <div className="absolute inset-0 z-10 flex items-center justify-center p-4" style={{ background: "var(--overlay)" }}>
                <div className="card-pixel text-center max-w-sm">
                  <div className="font-pixel text-sm mb-2" style={{ color: "var(--danger)" }}>★ EMBED BLOCKED</div>
                  <p className="text-[color:var(--muted)] text-[11px] mb-3">{iframeError}</p>
                  <button onClick={openExternal} className="btn-pixel">OPEN IN NEW TAB ↗</button>
                </div>
              </div>
            )}
            <iframe
              ref={iframeRef}
              src={url}
              title="DelOS Browser"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
              referrerPolicy="no-referrer-when-downgrade"
              onLoad={() => { setLoading(false); }}
              style={{ width: "100%", height: "100%", border: 0, background: "var(--bg)" }}
            />
          </>
        )}
      </div>
    </div>
  );
}

const QUICK_QUERIES = [
  "Latest in multi-agent orchestration",
  "Graph databases for AI memory",
  "Best Next.js 16 patterns",
  "HydraDB vs Neo4j benchmarks",
  "Voice agent architecture",
  "Cohort racing LLMs",
];

function SearchView({
  query,
  hits,
  answer,
  busy,
  error,
  onNavigate,
  onRunQuery,
}: {
  query: string;
  hits: SearchHit[];
  answer: string;
  busy: boolean;
  error: string | null;
  onNavigate: (target: string) => void;
  onRunQuery: (q: string) => void;
}) {
  const [draft, setDraft] = useState(query);
  // Keep the local draft in sync when the query prop changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setDraft(query); }, [query]);

  return (
    <div className="p-4 space-y-3 min-h-full" style={{ color: "var(--fg)" }}>
      <div className="font-pixel text-2xl tracking-widest" style={{ color: "var(--accent)" }}>
        ★ DEL <span style={{ color: "var(--success)" }}>SEARCH</span>
      </div>
      <p className="font-mono text-[11px]" style={{ color: "var(--muted)" }}>
        Real web search via DuckDuckGo · plus Wikipedia + HN via the DelOS MCP demo. Type below or pick a quick query.
      </p>
      <div className="flex gap-2">
        <input
          className="input-pixel flex-1"
          style={{ padding: "8px 12px", fontSize: 13 }}
          placeholder="Search the web…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && draft.trim() && onRunQuery(draft.trim())}
        />
        <button
          className="btn-pixel"
          disabled={!draft.trim() || busy}
          onClick={() => draft.trim() && onRunQuery(draft.trim())}
        >
          {busy ? "…" : "SEARCH"}
        </button>
      </div>

      {!query && (
        <div className="space-y-2 pt-2">
          <div className="font-pixel text-[11px] tracking-widest" style={{ color: "var(--accent)" }}>★ POPULAR</div>
          <div className="flex flex-wrap gap-1">
            {QUICK_QUERIES.map((q) => (
              <button
                key={q}
                onClick={() => onRunQuery(q)}
                className="pill pill-muted cursor-pointer"
                style={{ fontSize: 11 }}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {busy && (
        <div className="font-mono text-[11px] flex items-center gap-2" style={{ color: "var(--muted)" }}>
          <span className="inline-block w-2 h-2 animate-pulse" style={{ background: "var(--accent)" }} />
          searching…
        </div>
      )}

      {error && (
        <div className="card-pixel text-[11px]" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {!busy && query && answer && (
        <div
          className="card-pixel space-y-1"
          style={{ borderColor: "var(--accent)" }}
        >
          <div className="font-pixel text-[11px] tracking-widest" style={{ color: "var(--accent)" }}>
            ★ INSTANT ANSWER
          </div>
          <p className="font-mono text-[12px] leading-relaxed">{answer}</p>
        </div>
      )}

      {!busy && query && hits.length > 0 && (
        <div className="space-y-2 pt-1">
          <div className="font-pixel text-[11px] tracking-widest" style={{ color: "var(--accent)" }}>
            ★ RESULTS ({hits.length})
          </div>
          <ul className="space-y-2">
            {hits.map((h, i) => (
              <li key={`${h.url}-${i}`} className="card-pixel">
                <button
                  className="block w-full text-left"
                  onClick={() => onNavigate(h.url)}
                >
                  <div className="font-pixel text-sm truncate" style={{ color: "var(--accent)" }}>
                    {h.title}
                  </div>
                  <div
                    className="font-mono text-[10px] truncate"
                    style={{ color: "var(--success)" }}
                  >
                    {h.url}
                  </div>
                  <div
                    className="font-mono text-[11px] leading-relaxed mt-1"
                    style={{ color: "var(--fg)" }}
                  >
                    {h.snippet.slice(0, 240)}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!busy && query && hits.length === 0 && !error && !answer && (
        <div className="card-pixel font-mono text-[11px]" style={{ color: "var(--muted)" }}>
          No results from DuckDuckGo Instant Answer for &quot;{query}&quot;. Try a different phrasing.
        </div>
      )}
    </div>
  );
}
