"use client";
import { useState } from "react";
import * as Icons from "lucide-react";
import { useIdentity, renderIdentityPreamble } from "@/lib/useIdentity";

// JarvisOS identity editor. The OS that learns who you are.
// Edits ~/IDENTITY.md fields. Live preview of the preamble that gets injected
// into every agent prompt. Drop-zone for text → identity-aware rewrite.

export function IdentityApp() {
  const [identity, setIdentity] = useIdentity();
  const [draft, setDraft] = useState("");
  const [rewritten, setRewritten] = useState("");
  const [busy, setBusy] = useState(false);

  function setField<K extends keyof typeof identity>(k: K, v: string) {
    setIdentity({ ...identity, [k]: v });
  }

  async function rewrite() {
    if (!draft.trim()) return;
    setBusy(true);
    setRewritten("");
    try {
      const r = await fetch("/api/quick-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `Rewrite the following text to exactly match the user identity profile. Apply tone, format, voice, banned-word rules. Output the rewrite only, nothing else.\n\nTEXT:\n${draft}`,
        }),
      });
      const j = (await r.json()) as { text?: string; error?: string };
      setRewritten(j.text ?? j.error ?? "(no output)");
    } catch (e) {
      setRewritten((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const preamble = renderIdentityPreamble(identity);

  return (
    <div className="p-3 space-y-3 text-xs">
      <div className="flex items-center gap-2">
        <Icons.User size={14} color="var(--accent)" />
        <span className="font-pixel text-sm tracking-wider" style={{ color: "var(--accent)" }}>
          ~/IDENTITY.md
        </span>
        <span className="pill pill-muted" style={{ fontSize: 9 }}>
          DelOS · the OS that learns who you are
        </span>
      </div>

      <p className="font-mono text-[color:var(--muted)]">
        Edit these fields. Every agent run prepends them as a system preamble. The OS becomes a mirror of you.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="font-pixel text-[10px]" style={{ color: "var(--muted)" }}>USER</span>
          <input className="input-pixel" value={identity.user} onChange={(e) => setField("user", e.target.value)} placeholder="vaibhav" />
        </label>
        <label className="space-y-1">
          <span className="font-pixel text-[10px]" style={{ color: "var(--muted)" }}>ROLE</span>
          <input className="input-pixel" value={identity.role} onChange={(e) => setField("role", e.target.value)} placeholder="founder · AI engineer" />
        </label>
        <label className="space-y-1">
          <span className="font-pixel text-[10px]" style={{ color: "var(--muted)" }}>TONE</span>
          <input className="input-pixel" value={identity.tone} onChange={(e) => setField("tone", e.target.value)} placeholder="punchy, kinetic" />
        </label>
        <label className="space-y-1">
          <span className="font-pixel text-[10px]" style={{ color: "var(--muted)" }}>FORMAT</span>
          <input className="input-pixel" value={identity.format} onChange={(e) => setField("format", e.target.value)} placeholder="one beat per line" />
        </label>
        <label className="space-y-1 col-span-2">
          <span className="font-pixel text-[10px]" style={{ color: "var(--muted)" }}>BANNED WORDS / PATTERNS</span>
          <input className="input-pixel" value={identity.banned} onChange={(e) => setField("banned", e.target.value)} placeholder="em dashes, fluff phrases" />
        </label>
        <label className="space-y-1 col-span-2">
          <span className="font-pixel text-[10px]" style={{ color: "var(--muted)" }}>GOALS</span>
          <input className="input-pixel" value={identity.goals} onChange={(e) => setField("goals", e.target.value)} placeholder="ship hackathon-winning agent OS" />
        </label>
      </div>

      <div className="card-pixel space-y-1">
        <div className="flex items-center justify-between">
          <span className="font-pixel text-[10px] tracking-widest" style={{ color: "var(--success)" }}>
            ● LIVE PREAMBLE (injected into every agent run)
          </span>
          <span className="pill pill-ok" style={{ fontSize: 8 }}>{preamble.length} chars</span>
        </div>
        <pre
          className="font-mono whitespace-pre-wrap"
          style={{ fontSize: 10, color: "var(--fg)", background: "var(--bg)", padding: 6, minHeight: 60 }}
        >
          {preamble || "(empty — identity not set yet)"}
        </pre>
      </div>

      <div className="card-pixel space-y-2">
        <div className="font-pixel text-[10px] tracking-widest" style={{ color: "var(--accent)" }}>
          ★ DROP-ZONE · paste text, get identity-aware rewrite
        </div>
        <textarea
          className="input-pixel"
          rows={4}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="drop a draft paragraph here…"
        />
        <button
          className="btn-pixel success"
          onClick={rewrite}
          disabled={busy || !draft.trim()}
          style={{ padding: "6px 12px", fontSize: 11 }}
        >
          {busy ? "rewriting…" : "▶ rewrite to my identity"}
        </button>
        {rewritten && (
          <pre
            className="font-mono whitespace-pre-wrap"
            style={{ fontSize: 11, color: "var(--success)", background: "var(--bg)", padding: 8, lineHeight: 1.5 }}
          >
            {rewritten}
          </pre>
        )}
      </div>
    </div>
  );
}
