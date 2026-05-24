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
// GPS-first location resolution. We request real system geolocation on mount
// with enableHighAccuracy=true so the OS reads the WiFi BSSID / GPS chip / cell
// tower triangulation — same precision Google Maps gets. IP fallback only
// fires if the browser permission API actually says "denied" — never when the
// user hasn't decided yet. Cache is keyed on coords so a stale fix never
// overwrites a fresh one.
type WeatherLoc = { lat: number; lon: number; city: string; source: "manual" | "gps" | "ip" };
// Bump on schema change · old IP-tagged caches from v2.0.x would survive forever
// and keep showing the wrong city. v3 means "fresh GPS pass on next mount".
const WEATHER_LOC_KEY = "delos.weather.loc.v3";

function loadCachedLoc(): WeatherLoc | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(WEATHER_LOC_KEY);
    return raw ? (JSON.parse(raw) as WeatherLoc) : null;
  } catch { return null; }
}

function saveCachedLoc(l: WeatherLoc) {
  try { localStorage.setItem(WEATHER_LOC_KEY, JSON.stringify(l)); } catch {}
}

async function reverseGeocode(lat: number, lon: number): Promise<string> {
  // 5-decimal precision (~1.1m) so reverse-geocode returns the actual locality
  // not a 100km neighborhood centroid. Open-Meteo geocoder is the most accurate
  // free service for this — better than Nominatim's coarse-grained admin areas.
  try {
    const r = await fetch(
      `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat.toFixed(5)}&longitude=${lon.toFixed(5)}&count=1&language=en`
    );
    const j = await r.json();
    const hit = j?.results?.[0];
    if (!hit) return "Your location";
    // Prefer the most specific name available — locality > admin3 > admin2.
    return hit.name || hit.admin3 || hit.admin2 || hit.admin1 || "Your location";
  } catch {
    return "Your location";
  }
}

function getGpsFix(opts: { highAccuracy: boolean; timeoutMs: number }): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("no_geolocation"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      timeout: opts.timeoutMs,
      enableHighAccuracy: opts.highAccuracy,
      // maximumAge:0 — never reuse an old fix. Old fixes cause wrong-city bugs
      // when a laptop wakes up after travel.
      maximumAge: 0,
    });
  });
}

async function resolveLocation(): Promise<WeatherLoc> {
  // 1. Try high-accuracy GPS — WiFi BSSID + cell + GPS chip. Browser surfaces
  //    permission prompt automatically. 15s timeout because cold GPS takes a
  //    moment, especially indoors where it has to fall back to WiFi geolocation.
  if ("geolocation" in navigator) {
    try {
      const pos = await getGpsFix({ highAccuracy: true, timeoutMs: 15000 });
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      const city = await reverseGeocode(lat, lon);
      return { lat, lon, city, source: "gps" };
    } catch {
      // Permission denied OR timeout. Try one more time with low-accuracy mode
      // — some systems block hi-accuracy but allow Wi-Fi network geolocation.
      try {
        const pos = await getGpsFix({ highAccuracy: false, timeoutMs: 6000 });
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const city = await reverseGeocode(lat, lon);
        return { lat, lon, city, source: "gps" };
      } catch {
        // Fall through to IP.
      }
    }
  }
  // 2. IP fallback — proxied through /api/geo. Only fires if GPS was actually
  //    denied or unavailable, never as a default.
  const ip = await fetch("/api/geo").then((r) => r.ok ? r.json() : null).catch(() => null);
  if (ip?.lat != null && ip?.lon != null) {
    return {
      lat: Number(ip.lat),
      lon: Number(ip.lon),
      city: ip.city || ip.region || ip.country || "Unknown",
      source: "ip",
    };
  }
  throw new Error("could not resolve location");
}

async function geocodeCity(q: string): Promise<WeatherLoc | null> {
  try {
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1`).then((r) => r.json());
    const hit = r?.results?.[0];
    if (!hit) return null;
    return { lat: hit.latitude, lon: hit.longitude, city: hit.name, source: "manual" };
  } catch { return null; }
}

function WeatherWidget() {
  const [data, setData] = useState<{ tempC: number; code: number; city: string; source: WeatherLoc["source"] } | null>(null);
  const [err, setErr] = useState(false);
  const [editing, setEditing] = useState(false);
  const [cityInput, setCityInput] = useState("");

  useEffect(() => {
    let cancelled = false;
    let watchId: number | null = null;

    async function fetchAt(loc: WeatherLoc) {
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,weather_code`;
        const r = await fetch(url);
        if (!r.ok) throw new Error("weather " + r.status);
        const j = await r.json();
        if (cancelled) return;
        setData({ tempC: j.current.temperature_2m, code: j.current.weather_code, city: loc.city, source: loc.source });
        setErr(false);
      } catch {
        if (!cancelled) setErr(true);
      }
    }

    async function load() {
      // Paint cached location instantly so widget isn't blank during GPS wait.
      // Skip if user manually overrode — manual is sticky until explicitly changed.
      const cached = loadCachedLoc();
      if (cached && cached.source === "manual") {
        fetchAt(cached);
        return;
      }
      if (cached) fetchAt(cached);
      // Resolve fresh location · GPS-first, IP only on permission denial.
      try {
        const fresh = await resolveLocation();
        if (cancelled) return;
        saveCachedLoc(fresh);
        // Refetch only if moved >100m (one-block precision) or first run.
        if (!cached || Math.hypot(cached.lat - fresh.lat, cached.lon - fresh.lon) > 0.001) {
          fetchAt(fresh);
        }
      } catch {
        if (!cached) setErr(true);
      }
    }

    load();

    // Live position tracking · if the user grants GPS we keep a watch open so
    // the widget updates if they move to a new city. Cheap because the OS only
    // fires when the position actually changes meaningfully.
    if ("geolocation" in navigator) {
      try {
        watchId = navigator.geolocation.watchPosition(
          async (pos) => {
            if (cancelled) return;
            const lat = pos.coords.latitude;
            const lon = pos.coords.longitude;
            const city = await reverseGeocode(lat, lon);
            const loc: WeatherLoc = { lat, lon, city, source: "gps" };
            const cur = loadCachedLoc();
            // Skip update if user has a manual override active.
            if (cur?.source === "manual") return;
            if (!cur || Math.hypot(cur.lat - lat, cur.lon - lon) > 0.001) {
              saveCachedLoc(loc);
              fetchAt(loc);
            }
          },
          () => {/* swallow — initial resolveLocation already handled fallback */},
          { enableHighAccuracy: true, maximumAge: 60_000, timeout: 30_000 }
        );
      } catch {}
    }

    const interval = setInterval(load, 15 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      if (watchId != null && "geolocation" in navigator) navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  async function submitManualCity() {
    const q = cityInput.trim();
    if (!q) { setEditing(false); return; }
    const loc = await geocodeCity(q);
    if (!loc) { setErr(true); return; }
    saveCachedLoc(loc);
    setEditing(false);
    setCityInput("");
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,weather_code`;
      const r = await fetch(url);
      const j = await r.json();
      setData({ tempC: j.current.temperature_2m, code: j.current.weather_code, city: loc.city, source: "manual" });
      setErr(false);
    } catch { setErr(true); }
  }

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
      title="Auto-detected from your device. Double-click to override."
      onDoubleClick={() => setEditing(true)}
    >
      <div className="flex items-center justify-center gap-2">
        <span style={{ fontSize: 22, lineHeight: 1 }}>{icon}</span>
        <span className="font-pixel" style={{ color: "var(--fg)", fontSize: 18, lineHeight: 1 }}>
          {data ? `${Math.round(data.tempC)}°C` : err ? "—" : "…"}
        </span>
      </div>
      {editing ? (
        <input
          autoFocus
          value={cityInput}
          onChange={(e) => setCityInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitManualCity();
            if (e.key === "Escape") { setEditing(false); setCityInput(""); }
          }}
          onBlur={submitManualCity}
          placeholder="city name"
          className="font-mono mt-1"
          style={{
            background: "var(--bg)",
            color: "var(--fg)",
            border: "1px solid var(--surface-2)",
            fontSize: 10,
            padding: "2px 4px",
            width: "100%",
            textAlign: "center",
          }}
        />
      ) : (
        <div
          className="font-mono mt-1"
          style={{
            color: "var(--muted)",
            fontSize: 9,
            letterSpacing: "0.08em",
          }}
        >
          {data?.city ?? (err ? "offline" : "locating…")}
        </div>
      )}
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
