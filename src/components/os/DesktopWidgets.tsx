"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";

// Pinnable desktop widgets — sticky notes, clock, weather, FX, crypto.
// Live data via free, no-key APIs (Open-Meteo, Frankfurter, CoinGecko).
// All client-side fetches; degrade silently if offline.

type StickyNote = { id: string; text: string; x: number; y: number; color: "yellow" | "pink" | "cyan" | "green" };

const NOTE_COLORS = {
  yellow: { bg: "#fef3c7", fg: "#78350f", border: "#f59e0b" },
  pink: { bg: "#fce7f3", fg: "#831843", border: "#ec4899" },
  cyan: { bg: "#cffafe", fg: "#164e63", border: "#06b6d4" },
  green: { bg: "#dcfce7", fg: "#14532d", border: "#22c55e" },
};

const STORE_KEY = "delos.stickies.v1";

function loadNotes(): StickyNote[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultNotes();
    return JSON.parse(raw) as StickyNote[];
  } catch {
    return defaultNotes();
  }
}

function defaultNotes(): StickyNote[] {
  return [
    {
      id: "demo-1",
      text: "★ Welcome to DelOS\n\nDrag this note. Edit it. Right-click for more.\n\nClick + for a new sticky.",
      x: 24,
      y: 80,
      color: "yellow",
    },
  ];
}

function saveNotes(n: StickyNote[]) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(n)); } catch {}
}

export function DesktopWidgets() {
  const [notes, setNotes] = useState<StickyNote[]>([]);
  const [time, setTime] = useState(new Date());
  const [dragId, setDragId] = useState<string | null>(null);

  useEffect(() => {
    setNotes(loadNotes());
  }, []);

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (notes.length > 0) saveNotes(notes);
  }, [notes]);

  function addNote() {
    const colors: StickyNote["color"][] = ["yellow", "pink", "cyan", "green"];
    const id = `n-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    setNotes((p) => [
      ...p,
      {
        id,
        text: "click to edit…",
        x: 60 + Math.random() * 200,
        y: 120 + Math.random() * 200,
        color: colors[p.length % colors.length],
      },
    ]);
  }

  function delNote(id: string) {
    setNotes((p) => p.filter((n) => n.id !== id));
  }

  function updateText(id: string, text: string) {
    setNotes((p) => p.map((n) => (n.id === id ? { ...n, text } : n)));
  }

  function onDragEnd(id: string, info: { offset: { x: number; y: number } }) {
    setNotes((p) =>
      p.map((n) =>
        n.id === id
          ? {
              ...n,
              x: Math.max(8, n.x + info.offset.x),
              y: Math.max(60, n.y + info.offset.y),
            }
          : n,
      ),
    );
    setDragId(null);
  }

  function cycleColor(id: string) {
    const colors: StickyNote["color"][] = ["yellow", "pink", "cyan", "green"];
    setNotes((p) =>
      p.map((n) =>
        n.id === id ? { ...n, color: colors[(colors.indexOf(n.color) + 1) % colors.length] } : n,
      ),
    );
  }

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 5 }}>
      {/* Sticky notes */}
      {notes.map((n) => {
        const c = NOTE_COLORS[n.color];
        return (
          <motion.div
            key={n.id}
            drag
            dragMomentum={false}
            onDragStart={() => setDragId(n.id)}
            onDragEnd={(_, info) => onDragEnd(n.id, info)}
            initial={false}
            animate={{ x: 0, y: 0 }}
            className="absolute pointer-events-auto group"
            style={{
              left: n.x,
              top: n.y,
              width: 180,
              minHeight: 140,
              background: c.bg,
              color: c.fg,
              padding: 12,
              cursor: dragId === n.id ? "grabbing" : "grab",
              boxShadow: "3px 3px 0 rgba(0,0,0,0.18), 6px 6px 14px rgba(0,0,0,0.15)",
              transform: `rotate(${(n.id.charCodeAt(2) % 5) - 2}deg)`,
              border: `2px solid ${c.border}`,
              fontFamily: "monospace",
              fontSize: 11,
              lineHeight: 1.4,
            }}
          >
            <div className="flex items-center justify-between mb-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => cycleColor(n.id)}
                className="text-[10px] font-bold"
                style={{ background: "transparent", border: "none", cursor: "pointer", color: c.fg }}
                aria-label="Cycle color"
              >
                ●
              </button>
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => delNote(n.id)}
                className="text-[12px] font-bold"
                style={{ background: "transparent", border: "none", cursor: "pointer", color: c.fg }}
                aria-label="Delete note"
              >
                ×
              </button>
            </div>
            <textarea
              value={n.text}
              onChange={(e) => updateText(n.id, e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              className="w-full resize-none outline-none whitespace-pre-wrap"
              style={{
                background: "transparent",
                color: c.fg,
                minHeight: 100,
                fontFamily: "monospace",
                fontSize: 11,
                lineHeight: 1.4,
                border: "none",
              }}
            />
          </motion.div>
        );
      })}

      {/* Add note button — bottom-right above dock */}
      <button
        onClick={addNote}
        className="absolute pointer-events-auto"
        style={{
          right: 16,
          bottom: 80,
          width: 44,
          height: 44,
          background: "var(--accent)",
          color: "var(--on-accent)",
          border: "2px solid var(--shadow)",
          boxShadow: "3px 3px 0 var(--shadow)",
          fontSize: 22,
          fontWeight: 800,
          cursor: "pointer",
          fontFamily: "monospace",
        }}
        title="Add sticky note"
        aria-label="Add sticky note"
      >
        +
      </button>

      {/* Clock widget — top right under header */}
      <div
        className="absolute pointer-events-auto"
        style={{
          right: 16,
          top: 60,
          background: "rgba(var(--bg-rgb), 0.88)",
          backdropFilter: "blur(14px) saturate(160%)",
          border: "2px solid var(--surface-2)",
          padding: "12px 16px",
          minWidth: 160,
          textAlign: "center",
          boxShadow: "3px 3px 0 var(--shadow)",
        }}
      >
        <div
          className="font-pixel tracking-wider"
          style={{ color: "var(--fg)", fontSize: 24, lineHeight: 1, marginBottom: 4 }}
        >
          {time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
        <div className="font-mono" style={{ color: "var(--muted)", fontSize: 9, letterSpacing: "0.1em" }}>
          {time.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
        </div>
      </div>

      {/* Live data stack — weather · FX · crypto. Each falls back to "—" on
          network failure so OS stays usable offline. */}
      <WeatherWidget />
      <CryptoWidget />
      <FxWidget />
    </div>
  );
}

// ── Weather (Open-Meteo, no API key) ─────────────────────────────────────────
function WeatherWidget() {
  const [data, setData] = useState<{ tempC: number; code: number; city: string } | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // Try geolocation, fall back to NYC if denied/unavailable
        let lat = 40.7128, lon = -74.006, city = "New York";
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            if (!("geolocation" in navigator)) return reject(new Error("no geo"));
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 3000 });
          });
          lat = pos.coords.latitude;
          lon = pos.coords.longitude;
          // Reverse geocode via Open-Meteo's free endpoint
          const rg = await fetch(`https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&count=1`).then((r) => r.json()).catch(() => null);
          city = rg?.results?.[0]?.name ?? "Local";
        } catch {}
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code`;
        const r = await fetch(url);
        if (!r.ok) throw new Error("weather " + r.status);
        const j = await r.json();
        if (cancelled) return;
        setData({ tempC: j.current.temperature_2m, code: j.current.weather_code, city });
      } catch {
        if (!cancelled) setErr(true);
      }
    }
    load();
    const interval = setInterval(load, 15 * 60 * 1000); // refresh every 15 min
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const icon = data ? weatherIcon(data.code) : "—";
  return (
    <div
      className="absolute pointer-events-auto"
      style={{
        right: 16,
        top: 140,
        background: "rgba(var(--bg-rgb), 0.88)",
        backdropFilter: "blur(14px) saturate(160%)",
        border: "2px solid var(--surface-2)",
        padding: "10px 14px",
        minWidth: 160,
        textAlign: "center",
        boxShadow: "3px 3px 0 var(--shadow)",
      }}
      title="Open-Meteo · no key"
    >
      <div className="flex items-center justify-center gap-2">
        <span style={{ fontSize: 22, lineHeight: 1 }}>{icon}</span>
        <span className="font-pixel" style={{ color: "var(--fg)", fontSize: 18, lineHeight: 1 }}>
          {data ? `${Math.round(data.tempC)}°C` : err ? "—" : "…"}
        </span>
      </div>
      <div className="font-mono mt-1" style={{ color: "var(--muted)", fontSize: 9, letterSpacing: "0.08em" }}>
        {data?.city ?? (err ? "offline" : "locating…")}
      </div>
    </div>
  );
}

function weatherIcon(code: number): string {
  if (code === 0) return "☀";
  if (code <= 3) return "⛅";
  if (code <= 48) return "☁";
  if (code <= 67) return "☂";
  if (code <= 77) return "❄";
  if (code <= 82) return "☔";
  if (code <= 99) return "⛈";
  return "·";
}

// ── Crypto ticker (CoinGecko, no key) ────────────────────────────────────────
function CryptoWidget() {
  const [prices, setPrices] = useState<{ btc?: number; eth?: number; btcChg?: number; ethChg?: number } | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(
          "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true",
        );
        if (!r.ok) throw new Error("cg " + r.status);
        const j = await r.json();
        if (cancelled) return;
        setPrices({
          btc: j.bitcoin?.usd,
          eth: j.ethereum?.usd,
          btcChg: j.bitcoin?.usd_24h_change,
          ethChg: j.ethereum?.usd_24h_change,
        });
      } catch {
        if (!cancelled) setErr(true);
      }
    }
    load();
    const interval = setInterval(load, 60_000); // refresh every minute
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return (
    <div
      className="absolute pointer-events-auto"
      style={{
        right: 16,
        top: 222,
        background: "rgba(var(--bg-rgb), 0.88)",
        backdropFilter: "blur(14px) saturate(160%)",
        border: "2px solid var(--surface-2)",
        padding: "10px 14px",
        minWidth: 160,
        boxShadow: "3px 3px 0 var(--shadow)",
        fontFamily: "ui-monospace, monospace",
      }}
      title="CoinGecko · no key"
    >
      <div className="font-pixel" style={{ color: "var(--muted)", fontSize: 9, letterSpacing: "0.12em", marginBottom: 4 }}>
        ◆ CRYPTO · USD
      </div>
      <CryptoRow sym="BTC" price={prices?.btc} chg={prices?.btcChg} err={err} />
      <CryptoRow sym="ETH" price={prices?.eth} chg={prices?.ethChg} err={err} />
    </div>
  );
}

function CryptoRow({ sym, price, chg, err }: { sym: string; price?: number; chg?: number; err: boolean }) {
  const color = chg == null ? "var(--muted)" : chg > 0 ? "#6ab04c" : "#c0392b";
  return (
    <div className="flex items-center justify-between" style={{ fontSize: 11 }}>
      <span style={{ color: "var(--fg)", fontWeight: 600 }}>{sym}</span>
      <span style={{ color: "var(--fg)" }}>
        {price ? "$" + price.toLocaleString(undefined, { maximumFractionDigits: 0 }) : err ? "—" : "…"}
      </span>
      <span style={{ color, fontSize: 10, minWidth: 42, textAlign: "right" }}>
        {chg == null ? "" : `${chg > 0 ? "+" : ""}${chg.toFixed(1)}%`}
      </span>
    </div>
  );
}

// ── FX rates (Frankfurter, no key) ───────────────────────────────────────────
function FxWidget() {
  const [rates, setRates] = useState<Record<string, number> | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch("https://api.frankfurter.app/latest?from=USD&to=EUR,GBP,INR,JPY");
        if (!r.ok) throw new Error("fx " + r.status);
        const j = await r.json();
        if (cancelled) return;
        setRates(j.rates);
      } catch {
        if (!cancelled) setErr(true);
      }
    }
    load();
    const interval = setInterval(load, 60 * 60 * 1000); // refresh hourly
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return (
    <div
      className="absolute pointer-events-auto"
      style={{
        right: 16,
        top: 304,
        background: "rgba(var(--bg-rgb), 0.88)",
        backdropFilter: "blur(14px) saturate(160%)",
        border: "2px solid var(--surface-2)",
        padding: "10px 14px",
        minWidth: 160,
        boxShadow: "3px 3px 0 var(--shadow)",
        fontFamily: "ui-monospace, monospace",
      }}
      title="Frankfurter · no key · 1 USD"
    >
      <div className="font-pixel" style={{ color: "var(--muted)", fontSize: 9, letterSpacing: "0.12em", marginBottom: 4 }}>
        ◆ FX · 1 USD
      </div>
      {["EUR", "GBP", "INR", "JPY"].map((sym) => (
        <div key={sym} className="flex items-center justify-between" style={{ fontSize: 11 }}>
          <span style={{ color: "var(--fg)", fontWeight: 600 }}>{sym}</span>
          <span style={{ color: "var(--fg)" }}>
            {rates?.[sym] != null
              ? rates[sym].toLocaleString(undefined, { maximumFractionDigits: sym === "JPY" || sym === "INR" ? 1 : 4 })
              : err ? "—" : "…"}
          </span>
        </div>
      ))}
    </div>
  );
}
