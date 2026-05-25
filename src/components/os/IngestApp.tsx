"use client";
import { useEffect, useState } from "react";
import * as Icons from "lucide-react";

// IngestApp · trimmed to ONLY the three sources Vaibhav uses for context.
// Was a desktop file-system indexer + 11-connector list. User said: drop
// the desktop ingest, show me Email + Notion + GitHub only.
//
// Each row is a connect card. On click we either kick the OAuth init for
// that provider (when /api/connectors says it's available) or fall back to
// a manual-paste flow so the user can ingest content without a real OAuth
// dance for connectors that aren't configured server-side yet.

type Connector = {
  id: "email" | "notion" | "github";
  label: string;
  description: string;
  icon: string;
  brand: string;
  oauthHint: string;
  paste: { label: string; placeholder: string; tag: string };
};

const CONNECTORS: Connector[] = [
  {
    id: "email",
    label: "Email · Gmail",
    description: "Index recent threads. Voice agent drafts replies in your tone, lands in Gmail Drafts.",
    icon: "Mail",
    brand: "#ea4335",
    oauthHint: "/api/connectors/gmail/auth",
    paste: { label: "Paste email body to remember", placeholder: "Subject: Quarterly review notes\nFrom: andy@…", tag: "email" },
  },
  {
    id: "notion",
    label: "Notion · workspace",
    description: "Mirror pages, databases, and meeting notes. Voice agent writes to your Notion in real time.",
    icon: "FileText",
    brand: "#0f7b6c",
    oauthHint: "/api/connectors/notion/auth",
    paste: { label: "Paste a Notion block to remember", placeholder: "Launch plan v3 · ship clones by Friday\n• …", tag: "notion" },
  },
  {
    id: "github",
    label: "GitHub · repos",
    description: "Pull issues, PRs, and recent commits. Voice agent opens PRs and triages issues for you.",
    icon: "Github",
    brand: "#1f2328",
    oauthHint: "/api/connectors/github/auth",
    paste: { label: "Paste a GitHub URL or issue body", placeholder: "https://github.com/org/repo/issues/42\nor paste a commit message", tag: "github" },
  },
];

type ConnectorStatus = Record<string, { available: boolean; reason?: string }>;

export function IngestApp() {
  const [status, setStatus] = useState<ConnectorStatus>({});
  const [active, setActive] = useState<Connector["id"] | null>(null);
  const [pasted, setPasted] = useState<Record<string, string>>({});
  const [memoryByTag, setMemoryByTag] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    // Lightweight server probe · /api/connectors returns which providers
    // have OAuth configured server-side. Used to switch the Connect button
    // between "Connect via OAuth" and "Paste manually" copy.
    fetch("/api/connectors")
      .then((r) => r.json())
      .then((d: { connectors?: Array<{ id: string; available: boolean; reason?: string }> }) => {
        const s: ConnectorStatus = {};
        for (const c of d.connectors ?? []) s[c.id] = { available: c.available, reason: c.reason };
        setStatus(s);
      })
      .catch(() => {});
  }, []);

  async function commitPaste(c: Connector) {
    const text = (pasted[c.id] ?? "").trim();
    if (!text) return;
    setBusy(c.id);
    try {
      // Push the paste into HydraDB so future runs can recall it.
      await fetch("/api/memory/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // /api/memory/seed normally seeds canned demo memories; here we
          // also pass a body tenantId only when it's a reserved-prefix
          // tenant. We omit tenantId entirely so the server uses the
          // signed-in or anon-IP scope — that's the right home for an
          // ingest event.
          memories: [{ text: `[${c.id}] ${text.slice(0, 400)}`, tags: ["ingest", c.id], source: c.id }],
        }),
      }).catch(() => {});
      setMemoryByTag((p) => ({ ...p, [c.id]: [text.slice(0, 80), ...(p[c.id] ?? [])].slice(0, 6) }));
      setPasted((p) => ({ ...p, [c.id]: "" }));
      window.dispatchEvent(new CustomEvent("toast", { detail: { text: `✓ remembered from ${c.label}`, tone: "ok" } }));
    } finally {
      setBusy(null);
    }
  }

  function tryOAuth(c: Connector) {
    const ok = status[c.id]?.available;
    if (!ok) {
      window.dispatchEvent(new CustomEvent("toast", { detail: { text: `${c.label} OAuth not configured · use Paste to ingest manually`, tone: "warn" } }));
      setActive(c.id);
      return;
    }
    // Open in a new tab. The /api/connectors/<provider>/callback writes
    // tokens to the encrypted session cookie; user comes back to DelOS
    // and the connector flips to "connected".
    window.open(c.oauthHint, "_blank", "noopener");
  }

  return (
    <div className="p-4 space-y-4" style={{ minHeight: "100%" }}>
      <div className="space-y-1">
        <div className="font-pixel text-sm tracking-wider" style={{ color: "var(--accent)" }}>★ INGESTION HUB</div>
        <p className="text-xs font-mono text-[color:var(--muted)] leading-relaxed">
          Connect Email, Notion, and GitHub. The voice agent + cohort use what you ingest as context. Paste content directly when an OAuth provider isn&apos;t configured yet — same memory store.
        </p>
      </div>

      <div className="grid gap-3">
        {CONNECTORS.map((c) => {
          const Cmp = (Icons as unknown as Record<string, React.ComponentType<{ size?: number; color?: string }>>)[c.icon] ?? Icons.Box;
          const available = !!status[c.id]?.available;
          const reason = status[c.id]?.reason;
          const isActive = active === c.id;
          return (
            <div
              key={c.id}
              className="card-pixel"
              style={{ borderColor: isActive ? "var(--accent)" : "var(--surface-2)" }}
            >
              <div className="flex items-start gap-3">
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: c.brand,
                    display: "grid",
                    placeItems: "center",
                    flexShrink: 0,
                    color: "#fff",
                  }}
                >
                  <Cmp size={18} color="#fff" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-pixel text-[12px] tracking-wider" style={{ color: "var(--fg)" }}>
                      {c.label.toUpperCase()}
                    </span>
                    <span
                      className={`pill ${available ? "pill-ok" : "pill-muted"}`}
                      style={{ fontSize: 9, padding: "1px 8px" }}
                      title={reason ?? (available ? "OAuth configured" : "OAuth not configured · paste manually")}
                    >
                      {available ? "● ready" : "○ paste only"}
                    </span>
                  </div>
                  <p className="text-[11px] text-[color:var(--muted)] mt-1 leading-snug">{c.description}</p>
                  <div className="flex gap-2 mt-3 flex-wrap">
                    <button
                      onClick={() => tryOAuth(c)}
                      className="btn-pixel"
                      style={{ fontSize: 11, padding: "5px 12px" }}
                      disabled={busy !== null}
                    >
                      {available ? "Connect" : "Paste manually"}
                    </button>
                    {memoryByTag[c.id] && memoryByTag[c.id].length > 0 && (
                      <span className="pill pill-info" style={{ fontSize: 10 }}>
                        {memoryByTag[c.id].length} ingested this session
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {isActive && (
                <div className="mt-3 space-y-2" style={{ borderTop: "1px dashed var(--surface-2)", paddingTop: 10 }}>
                  <label className="font-pixel text-[10px] tracking-widest" style={{ color: "var(--accent)" }}>
                    {c.paste.label.toUpperCase()}
                  </label>
                  <textarea
                    className="input-pixel"
                    rows={4}
                    value={pasted[c.id] ?? ""}
                    onChange={(e) => setPasted((p) => ({ ...p, [c.id]: e.target.value }))}
                    placeholder={c.paste.placeholder}
                    disabled={busy === c.id}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => commitPaste(c)}
                      disabled={busy === c.id || !(pasted[c.id] ?? "").trim()}
                      className="btn-pixel success"
                      style={{ fontSize: 11, padding: "5px 12px" }}
                    >
                      {busy === c.id ? "saving…" : "★ Remember"}
                    </button>
                    <button
                      onClick={() => setActive(null)}
                      className="btn-pixel ghost"
                      style={{ fontSize: 11, padding: "5px 12px" }}
                    >
                      Close
                    </button>
                  </div>
                  {memoryByTag[c.id] && memoryByTag[c.id].length > 0 && (
                    <div className="mt-2">
                      <div className="font-pixel text-[10px] tracking-widest" style={{ color: "var(--muted)" }}>RECENTLY INGESTED</div>
                      <ul className="text-[10px] font-mono space-y-1 mt-1" style={{ color: "var(--muted)" }}>
                        {memoryByTag[c.id].map((m, i) => (
                          <li key={i} style={{ borderLeft: "2px solid var(--accent)", paddingLeft: 6 }}>
                            {m}{m.length >= 80 ? "…" : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="pt-2" style={{ borderTop: "1px dashed var(--surface-2)" }}>
        <p className="text-[10px] font-mono text-[color:var(--muted)] leading-relaxed">
          Ingested content lands in HydraDB under your current tenant. The voice agent + Cohort + Del Assistant all read from it automatically. To wipe, open <strong>Memory</strong> and clear the corresponding tag.
        </p>
      </div>
    </div>
  );
}
