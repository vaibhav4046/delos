"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import * as Icons from "lucide-react";
import Link from "next/link";

// Interactive Macintosh-style OS preview for landing hero.
// User can drag windows, switch apps via mini-dock, watch live terminal,
// click "Launch DelOS" to navigate. Glassmorphism + pixel chrome.

type AppKey = "terminal" | "assistant" | "doom" | "cohort";

type Win = {
  id: string;
  app: AppKey;
  title: string;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
};

const APP_META: Record<AppKey, { label: string; icon: string; color: string }> = {
  terminal: { label: "Terminal", icon: "TerminalSquare", color: "var(--accent)" },
  assistant: { label: "Del Assistant", icon: "Bot", color: "var(--success)" },
  doom: { label: "Del Doom", icon: "Flame", color: "var(--danger)" },
  cohort: { label: "Cohort", icon: "Users", color: "var(--warn)" },
};

const TERMINAL_LINES = [
  { text: "$ delos run --goal=\"agent memory facts\"", color: "var(--accent)" },
  { text: "0.06s BOOT      run_id k7nP4mq", color: "var(--muted)" },
  { text: "0.32s RECALL    3 hits from HydraDB", color: "var(--muted)" },
  { text: "0.65s PLAN      planner=kimi-k2 · 3 steps", color: "var(--muted)" },
  { text: "1.21s STEP 1/3  web_search", color: "var(--muted)" },
  { text: "1.55s ✓         9 results · 1247 tok", color: "var(--success)" },
  { text: "2.11s CRITIC    drift=0.08 → on-goal", color: "var(--success)" },
  { text: "2.40s STEP 2/3  fetch + summarize", color: "var(--muted)" },
  { text: "2.71s ★ SAVE    stored under tenant", color: "var(--success)" },
  { text: "3.45s ANSWER    Graph DBs beat vectors…", color: "var(--accent)" },
];

const ASSISTANT_LINES = [
  { role: "user", text: "explain why graph dbs beat vectors for agent memory" },
  { role: "assist", text: "Three reasons: 1/ relationship traversal — agents naturally form chains 'tool→error→retry→success'. Vectors lose this. 2/ Exact recall — pull a specific past run by ID, not semantic neighbor. 3/ Cheaper update — append edges, no re-embedding." },
];

const COHORT_MEMBERS = [
  { idx: 0, name: "gpt-oss-120b", ms: 312, score: 8 },
  { idx: 1, name: "llama-4-scout", ms: 248, score: 7 },
  { idx: 2, name: "gemini-flash", ms: 198, score: 9 },
];

export function InteractiveMac() {
  const [wins, setWins] = useState<Win[]>([
    { id: "w-terminal", app: "terminal", title: "DELOS TERMINAL", x: 30, y: 50, z: 3, w: 320, h: 200 },
    { id: "w-assistant", app: "assistant", title: "DEL ASSISTANT", x: 220, y: 130, z: 2, w: 280, h: 180 },
    { id: "w-cohort", app: "cohort", title: "COHORT", x: 80, y: 280, z: 1, w: 300, h: 130 },
  ]);
  const [focused, setFocused] = useState<string>("w-terminal");
  const zRef = useRef(4);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // SSR-safe clock — `new Date()` at SSR build time differs from client hydrate time
  // and triggered React error #418 (hydration mismatch). Start null, set after mount.
  const [time, setTime] = useState<Date | null>(null);
  const [terminalIdx, setTerminalIdx] = useState(0);

  // Auto-advance terminal lines
  useEffect(() => {
    const t = setInterval(() => {
      setTerminalIdx((i) => (i + 1) % (TERMINAL_LINES.length + 3));
    }, 800);
    return () => clearInterval(t);
  }, []);

  // Clock — first tick on mount so SSR HTML stays static.
  useEffect(() => {
    setTime(new Date());
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const dragRef = useRef<{ id: string; offX: number; offY: number } | null>(null);

  const onPointerDown = useCallback((id: string) => (e: React.PointerEvent) => {
    const w = wins.find((x) => x.id === id);
    if (!w) return;
    const c = containerRef.current?.getBoundingClientRect();
    if (!c) return;
    dragRef.current = {
      id,
      offX: e.clientX - c.left - w.x,
      offY: e.clientY - c.top - w.y,
    };
    zRef.current += 1;
    setWins((p) => p.map((x) => (x.id === id ? { ...x, z: zRef.current } : x)));
    setFocused(id);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [wins]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const c = containerRef.current?.getBoundingClientRect();
    if (!c) return;
    const x = Math.max(0, Math.min(c.width - 80, e.clientX - c.left - drag.offX));
    const y = Math.max(0, Math.min(c.height - 60, e.clientY - c.top - drag.offY));
    setWins((p) => p.map((w) => (w.id === drag.id ? { ...w, x, y } : w)));
  }, []);

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  function bringFront(id: string) {
    zRef.current += 1;
    setWins((p) => p.map((x) => (x.id === id ? { ...x, z: zRef.current } : x)));
    setFocused(id);
  }

  function closeWin(id: string) {
    setWins((p) => p.filter((x) => x.id !== id));
  }

  function spawnApp(app: AppKey) {
    const exists = wins.find((w) => w.app === app);
    if (exists) {
      bringFront(exists.id);
      return;
    }
    zRef.current += 1;
    const id = `w-${app}-${Date.now()}`;
    setWins((p) => [
      ...p,
      {
        id,
        app,
        title: APP_META[app].label.toUpperCase(),
        x: 100 + Math.random() * 80,
        y: 100 + Math.random() * 60,
        z: zRef.current,
        w: app === "doom" ? 340 : 280,
        h: app === "doom" ? 200 : 180,
      },
    ]);
    setFocused(id);
  }

  return (
    <div
      ref={containerRef}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className="relative mx-auto"
      style={{
        width: "100%",
        maxWidth: 640,
        aspectRatio: "4 / 3",
        background: "linear-gradient(180deg, rgba(var(--bg-rgb), 0.95) 0%, rgba(var(--surface-rgb), 0.9) 100%)",
        border: "3px solid var(--surface-2)",
        boxShadow:
          "0 0 0 1px var(--bg), 0 0 0 4px var(--accent), 12px 12px 0 var(--shadow), 0 20px 60px rgba(0,0,0,0.4)",
        overflow: "hidden",
        userSelect: "none",
        touchAction: "none",
      }}
    >
      {/* Bezel highlights */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: "linear-gradient(135deg, rgba(255,255,255,0.06) 0%, transparent 40%)",
      }} />

      {/* Menu bar */}
      <div
        className="absolute top-0 left-0 right-0 flex items-center justify-between px-3 py-1.5 z-[200]"
        style={{
          background: "rgba(var(--bg-rgb), 0.85)",
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid rgba(var(--fg-rgb), 0.08)",
        }}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <span style={{ width: 8, height: 8, background: "#ff5f57", borderRadius: 0 }} />
            <span style={{ width: 8, height: 8, background: "#febc2e", borderRadius: 0 }} />
            <span style={{ width: 8, height: 8, background: "#28c840", borderRadius: 0 }} />
          </div>
          <span className="font-pixel text-[9px] tracking-widest" style={{ color: "var(--fg)" }}>
            DELOS
          </span>
          <span className="hidden sm:inline font-mono text-[9px]" style={{ color: "var(--muted)" }}>
            File · Edit · View · Window
          </span>
        </div>
        <div className="flex items-center gap-2 font-mono text-[9px]" style={{ color: "var(--muted)" }}>
          <span className="hidden sm:inline">★ HYDRADB</span>
          <span suppressHydrationWarning>
            {time ? time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--:--"}
          </span>
        </div>
      </div>

      {/* Wallpaper / floor */}
      <div
        className="absolute inset-0 pt-7 pb-9"
        style={{
          background:
            "radial-gradient(circle at 30% 20%, rgba(var(--ring-rgb, 251, 197, 49), 0.08), transparent 50%), linear-gradient(135deg, rgba(var(--surface-rgb), 0.3), rgba(var(--bg-rgb), 0.6))",
        }}
      >
        <div
          className="absolute inset-0 opacity-20"
          style={{
            background:
              "repeating-linear-gradient(0deg, transparent 0 24px, rgba(var(--fg-rgb), 0.04) 24px 25px), repeating-linear-gradient(90deg, transparent 0 24px, rgba(var(--fg-rgb), 0.04) 24px 25px)",
          }}
        />

        {/* Windows */}
        {wins.map((w) => {
          const isFocused = w.id === focused;
          const meta = APP_META[w.app];
          const Cmp = (Icons as unknown as Record<string, React.ComponentType<{ size?: number; color?: string }>>)[meta.icon] ?? Icons.Box;
          return (
            <div
              key={w.id}
              onMouseDown={() => bringFront(w.id)}
              className="absolute"
              style={{
                left: w.x,
                top: w.y,
                width: w.w,
                height: w.h,
                zIndex: w.z,
                background: "rgba(var(--surface-rgb), 0.92)",
                backdropFilter: "blur(12px) saturate(160%)",
                border: `2px solid ${isFocused ? meta.color : "var(--surface-2)"}`,
                boxShadow: isFocused
                  ? `0 0 0 1px var(--bg), 0 0 0 2px ${meta.color}, 4px 4px 0 var(--shadow)`
                  : "0 0 0 1px var(--bg), 4px 4px 0 var(--shadow)",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                transition: "border-color 200ms, box-shadow 200ms",
              }}
            >
              <div
                onPointerDown={onPointerDown(w.id)}
                onDoubleClick={() => closeWin(w.id)}
                className="flex items-center justify-between px-2 py-1.5 select-none"
                style={{
                  background: isFocused ? meta.color : "var(--surface-2)",
                  color: isFocused ? "var(--on-accent)" : "var(--fg)",
                  cursor: "grab",
                }}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <Cmp size={10} color="currentColor" />
                  <span className="font-pixel text-[9px] tracking-wider truncate">{w.title}</span>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); closeWin(w.id); }}
                  className="font-pixel text-[10px] leading-none flex items-center justify-center"
                  style={{ width: 12, height: 12, background: "transparent", color: "currentColor", cursor: "pointer" }}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <div className="flex-1 overflow-hidden" style={{ background: "var(--surface)" }}>
                <AppContent app={w.app} terminalIdx={terminalIdx} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Dock */}
      <div
        className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-1.5 px-3 py-2 z-[300]"
        style={{
          background: "rgba(var(--bg-rgb), 0.8)",
          backdropFilter: "blur(14px) saturate(180%)",
          borderTop: "1px solid rgba(var(--fg-rgb), 0.08)",
        }}
      >
        {(["terminal", "assistant", "cohort", "doom"] as AppKey[]).map((a) => {
          const meta = APP_META[a];
          const Cmp = (Icons as unknown as Record<string, React.ComponentType<{ size?: number; color?: string }>>)[meta.icon] ?? Icons.Box;
          const open = wins.some((w) => w.app === a);
          return (
            <button
              key={a}
              onClick={() => spawnApp(a)}
              className="relative flex-shrink-0"
              style={{
                padding: 4,
                background: open ? "var(--surface-2)" : "var(--surface)",
                border: `1.5px solid ${open ? meta.color : "var(--surface-2)"}`,
                cursor: "pointer",
                transition: "transform 140ms cubic-bezier(0.34, 1.56, 0.64, 1)",
              }}
              title={meta.label}
              onMouseEnter={(e) => (e.currentTarget.style.transform = "translateY(-3px) scale(1.1)")}
              onMouseLeave={(e) => (e.currentTarget.style.transform = "translateY(0) scale(1)")}
            >
              <Cmp size={14} color={meta.color} />
              {open && (
                <span
                  className="absolute -bottom-0.5 left-1/2 -translate-x-1/2"
                  style={{ width: 3, height: 3, background: meta.color }}
                />
              )}
            </button>
          );
        })}
        <div className="h-5 w-px mx-1" style={{ background: "var(--surface-2)" }} />
        <Link
          href="/os"
          className="font-pixel text-[9px] tracking-widest px-2 py-1"
          style={{
            background: "var(--accent)",
            color: "var(--on-accent)",
            cursor: "pointer",
            textDecoration: "none",
          }}
        >
          OPEN DELOS →
        </Link>
      </div>

      {/* Click-to-interact hint */}
      <div
        className="absolute pointer-events-none font-pixel text-[8px] tracking-widest"
        style={{
          top: 36,
          left: "50%",
          transform: "translateX(-50%)",
          color: "var(--muted)",
          opacity: 0.6,
        }}
      >
        ★ DRAG WINDOWS · CLICK DOCK · INTERACT
      </div>
    </div>
  );
}

function AppContent({ app, terminalIdx }: { app: AppKey; terminalIdx: number }) {
  if (app === "terminal") {
    return (
      <div className="p-2 font-mono text-[9px] leading-snug h-full overflow-hidden" style={{ color: "var(--fg)" }}>
        {TERMINAL_LINES.slice(0, terminalIdx + 1).map((l, i) => (
          <div key={i} style={{ color: l.color }}>
            {l.text}
          </div>
        ))}
        {terminalIdx < TERMINAL_LINES.length && (
          <span className="cursor" style={{ color: "var(--accent)" }}>▌</span>
        )}
      </div>
    );
  }
  if (app === "assistant") {
    return (
      <div className="p-2 space-y-1.5 font-mono text-[9px] h-full overflow-y-auto">
        {ASSISTANT_LINES.map((m, i) => (
          <div key={i} className="flex gap-1.5">
            <span
              className="flex-shrink-0 inline-flex items-center justify-center font-pixel text-[7px]"
              style={{
                width: 14,
                height: 14,
                background: m.role === "user" ? "var(--surface-2)" : "var(--success)",
                color: m.role === "user" ? "var(--fg)" : "var(--on-accent)",
              }}
            >
              {m.role === "user" ? "U" : "★"}
            </span>
            <span style={{ color: "var(--fg)", lineHeight: 1.4 }}>{m.text}</span>
          </div>
        ))}
        <div className="flex items-center gap-1 mt-1" style={{ color: "var(--muted)" }}>
          <Icons.Loader2 size={8} className="animate-spin" />
          <span style={{ fontSize: 8 }}>thinking with kimi-k2…</span>
        </div>
      </div>
    );
  }
  if (app === "cohort") {
    return (
      <div className="p-2 space-y-1 font-mono text-[9px] h-full">
        <div className="font-pixel text-[8px] tracking-widest mb-1" style={{ color: "var(--warn)" }}>
          ★ 3 MODELS RACING
        </div>
        {COHORT_MEMBERS.map((m) => (
          <div key={m.idx} className="flex items-center gap-1.5" style={{ color: "var(--fg)" }}>
            <span style={{ width: 14, color: "var(--muted)" }}>[{m.idx}]</span>
            <span className="flex-1 truncate">{m.name}</span>
            <span style={{ color: "var(--success)", width: 28, textAlign: "right" }}>{m.ms}ms</span>
            <span
              className="font-pixel text-[8px] px-1"
              style={{ background: "var(--warn)", color: "var(--on-accent)" }}
            >
              {m.score}/10
            </span>
          </div>
        ))}
        <div className="mt-1 pt-1 border-t border-[color:var(--surface-2)]">
          <div style={{ color: "var(--warn)" }}>★ winner [2] gemini · merged ✓</div>
        </div>
      </div>
    );
  }
  if (app === "doom") {
    return (
      <div className="relative h-full w-full" style={{ background: "linear-gradient(180deg, #1a0a2a 0%, #2a1408 50%, #080404 100%)" }}>
        {/* Fake 3D corridor */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div style={{ width: "40%", height: "60%", background: "rgba(192, 57, 43, 0.4)", boxShadow: "inset 0 0 20px rgba(0,0,0,0.5)" }} />
        </div>
        <div className="absolute top-2 left-2 font-pixel text-[8px]" style={{ color: "var(--accent)" }}>L4 · ARENA</div>
        <div className="absolute bottom-2 left-2 right-2 flex justify-between font-pixel text-[8px]">
          <span style={{ color: "var(--success)" }}>HP 78</span>
          <span style={{ color: "var(--accent)" }}>AM 42</span>
          <span style={{ color: "var(--fg)" }}>SC 1240</span>
        </div>
        {/* Crosshair */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" style={{ width: 1, height: 6, background: "var(--accent)" }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" style={{ width: 6, height: 1, background: "var(--accent)" }} />
      </div>
    );
  }
  return null;
}
