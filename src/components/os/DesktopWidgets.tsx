"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";

// Pinnable desktop widgets — sticky notes, live clock, weather. Render under windows but above wallpaper.

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
          minWidth: 140,
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
    </div>
  );
}
