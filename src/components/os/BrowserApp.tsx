"use client";
import { useEffect, useRef, useState } from "react";
import * as Icons from "lucide-react";

type Bookmark = { id: string; title: string; url: string };

const DEFAULT_BOOKMARKS: Bookmark[] = [
  { id: "del", title: "DelOS", url: "/" },
  { id: "docs", title: "DelOS Docs", url: "/docs" },
  { id: "duck", title: "DuckDuckGo", url: "https://duckduckgo.com" },
  { id: "wiki", title: "Wikipedia", url: "https://wikipedia.org" },
  { id: "hn", title: "Hacker News", url: "https://news.ycombinator.com" },
  { id: "mdn", title: "MDN Web Docs", url: "https://developer.mozilla.org" },
  { id: "hydra", title: "HydraDB", url: "https://hydradb.com" },
  { id: "groq", title: "Groq Console", url: "https://console.groq.com" },
  // OSS library — projects shipped for DelOS as one-click bookmarks. Source
  // repos are large enough they ship as references rather than full ports;
  // click → opens in a new tab (X-Frame-Options blocks iframe embed).
  { id: "understand-anything", title: "Understand Anything (vision QA)", url: "https://github.com/Lum1104/Understand-Anything" },
  { id: "codegraph", title: "CodeGraph (LLM graph)", url: "https://github.com/colbymchenry/codegraph" },
  { id: "ai-eng", title: "AI Engineering from Scratch", url: "https://github.com/rohitg00/ai-engineering-from-scratch" },
  { id: "fincept", title: "Fincept Terminal (finance)", url: "https://github.com/Fincept-Corporation/FinceptTerminal" },
  { id: "presenton", title: "Presenton (slides)", url: "https://github.com/presenton/presenton" },
  { id: "multica", title: "Multica (multi-agent)", url: "https://github.com/multica-ai/multica" },
  { id: "secret-knowledge", title: "Book of Secret Knowledge", url: "https://github.com/trimstray/the-book-of-secret-knowledge" },
  { id: "longlive", title: "NVlabs LongLive", url: "https://github.com/NVlabs/LongLive" },
];

const STORE_KEY = "delos.browser.v1";

function normalize(u: string): string {
  const v = u.trim();
  if (!v) return "";
  if (v.startsWith("/")) return v;
  if (/^https?:\/\//i.test(v)) return v;
  if (v.includes(".") && !v.includes(" ")) return "https://" + v;
  return `https://duckduckgo.com/?q=${encodeURIComponent(v)}`;
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
  // Default to same-origin /docs so the user sees real content on first open
  // instead of a blocked external site. Bookmarks still let them jump anywhere.
  const [url, setUrl] = useState("/docs");
  const [input, setInput] = useState("/docs");
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(DEFAULT_BOOKMARKS);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [iframeError, setIframeError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const v = JSON.parse(raw) as { bookmarks?: Bookmark[]; history?: string[] };
        if (v.bookmarks?.length) setBookmarks(v.bookmarks);
        if (v.history?.length) setHistory(v.history);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ bookmarks, history })); } catch {}
  }, [bookmarks, history]);

  function navigate(target: string) {
    const u = normalize(target);
    if (!u) return;
    setUrl(u);
    setInput(u);
    // Proactive check: if this is a known X-Frame-Options blocker, show the
    // embed-block card immediately instead of rendering a blank iframe.
    if (isLikelyEmbedBlocked(u)) {
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

      <div className="flex gap-1 overflow-x-auto" style={{ maxHeight: 32 }}>
        {bookmarks.map((b) => (
          <span key={b.id} className="pill pill-muted flex items-center gap-1 cursor-pointer flex-shrink-0" onClick={() => navigate(b.url)}>
            <Icons.Bookmark size={9} />
            <span style={{ maxWidth: 100 }} className="truncate">{b.title}</span>
            <button onClick={(e) => { e.stopPropagation(); removeBookmark(b.id); }} aria-label="remove"><Icons.X size={9} /></button>
          </span>
        ))}
      </div>

      <div className="flex-1 relative" style={{ background: "var(--surface)", border: "2px solid var(--surface-2)" }}>
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
      </div>
    </div>
  );
}
