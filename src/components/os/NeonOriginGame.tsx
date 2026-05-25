"use client";
import { useState, useMemo } from "react";

// Neon Origin · short retrofuturistic story game with branching choices.
// Original characters, original world, hand-drawn SVG portraits with CRT
// scanline overlay. Choose-your-own-adventure mechanics with 5 scenes and
// 2 endings. Pure JSX/SVG, no external assets.

type SceneId = "intro" | "lab" | "rooftop" | "tunnel" | "core" | "endA" | "endB";

type Choice = { label: string; next: SceneId; flag?: string };
type Scene = {
  id: SceneId;
  portrait: "akira" | "ren" | "machine" | "horizon";
  speaker?: string;
  body: string[];
  choices: Choice[];
};

const STORY: Record<SceneId, Scene> = {
  intro: {
    id: "intro",
    portrait: "horizon",
    body: [
      "Year 2147. Neon Tokyo has frozen mid-sunset for eleven years.",
      "You are Akira — courier, scavenger, and the last person who remembers the day the city stopped.",
      "Tonight, the Spire pulses for the first time in a decade. Someone is calling.",
    ],
    choices: [
      { label: "Head to the abandoned lab", next: "lab" },
      { label: "Climb the rooftop and watch", next: "rooftop" },
    ],
  },
  lab: {
    id: "lab",
    portrait: "akira",
    speaker: "Akira",
    body: [
      "The hydroponic lab is overgrown with bioluminescent moss.",
      "A console flickers. A single line scrolls: I HAVE BEEN WAITING.",
      "Behind a cracked tank, a small android — REN — stirs awake.",
    ],
    choices: [
      { label: "Talk to Ren", next: "tunnel", flag: "ren" },
      { label: "Pull the console core and run", next: "rooftop", flag: "core_stolen" },
    ],
  },
  rooftop: {
    id: "rooftop",
    portrait: "horizon",
    body: [
      "From the rooftop you can see it — a violet beam stitching the Spire to the dead moon.",
      "Drones patrol below. Most are blind. One isn't.",
      "It turns toward you. Slow. Considering.",
    ],
    choices: [
      { label: "Slide down into the tunnels", next: "tunnel" },
      { label: "Stand your ground", next: "endA" },
    ],
  },
  tunnel: {
    id: "tunnel",
    portrait: "ren",
    speaker: "Ren",
    body: [
      "Below the city, the maglev tunnels glow soft cyan.",
      "Ren walks beside you, every step a quiet electrical hum.",
      "REN: \"The Spire is not a building. It is a memory of one. Mine.\"",
      "REN: \"If we reach the core before sunrise, we end the loop. Or we extend it.\"",
    ],
    choices: [
      { label: "End the loop", next: "core", flag: "end_loop" },
      { label: "Extend it", next: "core", flag: "extend_loop" },
    ],
  },
  core: {
    id: "core",
    portrait: "machine",
    body: [
      "The core chamber is a cathedral of obsolete servers.",
      "At its heart, a sphere of liquid memory. Yours. Ren's. Everyone's.",
      "Sunrise is two minutes away. The choice you made still echoes through the corridor.",
    ],
    choices: [
      { label: "Touch the sphere", next: "endB" },
      { label: "Walk back into the city", next: "endA" },
    ],
  },
  endA: {
    id: "endA",
    portrait: "horizon",
    body: [
      "★ ENDING A · THE WATCHER",
      "You spent the last hour of the frozen sunset learning to listen.",
      "The Spire dims. The drones forget you. You take the long route home.",
      "Tomorrow, the city will start counting again. So will you.",
    ],
    choices: [{ label: "Restart", next: "intro" }],
  },
  endB: {
    id: "endB",
    portrait: "machine",
    body: [
      "★ ENDING B · ORIGIN",
      "Your hand passes through liquid memory and the sphere drinks it whole.",
      "Ren smiles for the first time in eleven years. The sun rises.",
      "When you wake, the streets are alive again. Someone is calling your name. You answer.",
    ],
    choices: [{ label: "Restart", next: "intro" }],
  },
};

function Portrait({ kind }: { kind: Scene["portrait"] }) {
  // Hand-drawn SVG avatars · original. No external assets.
  if (kind === "akira") {
    return (
      <svg viewBox="0 0 100 100" style={{ width: "100%", aspectRatio: "1/1" }} aria-label="Akira portrait">
        <defs>
          <linearGradient id="akiraSky" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#2a0050" />
            <stop offset="100%" stopColor="#08051a" />
          </linearGradient>
        </defs>
        <rect width="100" height="100" fill="url(#akiraSky)" />
        <circle cx="50" cy="48" r="22" fill="#fcd34d" />
        <rect x="36" y="36" width="28" height="6" fill="#000" />
        <rect x="38" y="40" width="4" height="2" fill="#22d3ee" />
        <rect x="58" y="40" width="4" height="2" fill="#ff3a8a" />
        <path d="M 38 60 Q 50 66 62 60" stroke="#000" strokeWidth="1.5" fill="none" />
        <rect x="30" y="68" width="40" height="20" fill="#7c3aed" />
        <rect x="44" y="72" width="12" height="3" fill="#22d3ee" />
        <text x="50" y="98" textAnchor="middle" fontFamily="monospace" fontSize="7" fill="#fcd34d">AKIRA</text>
      </svg>
    );
  }
  if (kind === "ren") {
    return (
      <svg viewBox="0 0 100 100" style={{ width: "100%", aspectRatio: "1/1" }} aria-label="Ren portrait">
        <rect width="100" height="100" fill="#0a1a26" />
        <circle cx="50" cy="48" r="22" fill="#c2c2c2" />
        <rect x="36" y="38" width="28" height="6" fill="#000" />
        <rect x="40" y="40" width="4" height="2" fill="#22d3ee" />
        <rect x="56" y="40" width="4" height="2" fill="#22d3ee" />
        <line x1="42" y1="60" x2="58" y2="60" stroke="#000" strokeWidth="1.5" />
        <rect x="30" y="68" width="40" height="20" fill="#22d3ee" />
        <circle cx="50" cy="78" r="3" fill="#fff" />
        <text x="50" y="98" textAnchor="middle" fontFamily="monospace" fontSize="7" fill="#22d3ee">REN · v0.9</text>
      </svg>
    );
  }
  if (kind === "machine") {
    return (
      <svg viewBox="0 0 100 100" style={{ width: "100%", aspectRatio: "1/1" }} aria-label="Core portrait">
        <rect width="100" height="100" fill="#1a0026" />
        <circle cx="50" cy="50" r="30" fill="none" stroke="#a855f7" strokeWidth="2">
          <animate attributeName="r" values="28;32;28" dur="3s" repeatCount="indefinite" />
        </circle>
        <circle cx="50" cy="50" r="20" fill="#7c3aed">
          <animate attributeName="opacity" values="0.6;1;0.6" dur="2s" repeatCount="indefinite" />
        </circle>
        <circle cx="50" cy="50" r="10" fill="#22d3ee" />
        <circle cx="50" cy="50" r="3" fill="#fff" />
        <text x="50" y="98" textAnchor="middle" fontFamily="monospace" fontSize="7" fill="#a855f7">THE CORE</text>
      </svg>
    );
  }
  // horizon
  return (
    <svg viewBox="0 0 100 100" style={{ width: "100%", aspectRatio: "1/1" }} aria-label="Skyline">
      <defs>
        <linearGradient id="sky" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#ff3a8a" />
          <stop offset="50%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#0a1a26" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill="url(#sky)" />
      <circle cx="78" cy="32" r="11" fill="#fcd34d" opacity="0.8" />
      <polygon points="0,80 18,55 28,80" fill="#1a0026" />
      <polygon points="20,80 36,40 52,80" fill="#1a0026" />
      <polygon points="46,80 58,28 70,80" fill="#1a0026" />
      <polygon points="64,80 84,50 96,80" fill="#1a0026" />
      <rect x="56" y="32" width="4" height="48" fill="#a855f7">
        <animate attributeName="opacity" values="0.7;1;0.7" dur="1.6s" repeatCount="indefinite" />
      </rect>
      <text x="50" y="98" textAnchor="middle" fontFamily="monospace" fontSize="7" fill="#fcd34d">NEON TOKYO · 2147</text>
    </svg>
  );
}

export function NeonOriginGame() {
  const [sceneId, setSceneId] = useState<SceneId>("intro");
  const [flags, setFlags] = useState<Set<string>>(new Set());
  const scene = useMemo(() => STORY[sceneId], [sceneId]);
  function pick(c: Choice) {
    if (c.flag) {
      const next = new Set(flags);
      next.add(c.flag);
      setFlags(next);
    }
    if (c.next === "intro") setFlags(new Set());
    setSceneId(c.next);
  }
  const isEnding = sceneId === "endA" || sceneId === "endB";
  return (
    <div
      style={{
        padding: 12,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: "linear-gradient(180deg,#08051a 0%,#1a0026 100%)",
        color: "#fcd34d",
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* CRT scanlines */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: "repeating-linear-gradient(0deg, transparent 0, transparent 2px, rgba(0,0,0,0.18) 2px, rgba(0,0,0,0.18) 3px)",
          mixBlendMode: "multiply",
          zIndex: 2,
        }}
      />
      {/* Vignette */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.65) 100%)", zIndex: 2 }} />

      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 3, position: "relative" }}>
        <strong style={{ fontSize: 12, letterSpacing: "0.18em", color: "#22d3ee" }}>★ NEON ORIGIN</strong>
        <span style={{ fontSize: 10, color: "#a855f7" }}>scene · {sceneId} · choices · {flags.size}</span>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 12, flex: 1, zIndex: 3, position: "relative", minHeight: 0 }}>
        <div style={{ border: "2px solid #7c3aed", padding: 4, background: "#0a0014", borderRadius: 4 }}>
          <Portrait kind={scene.portrait} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
          {scene.speaker && (
            <div style={{ fontSize: 11, letterSpacing: "0.12em", color: "#22d3ee" }}>▸ {scene.speaker.toUpperCase()}</div>
          )}
          <div
            style={{
              border: "2px solid #5e0a8f",
              padding: 10,
              background: "rgba(10,0,20,0.85)",
              borderRadius: 4,
              fontSize: 12.5,
              lineHeight: 1.55,
              flex: 1,
              overflowY: "auto",
              minHeight: 0,
            }}
          >
            {scene.body.map((line, i) => (
              <p key={i} style={{ margin: i === 0 ? 0 : "8px 0 0", color: line.startsWith("★") ? "#22d3ee" : (line.startsWith("REN:") || line.startsWith("AKIRA:")) ? "#a855f7" : "#fcd34d" }}>
                {line}
              </p>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {scene.choices.map((c, i) => (
              <button
                key={i}
                onClick={() => pick(c)}
                style={{
                  textAlign: "left",
                  background: "transparent",
                  color: "#fcd34d",
                  border: "1px solid #5e0a8f",
                  padding: "8px 12px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 12,
                  letterSpacing: "0.06em",
                  transition: "background 120ms",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#2a0050"; e.currentTarget.style.borderColor = "#a855f7"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "#5e0a8f"; }}
              >
                {isEnding ? "↻ " : "▸ "}{c.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
