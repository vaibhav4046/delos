"use client";
import { useEffect, useState } from "react";
import * as Icons from "lucide-react";
import { MODEL_CATALOG, DEFAULTS, type ModelKey } from "@/lib/llm.catalog";
import { useModelOverrides, type ModelOverrides } from "@/lib/useModelOverrides";
import { useWallpaper, WALLPAPERS } from "@/lib/useWallpaper";
import { useMcpServers } from "@/lib/useMcpServers";
import { useTenantId } from "@/lib/useTenant";
import { useVoicePrefs, useVoices, speak, speechSupported } from "@/lib/useSpeech";
import { useTheme, type Theme } from "@/lib/useTheme";
import { useCursor, CURSORS, type CursorStyle } from "@/lib/useCursor";
import { useTemperature, TEMP_PRESETS, MIN_TEMP, MAX_TEMP } from "@/lib/useTemperature";

const ROLES: Array<{ key: keyof ModelOverrides; label: string; desc: string }> = [
  { key: "planner", label: "Planner", desc: "Builds the plan and decides sub-agent fan-out." },
  { key: "executor", label: "Executor", desc: "Picks tools, drives sub-agents, writes final answer." },
  { key: "critic", label: "Critic", desc: "Scores drift after each step, triggers replans." },
];

type Tab = "models" | "connectors" | "theme" | "wallpaper" | "cursor" | "mcp" | "voice" | "device" | "about";

export function SettingsApp() {
  const [tab, setTab] = useState<Tab>("models");
  return (
    <div className="p-3 space-y-3 text-xs">
      <div className="flex gap-1 flex-wrap">
        {(["models", "connectors", "theme", "wallpaper", "cursor", "mcp", "voice", "device", "about"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`pill ${tab === t ? "pill-info" : "pill-muted"} cursor-pointer`}>
            {t.toUpperCase()}
          </button>
        ))}
      </div>
      {tab === "models" && <ModelsTab />}
      {tab === "connectors" && <ConnectorsTab />}
      {tab === "theme" && <ThemeTab />}
      {tab === "wallpaper" && <WallpaperTab />}
      {tab === "cursor" && <CursorTab />}
      {tab === "mcp" && <McpTab />}
      {tab === "voice" && <VoiceTab />}
      {tab === "device" && <DeviceTab />}
      {tab === "about" && <AboutTab />}
    </div>
  );
}

function ConnectorsTab() {
  const [connector, setConnector] = useState<"notion" | "github" | "linear" | "hydradb" | "elevenlabs" | "x" | "slack" | "supabase">("notion");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const SOURCES: Record<string, { label: string; tokenUrl: string; tokenLabel: string; note: string }> = {
    notion: { label: "Notion", tokenUrl: "https://www.notion.so/profile/integrations", tokenLabel: "Internal integration secret (secret_…)", note: "Create an internal integration, share pages with it, paste secret here." },
    github: { label: "GitHub", tokenUrl: "https://github.com/settings/tokens/new", tokenLabel: "Personal access token (classic or fine-grained)", note: "Scope: repo, read:user." },
    linear: { label: "Linear", tokenUrl: "https://linear.app/settings/api", tokenLabel: "Personal API key (lin_api_…)", note: "Read+write workspace data." },
    hydradb: { label: "HydraDB", tokenUrl: "https://hydradb.com", tokenLabel: "API key", note: "Powers DelOS memory layer." },
    elevenlabs: { label: "ElevenLabs", tokenUrl: "https://elevenlabs.io/app/settings/api-keys", tokenLabel: "xi-api-key", note: "Premium voice synthesis." },
    x: { label: "X (Twitter)", tokenUrl: "https://developer.twitter.com/en/portal/dashboard", tokenLabel: "Bearer token", note: "Read-only Tweet search." },
    slack: { label: "Slack", tokenUrl: "https://api.slack.com/apps", tokenLabel: "xoxb- bot token", note: "Scope: chat:write, channels:read." },
    supabase: { label: "Supabase", tokenUrl: "https://supabase.com/dashboard", tokenLabel: "Service role key", note: "Server-side admin access." },
  };

  async function save() {
    if (!token.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/connectors/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connector, token: token.trim() }),
      });
      const j = (await r.json()) as { ok?: boolean; detail?: string; error?: string };
      if (j.ok) {
        setMsg({ ok: true, text: `✓ ${connector} connected · ${j.detail ?? ""}` });
        setToken("");
      } else {
        setMsg({ ok: false, text: j.error ?? "failed" });
      }
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const s = SOURCES[connector];

  return (
    <div className="space-y-3">
      <p className="font-mono text-[color:var(--muted)]">
        Paste a personal access token to connect any source without going through OAuth. Token persists per-user (your tenantId). DelOS pings the source API once to verify, then stores.
      </p>

      <div className="card-pixel space-y-2">
        <div className="font-pixel text-[11px] tracking-wider" style={{ color: "var(--accent)" }}>SOURCE</div>
        <div className="grid grid-cols-4 gap-1">
          {Object.entries(SOURCES).map(([k, v]) => (
            <button
              key={k}
              onClick={() => setConnector(k as typeof connector)}
              className={`pill ${connector === k ? "pill-ok" : "pill-muted"} cursor-pointer`}
              style={{ fontSize: 9 }}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card-pixel space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-pixel text-[11px] tracking-wider" style={{ color: "var(--accent)" }}>{s.label}</span>
          <a href={s.tokenUrl} target="_blank" rel="noreferrer" className="font-mono text-[10px]" style={{ color: "var(--accent)" }}>get token →</a>
        </div>
        <p className="text-[10px]" style={{ color: "var(--muted)" }}>{s.note}</p>
        <input
          className="input-pixel"
          type="password"
          placeholder={s.tokenLabel}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          disabled={busy}
        />
        <button className="btn-pixel success" onClick={save} disabled={busy || !token.trim()} style={{ padding: "6px 12px", fontSize: 11 }}>
          {busy ? "verifying…" : `▶ connect ${s.label}`}
        </button>
        {msg && (
          <p className="font-mono text-[10px]" style={{ color: msg.ok ? "var(--success)" : "var(--danger)" }}>
            {msg.text}
          </p>
        )}
      </div>

      <div className="card-pixel" style={{ padding: 6 }}>
        <div className="font-pixel text-[10px] tracking-widest mb-1" style={{ color: "var(--accent)" }}>★ WHY THIS BEATS OAUTH</div>
        <ul className="font-mono space-y-0.5" style={{ fontSize: 10, color: "var(--muted)" }}>
          <li>· Works on day one. No app registration, no redirect URI list, no callback domain whitelisting.</li>
          <li>· Token scoped to YOU only. DelOS does not see other users' data.</li>
          <li>· Easy to revoke — drop the token at the source, DelOS lookups start failing closed.</li>
          <li>· OAuth flow still available — when env credentials are set, /auth/signin shows the provider buttons.</li>
        </ul>
      </div>
    </div>
  );
}

function CursorTab() {
  const [current, setC] = useCursor();
  return (
    <div className="space-y-3">
      <p className="text-[color:var(--muted)] font-mono">
        Replace the native OS cursor inside DelOS with a pixel-art cursor. &quot;System&quot; keeps your native one.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {CURSORS.map((c) => (
          <button
            key={c.id}
            onClick={() => setC(c.id as CursorStyle)}
            className="card-pixel text-left"
            style={{ borderColor: current === c.id ? "var(--accent)" : "var(--surface-2)" }}
          >
            <div className="h-16 mb-2 flex items-center justify-center" style={{ background: "var(--bg)", border: "1px solid var(--surface-2)" }}>
              {c.id === "system" ? (
                <span className="font-pixel text-xs text-[color:var(--muted)]">[ native ]</span>
              ) : (
                <img
                  src={c.id === "delos" ? "/cursor.svg" : c.id === "classic" ? "/cursor-classic.svg" : "/cursor-neon.svg"}
                  alt={c.label}
                  width={48}
                  height={48}
                  style={{ imageRendering: "pixelated" }}
                />
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="font-pixel text-[11px] tracking-wider">{c.label}</span>
              {current === c.id && <span className="pill pill-ok" style={{ fontSize: 9 }}>active</span>}
            </div>
            <p className="text-[10px] text-[color:var(--muted)] mt-1">{c.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function ThemeTab() {
  const [theme, setT] = useTheme();
  return (
    <div className="space-y-3">
      <p className="text-[color:var(--muted)] font-mono">
        Toggle light + dark mode. Affects every page · tokens · cursors · UI. Saved per-device.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {(["dark", "light"] as Theme[]).map((t) => (
          <button
            key={t}
            onClick={() => setT(t)}
            className="card-pixel text-left"
            style={{ borderColor: theme === t ? "var(--accent)" : "var(--surface-2)" }}
          >
            <div
              className="h-20 mb-2 flex items-center justify-center font-pixel text-sm"
              style={{
                background: t === "dark" ? "#0f0f1b" : "#f4f1de",
                color: t === "dark" ? "#fbc531" : "#1b1b2e",
                border: "2px solid",
                borderColor: t === "dark" ? "#232342" : "#e6e3d0",
              }}
            >
              {t === "dark" ? "🌙 DARK" : "☀ LIGHT"}
            </div>
            <div className="flex items-center justify-between">
              <span className="font-pixel text-[11px] tracking-wider">{t.toUpperCase()}</span>
              {theme === t && <span className="pill pill-ok" style={{ fontSize: 9 }}>active</span>}
            </div>
          </button>
        ))}
      </div>
      <div className="card-pixel">
        <div className="font-pixel text-[11px] tracking-wider mb-1" style={{ color: "var(--accent)" }}>SYSTEM-MATCH</div>
        <p className="text-[color:var(--muted)] text-[10px]">
          Some wallpapers pair best with a specific theme (Mint Cream / Paper / Lavender → light). The picker shows a pairing hint.
        </p>
      </div>
    </div>
  );
}

function VoiceTab() {
  const [prefs, setPrefs] = useVoicePrefs();
  const voices = useVoices();
  const sup = speechSupported();
  const [elevenAvail, setElevenAvail] = useState<boolean | null>(null);
  const [elevenVoices, setElevenVoices] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    fetch("/api/tts")
      .then((r) => r.json())
      .then((j: { available?: boolean }) => setElevenAvail(Boolean(j.available)))
      .catch(() => setElevenAvail(false));
    fetch("/api/tts/voices")
      .then((r) => r.json())
      .then((j: { voices?: Array<{ id: string; name: string }> }) => setElevenVoices(j.voices ?? []))
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-3">
      <p className="text-[color:var(--muted)] font-mono">
        STT: Whisper Large v3 Turbo (via Groq, free quota) or browser SpeechRecognition.<br />
        TTS: ElevenLabs (premium, 10k chars/mo free) with browser speechSynthesis fallback.<br />
        Autonomy: voice commands drive DelOS — &quot;open builder&quot;, &quot;run cohort what&apos;s the weather&quot;.
      </p>
      <div className="flex gap-1 flex-wrap">
        <span className={`pill ${sup.recorder ? "pill-ok" : "pill-bad"}`}>recorder {sup.recorder ? "ok" : "off"}</span>
        <span className={`pill ${sup.stt ? "pill-ok" : "pill-bad"}`}>browser-STT {sup.stt ? "ok" : "off"}</span>
        <span className={`pill ${sup.tts ? "pill-ok" : "pill-bad"}`}>browser-TTS {sup.tts ? "ok" : "off"}</span>
        <span className={`pill ${elevenAvail ? "pill-ok" : elevenAvail === false ? "pill-warn" : "pill-muted"}`}>
          ElevenLabs {elevenAvail ? "ok" : elevenAvail === false ? "no key" : "…"}
        </span>
      </div>

      <div className="card-pixel space-y-2">
        <div className="font-pixel text-[11px] tracking-wider" style={{ color: "var(--accent)" }}>STT PROVIDER</div>
        <div className="flex gap-1">
          {(["whisper", "browser"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPrefs({ ...prefs, sttProvider: p })}
              className={`pill ${prefs.sttProvider === p ? "pill-info" : "pill-muted"} cursor-pointer`}
            >
              {p === "whisper" ? "WHISPER (Groq)" : "BROWSER"}
            </button>
          ))}
        </div>
      </div>

      <div className="card-pixel space-y-2">
        <div className="font-pixel text-[11px] tracking-wider" style={{ color: "var(--accent)" }}>TTS PROVIDER</div>
        <div className="flex gap-1">
          {(["elevenlabs", "browser"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPrefs({ ...prefs, ttsProvider: p })}
              className={`pill ${prefs.ttsProvider === p ? "pill-info" : "pill-muted"} cursor-pointer`}
            >
              {p === "elevenlabs" ? "ELEVENLABS" : "BROWSER"}
            </button>
          ))}
        </div>
        {prefs.ttsProvider === "elevenlabs" && (
          <>
            <label className="block">
              <span className="text-[10px] tracking-wider text-[color:var(--muted)]">YOUR ELEVENLABS KEY (BYOK · stored locally)</span>
              <input
                type="password"
                className="input-pixel"
                placeholder="xi-…  (paste your key — never leaves your browser)"
                value={prefs.elevenApiKey ?? ""}
                onChange={(e) => setPrefs({ ...prefs, elevenApiKey: e.target.value })}
                autoComplete="off"
              />
              <span className="text-[9px] text-[color:var(--muted)] block mt-1">
                Get a free key (10k chars/mo) at{" "}
                <a
                  href="https://elevenlabs.io/app/settings/api-keys"
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--accent)", textDecoration: "underline" }}
                >
                  elevenlabs.io/app/settings/api-keys
                </a>
              </span>
            </label>
            {elevenVoices.length > 0 && (
              <select
                className="input-pixel"
                value={prefs.elevenVoiceId}
                onChange={(e) => setPrefs({ ...prefs, elevenVoiceId: e.target.value })}
              >
                <option value="">(default voice)</option>
                {elevenVoices.map((v) => (
                  <option key={v.id} value={v.id}>{v.name} · {v.id.slice(0, 8)}</option>
                ))}
              </select>
            )}
          </>
        )}
        {prefs.ttsProvider === "browser" && (
          <select
            className="input-pixel"
            value={prefs.voiceName}
            onChange={(e) => setPrefs({ ...prefs, voiceName: e.target.value })}
          >
            <option value="">(browser default)</option>
            {voices.map((v) => (
              <option key={`${v.name}-${v.lang}`} value={v.name}>
                {v.name} · {v.lang}{v.default ? " · default" : ""}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="card-pixel space-y-2">
        <div className="font-pixel text-[11px] tracking-wider" style={{ color: "var(--accent)" }}>RATE {prefs.rate.toFixed(2)}×</div>
        <input
          type="range"
          min="0.5"
          max="2"
          step="0.05"
          value={prefs.rate}
          onChange={(e) => setPrefs({ ...prefs, rate: Number(e.target.value) })}
          className="w-full"
        />
        <div className="font-pixel text-[11px] tracking-wider" style={{ color: "var(--accent)" }}>PITCH {prefs.pitch.toFixed(2)}</div>
        <input
          type="range"
          min="0"
          max="2"
          step="0.05"
          value={prefs.pitch}
          onChange={(e) => setPrefs({ ...prefs, pitch: Number(e.target.value) })}
          className="w-full"
        />
      </div>

      <label className="card-pixel flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={prefs.autoSpeak}
          onChange={(e) => setPrefs({ ...prefs, autoSpeak: e.target.checked })}
        />
        <span>
          <div className="font-pixel text-[11px] tracking-wider">AUTO-SPEAK ANSWERS</div>
          <div className="text-[color:var(--muted)] text-[10px]">Terminal + Voice agent speak final answer aloud.</div>
        </span>
      </label>

      <label className="card-pixel flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={prefs.autonomy}
          onChange={(e) => setPrefs({ ...prefs, autonomy: e.target.checked })}
        />
        <span>
          <div className="font-pixel text-[11px] tracking-wider">AUTONOMY MODE</div>
          <div className="text-[color:var(--muted)] text-[10px]">Voice commands drive DelOS (open apps, run missions, build, cohort, navigate).</div>
        </span>
      </label>

      <button
        className="btn-pixel"
        onClick={() => speak("DelOS voice ready. Agents that flow under pressure.")}
        style={{ padding: "8px 12px", fontSize: 11 }}
      >
        <Icons.Volume2 size={12} /> TEST VOICE
      </button>
    </div>
  );
}

function ModelsTab() {
  const [overrides, setOverrides] = useModelOverrides();
  const [temp, setTemp] = useTemperature();
  function setRole(role: keyof ModelOverrides, val: ModelKey | "") {
    const next = { ...overrides };
    if (val) next[role] = val;
    else delete next[role];
    setOverrides(next);
  }
  return (
    <div className="space-y-3">
      <p className="text-[color:var(--muted)] font-mono">
        Override model per role. Sent with every run. Server swaps via AsyncLocalStorage.
      </p>

      {/* Temperature slider */}
      <div className="card-pixel space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-pixel text-sm tracking-wider" style={{ color: "var(--accent)" }}>TEMPERATURE</span>
          <span className="font-mono text-[11px]" style={{ color: "var(--success)" }}>{temp.toFixed(2)}</span>
        </div>
        <p className="text-[color:var(--muted)]">Controls model randomness. 0 = deterministic, 1.5 = wild.</p>
        <input
          type="range"
          min={MIN_TEMP}
          max={MAX_TEMP}
          step={0.05}
          value={temp}
          onChange={(e) => setTemp(parseFloat(e.target.value))}
          className="w-full cursor-pointer"
          style={{ accentColor: "var(--accent)" }}
          aria-label="Temperature"
        />
        <div className="flex gap-1 flex-wrap">
          {TEMP_PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => setTemp(p.value)}
              className={`pill cursor-pointer ${Math.abs(temp - p.value) < 0.05 ? "pill-ok" : "pill-muted"}`}
              title={p.tone}
              style={{ fontSize: 9 }}
            >
              {p.label} ({p.value})
            </button>
          ))}
        </div>
      </div>
      {ROLES.map((r) => {
        const current = overrides[r.key] ?? DEFAULTS[r.key];
        const def = DEFAULTS[r.key];
        return (
          <div key={r.key} className="card-pixel space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-pixel text-sm tracking-wider" style={{ color: "var(--accent)" }}>{r.label.toUpperCase()}</span>
              {overrides[r.key] && overrides[r.key] !== def && (
                <button onClick={() => setRole(r.key, "")} className="pill pill-warn cursor-pointer">
                  <Icons.RotateCcw size={10} /> reset
                </button>
              )}
            </div>
            <p className="text-[color:var(--muted)]">{r.desc}</p>
            <select className="input-pixel" value={current} onChange={(e) => setRole(r.key, e.target.value as ModelKey)}>
              {MODEL_CATALOG.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.provider} · {m.label} · {m.ctx} · {m.tag}{m.paid ? " · paid only" : ""}{m.key === def ? " (default)" : ""}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}

function WallpaperTab() {
  const [current, setW] = useWallpaper();
  return (
    <div className="space-y-3">
      <p className="text-[color:var(--muted)] font-mono">
        {WALLPAPERS.length} wallpapers. Pixel patterns + gradients + animated. Click to apply instantly.
      </p>
      <div className="grid grid-cols-3 gap-2">
        {WALLPAPERS.map((w) => (
          <button
            key={w.id}
            onClick={() => setW(w.id)}
            className="card-pixel text-left"
            style={{ padding: 6, borderColor: current === w.id ? "var(--accent)" : "var(--surface-2)" }}
            title={w.label}
          >
            <div
              className={`h-14 mb-1 ${w.animated ? "wallpaper-animated" : ""}`}
              style={{ background: w.css, border: "1px solid var(--surface-2)" }}
            />
            <div className="flex items-center justify-between gap-1">
              <span className="font-pixel text-[10px] tracking-wider truncate">{w.label}</span>
              {current === w.id && <span className="pill pill-ok" style={{ fontSize: 8, padding: "0 3px" }}>★</span>}
            </div>
            <div className="flex gap-1 mt-1 flex-wrap">
              {w.animated && <span className="pill pill-warn" style={{ fontSize: 8, padding: "0 3px" }}>anim</span>}
              {w.pairsWith && <span className="pill pill-muted" style={{ fontSize: 8, padding: "0 3px" }}>{w.pairsWith}</span>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function McpTab() {
  const [servers, setServers] = useMcpServers();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  function add() {
    if (!name.trim() || !url.trim()) return;
    const id = name.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 30) + "_" + Math.random().toString(36).slice(2, 5);
    setServers([...servers, { id, name: name.trim(), url: url.trim(), enabled: true }]);
    setName("");
    setUrl("");
  }
  function toggle(id: string) {
    setServers(servers.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)));
  }
  function remove(id: string) {
    setServers(servers.filter((s) => s.id !== id));
  }
  return (
    <div className="space-y-3">
      <p className="text-[color:var(--muted)] font-mono">
        Register MCP servers. Tools are merged into the registry and become callable by the planner. JSON-RPC over HTTP.
      </p>

      <div className="card-pixel space-y-2">
        <div className="font-pixel text-[11px] tracking-wider" style={{ color: "var(--accent)" }}>ADD SERVER</div>
        <input className="input-pixel" placeholder="name (e.g. weather)" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input-pixel" placeholder="https://example.com/mcp" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button onClick={add} className="btn-pixel" style={{ padding: "6px 10px", fontSize: 11 }}>+ ADD</button>
      </div>

      <div className="space-y-2">
        {servers.map((s) => (
          <div key={s.id} className="card-pixel" style={{ borderColor: s.enabled ? "var(--success)" : "var(--surface-2)" }}>
            <div className="flex items-center justify-between mb-1">
              <span className="font-pixel text-[11px] tracking-wider">{s.name}</span>
              <div className="flex gap-1">
                <button onClick={() => toggle(s.id)} className={`pill ${s.enabled ? "pill-ok" : "pill-muted"} cursor-pointer`}>
                  {s.enabled ? "ON" : "OFF"}
                </button>
                <button onClick={() => remove(s.id)} className="pill pill-bad cursor-pointer">
                  <Icons.Trash2 size={10} />
                </button>
              </div>
            </div>
            <div className="text-[color:var(--muted)] font-mono text-[10px] break-all">{s.url}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DeviceTab() {
  const [tenant, setTenant] = useTenantId();
  return (
    <div className="space-y-3">
      <p className="text-[color:var(--muted)] font-mono">
        Cross-device sync. Set the same Tenant ID on Mac, Windows, iOS, Android. All HydraDB writes go to that tenant → memory + built apps sync automatically.
      </p>
      <div className="card-pixel space-y-2">
        <div className="font-pixel text-[11px] tracking-wider" style={{ color: "var(--accent)" }}>TENANT ID</div>
        <input className="input-pixel" placeholder="e.g. me_personal_dev" value={tenant} onChange={(e) => setTenant(e.target.value)} />
        <p className="text-[color:var(--muted)] text-[10px]">Empty = use server default. Tip: pick something unique; ID is the only sync key.</p>
      </div>
      <div className="card-pixel">
        <div className="font-pixel text-[11px] tracking-wider mb-1" style={{ color: "var(--accent)" }}>INSTALL AS APP</div>
        <ul className="text-[color:var(--muted)] font-mono text-[10px] space-y-1">
          <li>· Chrome (Mac/Win/Linux): ⋮ menu → Install DelOS</li>
          <li>· Safari iOS: Share → Add to Home Screen</li>
          <li>· Chrome Android: ⋮ → Install app</li>
          <li>· Native desktop: see <code>src-tauri/</code> in repo for Tauri build</li>
        </ul>
      </div>
    </div>
  );
}

function AboutTab() {
  return (
    <div className="space-y-2 font-mono text-[color:var(--muted)] text-[11px]">
      <p>DelOS Settings. Client preferences live in localStorage and are sent with each request.</p>
      <p>Model overrides → AsyncLocalStorage swap per request.</p>
      <p>MCP servers → JSON-RPC tool discovery merged into registry.</p>
      <p>Tenant ID → HydraDB partition for cross-device sync.</p>
      <p>Wallpaper → CSS gradient variable read by /os desktop.</p>
    </div>
  );
}
