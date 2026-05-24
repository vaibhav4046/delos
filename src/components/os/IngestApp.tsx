"use client";
import { useEffect, useState } from "react";
import * as Icons from "lucide-react";
import {
  supportsFsAccess,
  pickDirectory,
  indexDirectory,
  saveIndex,
  loadIndex,
  searchIndex,
  syncDigestToServer,
  type IndexedFile,
} from "@/lib/desktopIngest";
import { getTenantId } from "@/lib/useTenant";

// Desktop file ingestion app.
// One click "Connect Desktop" → user picks any folder → DelOS indexes file names
// and small text previews into localStorage + HydraDB digest. Agents then have
// real context about user's actual files.

export function IngestApp() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ count: number; path: string } | null>(null);
  const [root, setRoot] = useState<string | null>(null);
  const [files, setFiles] = useState<IndexedFile[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<IndexedFile[]>([]);
  const [connectors, setConnectors] = useState<Array<{ id: string; name: string; available: boolean; oauthInit?: string; reason?: string }>>([]);

  useEffect(() => {
    setSupported(supportsFsAccess());
    const cached = loadIndex();
    if (cached) {
      setRoot(cached.root);
      setFiles(cached.files);
    }
    fetch("/api/connectors")
      .then((r) => r.json())
      .then((d: { connectors?: Array<{ id: string; name: string; available: boolean; oauthInit?: string; reason?: string }> }) => setConnectors(d.connectors ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults(files.slice(0, 50));
      return;
    }
    setResults(searchIndex(query, 50));
  }, [query, files]);

  async function connectDesktop() {
    setBusy(true);
    setProgress({ count: 0, path: "" });
    try {
      const handle = await pickDirectory();
      if (!handle) {
        setProgress(null);
        return;
      }
      const indexed = await indexDirectory(handle, (count, path) => setProgress({ count, path }));
      setRoot(handle.name);
      setFiles(indexed);
      saveIndex(handle.name, indexed);
      // Privacy: digest is paths + sizes only, no content. Filtered server side too.
      await syncDigestToServer(handle.name, indexed, getTenantId() ?? "delrio_demo");
    } catch (e) {
      console.error("ingest failed", e);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div className="p-3 space-y-3 text-xs">
      <div className="flex items-center gap-2">
        <Icons.HardDrive size={14} color="var(--accent)" />
        <span className="font-pixel text-sm tracking-wider" style={{ color: "var(--accent)" }}>
          INGESTION HUB
        </span>
        <span className="pill pill-muted" style={{ fontSize: 9 }}>
          desktop · cloud · social
        </span>
      </div>

      <p className="font-mono text-[color:var(--muted)]">
        Read your real desktop files inside DelOS. Index runs locally, never uploads file content. Optional digest of paths + sizes syncs to HydraDB so agents have context.
      </p>

      {/* Desktop section */}
      <div className="card-pixel space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-pixel text-[10px] tracking-widest" style={{ color: "var(--success)" }}>
            ● LOCAL · DESKTOP DIRECTORY
          </span>
          {root && <span className="pill pill-ok" style={{ fontSize: 9 }}>{root} · {files.length} files</span>}
        </div>

        {supported === false ? (
          <p className="font-mono text-[10px]" style={{ color: "var(--warn)" }}>
            Browser does not support showDirectoryPicker. Use Chrome / Edge / Opera.
          </p>
        ) : (
          <div className="flex gap-2 items-center flex-wrap">
            <button
              className="btn-pixel success"
              onClick={connectDesktop}
              disabled={busy}
              style={{ padding: "8px 14px", fontSize: 11 }}
            >
              {busy ? "indexing…" : root ? "↻ re-index" : "▶ connect desktop"}
            </button>
            {progress && (
              <span className="font-mono text-[10px]" style={{ color: "var(--muted)" }}>
                {progress.count} indexed · {progress.path.slice(-50)}
              </span>
            )}
          </div>
        )}

        {files.length > 0 && (
          <div className="space-y-1">
            <input
              className="input-pixel"
              placeholder="search file name or text preview…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="space-y-1 max-h-64 overflow-y-auto" style={{ background: "var(--bg)", padding: 6 }}>
              {results.map((f, i) => (
                <div
                  key={`${f.path}-${i}`}
                  className="font-mono"
                  style={{ fontSize: 10, color: f.kind === "directory" ? "var(--accent)" : "var(--fg)" }}
                  title={f.textPreview ?? f.path}
                >
                  {f.kind === "directory" ? "▸" : "·"} {f.path} {f.kind === "file" && `(${formatSize(f.size)})`}
                </div>
              ))}
              {results.length === 0 && (
                <p className="font-mono text-[10px]" style={{ color: "var(--muted)" }}>
                  no matches.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Cloud / connectors section */}
      <div className="card-pixel space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-pixel text-[10px] tracking-widest" style={{ color: "var(--accent)" }}>
            ★ CLOUD CONNECTORS
          </span>
          <span className="pill pill-muted" style={{ fontSize: 9 }}>{connectors.filter((c) => c.available).length}/{connectors.length} live</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {connectors.map((c) => (
            <div
              key={c.id}
              className="card-pixel"
              style={{
                padding: 6,
                borderColor: c.available ? "var(--success)" : "var(--surface-2)",
                background: c.available ? "rgba(34,197,94,0.08)" : "var(--surface)",
              }}
            >
              <div className="flex items-center justify-between">
                <span className="font-pixel text-[10px] tracking-wider" style={{ color: c.available ? "var(--success)" : "var(--fg)" }}>
                  {c.name}
                </span>
                <span className="pill" style={{ fontSize: 8, background: c.available ? "var(--success)" : "var(--surface-2)", color: c.available ? "var(--on-accent)" : "var(--muted)" }}>
                  {c.available ? "live" : "off"}
                </span>
              </div>
              {!c.available && c.reason && (
                <p className="font-mono text-[9px] mt-0.5" style={{ color: "var(--muted)" }}>
                  {c.reason}
                </p>
              )}
              {c.oauthInit && !c.available && (
                <a
                  href={c.oauthInit}
                  className="font-mono text-[10px] mt-1 inline-block"
                  style={{ color: "var(--accent)" }}
                  target="_blank"
                  rel="noreferrer"
                >
                  connect →
                </a>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="card-pixel" style={{ padding: 6 }}>
        <div className="font-pixel text-[10px] tracking-widest mb-1" style={{ color: "var(--accent)" }}>
          ★ HOW IT FLOWS
        </div>
        <ul className="font-mono space-y-0.5" style={{ fontSize: 9, color: "var(--muted)" }}>
          <li>1. Pick directory · stays in browser memory.</li>
          <li>2. Index walks up to 500 files · text previews ≤ 4KB each.</li>
          <li>3. Digest of paths + sizes only goes to HydraDB. File content NEVER uploads.</li>
          <li>4. Agents in Terminal / Builder can recall your filenames as context.</li>
          <li>5. Cloud connectors fill in Notion, Gmail, Drive once OAuth creds are configured.</li>
        </ul>
      </div>
    </div>
  );
}

function formatSize(b: number): string {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / 1024 / 1024).toFixed(1)}MB`;
}
