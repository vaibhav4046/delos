"use client";
// Always-visible sticky note showing top keyboard shortcuts so judges +
// returning users see the navigation surface immediately. Collapsible to
// a single-pill mode that stays out of the way. Dismissal persists via
// localStorage so power users don't see it on every reload.
import { useEffect, useState } from "react";
import * as Icons from "lucide-react";

const KEY_SHORTCUTS: Array<{ keys: string; desc: string }> = [
  { keys: "⌘K", desc: "Command palette" },
  { keys: "F4 · ⌘Space", desc: "Launchpad · all apps" },
  { keys: "⌘ /", desc: "All shortcuts modal" },
  { keys: "⌘T", desc: "New terminal" },
  { keys: "⌘⇧B", desc: "App builder" },
  { keys: "Esc", desc: "Close focused window" },
  { keys: "Drag edge", desc: "Snap half" },
  { keys: "Right-click", desc: "Desktop menu" },
];

const STORAGE_KEY = "delos.shortcuts.sticky.v1";

export function ShortcutsSticky() {
  const [mode, setMode] = useState<"open" | "pill" | "hidden">("open");
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === "pill" || raw === "hidden") setMode(raw);
    } catch {}
  }, []);
  function persist(m: "open" | "pill" | "hidden") {
    setMode(m);
    try { localStorage.setItem(STORAGE_KEY, m); } catch {}
  }
  if (mode === "hidden") {
    // Show a small re-open chip in the bottom-left so users can recover
    return (
      <button
        onClick={() => persist("open")}
        className="font-pixel"
        title="Show shortcuts (⌘ /)"
        aria-label="Show shortcuts"
        style={{
          position: "fixed",
          left: 12,
          bottom: 86,
          padding: "5px 9px",
          fontSize: 10,
          background: "rgba(0,0,0,0.55)",
          color: "var(--accent)",
          border: "1px solid var(--surface-2)",
          borderRadius: 4,
          cursor: "pointer",
          zIndex: 60,
        }}
      >
        ⌨ KEYS
      </button>
    );
  }
  if (mode === "pill") {
    return (
      <button
        onClick={() => persist("open")}
        className="font-pixel"
        title="Show shortcuts"
        style={{
          position: "fixed",
          left: 12,
          bottom: 86,
          padding: "6px 10px",
          fontSize: 10,
          background: "#fff3a6",
          color: "#1b1b2e",
          border: "1px solid #b8902a",
          borderRadius: 3,
          boxShadow: "2px 2px 0 #7a4f0d",
          cursor: "pointer",
          zIndex: 60,
        }}
      >
        ⌨ SHORTCUTS · click to expand
      </button>
    );
  }
  return (
    <div
      className="font-mono"
      style={{
        position: "fixed",
        left: 12,
        bottom: 90,
        width: 240,
        background: "#fff3a6",
        color: "#1b1b2e",
        border: "2px solid #b8902a",
        boxShadow: "4px 4px 0 #7a4f0d",
        padding: "10px 12px",
        fontSize: 10,
        zIndex: 60,
        borderRadius: 2,
      }}
      role="note"
      aria-label="Keyboard shortcuts"
    >
      <header className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Icons.Keyboard size={12} />
          <span className="font-pixel text-[10px] tracking-widest">SHORTCUTS</span>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => persist("pill")}
            title="Collapse to pill"
            aria-label="Collapse"
            style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 12, color: "#7a4f0d", padding: "0 4px" }}
          >
            –
          </button>
          <button
            onClick={() => persist("hidden")}
            title="Hide"
            aria-label="Hide"
            style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 12, color: "#7a4f0d", padding: "0 4px" }}
          >
            ×
          </button>
        </div>
      </header>
      <ul className="space-y-0.5">
        {KEY_SHORTCUTS.map((s) => (
          <li key={s.keys} className="flex items-center justify-between gap-2">
            <span style={{ color: "#3a2a05" }}>{s.desc}</span>
            <code
              style={{
                background: "rgba(0,0,0,0.06)",
                color: "#1b1b2e",
                padding: "1px 4px",
                fontSize: 9,
                borderRadius: 2,
                fontFamily: "var(--font-mono, monospace)",
                whiteSpace: "nowrap",
              }}
            >
              {s.keys}
            </code>
          </li>
        ))}
      </ul>
      <footer className="mt-2 pt-1.5 text-[9px] flex items-center justify-between" style={{ color: "#7a4f0d", borderTop: "1px dashed #b8902a" }}>
        <span>{KEY_SHORTCUTS.length} keys</span>
        <span>⌘ / · all</span>
      </footer>
    </div>
  );
}
