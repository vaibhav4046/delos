"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Logo } from "@/components/Logo";

type Slide = {
  eyebrow: string;
  title: string;
  body?: string;
  bullets?: string[];
  accent: string;
  cta?: { label: string; href: string };
  /** When set, slide renders a muted+looping video front-and-center.
   *  Path is resolved against /public — drop the file there and it
   *  appears automatically. Falls back to title + body if 404. */
  video?: string;
};

const SLIDES: Slide[] = [
  {
    eyebrow: "★ AGENTS UNDER PRESSURE · HYDRADB 2026",
    title: "DelOS is the substrate every agent should be built on.",
    body: "Memory · Tools · Recovery · Adaptation wired in by default. Browser-OS where agents build the apps live.",
    accent: "var(--accent)",
    cta: { label: "▶ LAUNCH DELOS", href: "/os" },
  },
  {
    eyebrow: "★ THE PROBLEM",
    title: "Clean demos lie. Real agents face chaos.",
    bullets: [
      "Tools fail mid-run · API rate limits · network flakes",
      "Goals shift · users interrupt · context floods",
      "Most stacks treat recovery + adaptation as afterthoughts",
    ],
    accent: "var(--danger)",
  },
  {
    eyebrow: "★ THE FOUR PILLARS",
    title: "Wired-in survival.",
    bullets: [
      "MEMORY — HydraDB graph + vector + local fallback. Cross-run recall.",
      "TOOLS — typed registry · MCP-shaped · sibling fallback · capability tags",
      "RECOVERY — cockatiel retry + breaker · model failover · critic replan",
      "ADAPTATION — live STEER · drift detection · context compression · interrupt",
    ],
    accent: "var(--accent)",
  },
  {
    eyebrow: "★ THE OS",
    title: "Browser-OS where agents build apps.",
    body: "DelOS is a full window-managed desktop in a tab. 25 apps. Dock magnification. Cmd+K palette. Voice autonomy. Multi-agent constellation always visible.",
    accent: "var(--success)",
    cta: { label: "Open DelOS →", href: "/os" },
  },
  {
    eyebrow: "★ SEE IT IN MOTION",
    title: "Agents that flow.",
    body: "Hero loop · DelOS in action · zero sound, just signal.",
    accent: "var(--accent)",
    video: "/hero-loop.mp4",
  },
  {
    eyebrow: "★ THE LOOP",
    title: "Plan → Execute → Critique → Remember.",
    bullets: [
      "Planner LLM reads goal + recalled memory · outputs typed steps",
      "Executor picks a tool · cockatiel retry · sibling fallback on failure",
      "Critic scores drift against step intent · replan cap 2 · clean adapt event",
      "Memory writes graph node · queryable next run via tag + semantic",
    ],
    accent: "var(--warn)",
  },
  {
    eyebrow: "★ THE SPECTACLE",
    title: "OS-builder mission · 5 sub-agents · 5 apps · Doom.",
    body: "Sub-agent fan-out builds calculator + clock + notes + markdown + tic-tac-toe in parallel — all materialize as DelOS windows live — then Doom auto-launches on the new OS. Antigravity callback.",
    accent: "var(--accent)",
    cta: { label: "Run mission →", href: "/os" },
  },
  {
    eyebrow: "★ THE PROOF",
    title: "Real APIs. Zero mocks. Live evidence.",
    bullets: [
      "/api/run · live orchestrator · drift + replan · SSE event stream",
      "/api/health · 8/9 upstreams alive · groq · mistral · gemini · hydradb · mcp",
      "/api/stats · single source of truth · live drift · live replans/run",
      "/api/coordinator · multi-agent plan · grounded in HydraDB recall",
    ],
    accent: "var(--pipe)",
    cta: { label: "See /play live →", href: "/play" },
  },
  {
    eyebrow: "★ THE SURFACES",
    title: "Web · Chrome ext · iOS · Android · Tauri · PWA.",
    body: "Same orchestrator. Same tenant ID. Same memory. Side panel SSE for agents in your browser. Capacitor wrap for mobile. Service worker for offline shell.",
    accent: "var(--accent-2, var(--accent))",
    cta: { label: "Chrome ext →", href: "/extension" },
  },
  {
    eyebrow: "★ THE ASK",
    title: "Vote DelOS. Then fork it.",
    body: "Open source · self-host with free-tier keys · agents that flow under pressure. Built for Wikithon-style operators who want substrate, not a chatbot.",
    accent: "var(--success)",
    cta: { label: "★ LAUNCH DELOS", href: "/os" },
  },
];

const AUTO_MS = 7500;

// Shared child variants for staggered slide entrance.
const CHILD_VARIANTS = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const } },
};

export default function PitchPage() {
  const [idx, setIdx] = useState(0);
  // Default paused — auto-advance moves faster than judges can read.
  // P key or pill toggles it on for self-running demo mode.
  const [paused, setPaused] = useState(true);

  const next = useCallback(() => setIdx((i) => (i + 1) % SLIDES.length), []);
  const prev = useCallback(() => setIdx((i) => (i - 1 + SLIDES.length) % SLIDES.length), []);

  useEffect(() => {
    if (paused) return;
    const t = setTimeout(next, AUTO_MS);
    return () => clearTimeout(t);
  }, [idx, paused, next]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      } else if (e.key.toLowerCase() === "p") {
        setPaused((p) => !p);
      } else if (e.key === "Escape") {
        window.location.href = "/";
      } else if (/^[1-9]$/.test(e.key)) {
        setIdx(Math.min(SLIDES.length - 1, Number(e.key) - 1));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev]);

  const s = SLIDES[idx];

  return (
    <div className="min-h-screen overflow-hidden relative" style={{ background: "var(--bg)" }}>
      {/* Ambient blurred video behind every slide. Adds motion + depth.
          Falls back silently if /hero-loop.mp4 is missing. */}
      <video
        src="/hero-loop.mp4"
        autoPlay
        muted
        loop
        playsInline
        disablePictureInPicture
        aria-hidden="true"
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{
          objectFit: "cover",
          filter: "blur(24px) brightness(0.45) saturate(1.2)",
          transform: "scale(1.12)",
          opacity: 0.55,
          zIndex: 0,
        }}
        onError={(e) => { (e.currentTarget as HTMLVideoElement).style.display = "none"; }}
      />
      {/* Accent radial glow per slide */}
      <motion.div
        className="absolute inset-0 pointer-events-none"
        animate={{
          background: `radial-gradient(ellipse at 50% 40%, ${s.accent} 0%, transparent 60%)`,
          opacity: 0.22,
        }}
        transition={{ duration: 0.7 }}
        style={{ zIndex: 1 }}
      />
      {/* Grid bg */}
      <div
        className="absolute inset-0 opacity-15 pointer-events-none"
        style={{
          background:
            "repeating-linear-gradient(0deg, transparent 0 38px, rgba(var(--fg-rgb), 0.06) 38px 40px), repeating-linear-gradient(90deg, transparent 0 38px, rgba(var(--fg-rgb), 0.06) 38px 40px)",
        }}
      />

      {/* Top bar */}
      <header className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2"><Logo size={28} /></Link>
        <div className="flex items-center gap-2 text-xs font-mono" style={{ color: "var(--muted)" }}>
          <span>{idx + 1} / {SLIDES.length}</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <button
            onClick={() => setPaused((p) => !p)}
            className="pill pill-muted"
            style={{ cursor: "pointer", fontSize: 10 }}
            aria-label={paused ? "Resume" : "Pause"}
          >
            {paused ? "▶ auto-play" : "▌▌ pause"}
          </button>
        </div>
      </header>

      {/* Slide content — staggered fade-in per child for cinematic feel */}
      <main role="main" aria-label="Pitch deck" className="relative z-10 min-h-screen flex items-center justify-center px-6 py-20">
        <AnimatePresence mode="wait">
          <motion.div
            key={idx}
            initial="hidden"
            animate="visible"
            exit="exit"
            variants={{
              hidden: { opacity: 0 },
              visible: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
              exit: { opacity: 0, y: -20, transition: { duration: 0.25 } },
            }}
            className="max-w-4xl w-full text-center"
          >
            <motion.div
              variants={CHILD_VARIANTS}
              className="inline-block mb-6 pill pill-muted"
              style={{ fontSize: 12, padding: "6px 14px", color: s.accent, borderColor: s.accent, background: "rgba(var(--bg-rgb), 0.6)" }}
            >
              {s.eyebrow}
            </motion.div>
            <motion.h1
              variants={CHILD_VARIANTS}
              className="font-pixel tracking-wider mb-7"
              style={{
                color: "var(--fg)",
                fontSize: "clamp(32px, 7vw, 72px)",
                lineHeight: 1.1,
                textShadow: "0 4px 24px rgba(0,0,0,0.4)",
              }}
            >
              {s.title}
            </motion.h1>

            {/* Foreground video block — only on slides that opt in via slide.video */}
            {s.video && (
              <motion.div
                variants={CHILD_VARIANTS}
                className="mx-auto mb-7 relative"
                style={{
                  width: "min(720px, 88vw)",
                  aspectRatio: "16 / 9",
                  background: "var(--surface)",
                  border: `2px solid ${s.accent}`,
                  boxShadow: `0 0 0 2px var(--bg), 0 0 0 4px ${s.accent}, 8px 8px 0 var(--shadow)`,
                  overflow: "hidden",
                }}
              >
                <video
                  src={s.video}
                  autoPlay
                  muted
                  loop
                  playsInline
                  disablePictureInPicture
                  className="w-full h-full"
                  style={{ objectFit: "cover", display: "block" }}
                  onError={(e) => { (e.currentTarget.parentElement as HTMLDivElement).style.display = "none"; }}
                />
                <span
                  className="absolute top-2 right-2 pill pill-info"
                  style={{ fontSize: 9, padding: "2px 8px", background: "rgba(7,7,11,0.7)" }}
                >
                  ● LIVE LOOP · muted
                </span>
              </motion.div>
            )}

            {s.body && (
              <motion.p
                variants={CHILD_VARIANTS}
                className="font-mono mx-auto mb-7 leading-relaxed"
                style={{
                  color: "var(--muted)",
                  fontSize: "clamp(14px, 2vw, 18px)",
                  maxWidth: "60ch",
                }}
              >
                {s.body}
              </motion.p>
            )}
            {s.bullets && (
              <motion.ul
                variants={CHILD_VARIANTS}
                className="font-mono text-left mx-auto mb-7 space-y-3"
                style={{
                  maxWidth: "60ch",
                  fontSize: "clamp(13px, 1.6vw, 16px)",
                  color: "var(--fg)",
                }}
              >
                {s.bullets.map((b, i) => (
                  <motion.li
                    key={i}
                    initial={{ opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.15 + i * 0.08, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                    className="flex items-start gap-3"
                  >
                    <span style={{ color: s.accent, flexShrink: 0 }}>★</span>
                    <span style={{ lineHeight: 1.5 }}>{b}</span>
                  </motion.li>
                ))}
              </motion.ul>
            )}
            {s.cta && (
              <motion.div variants={CHILD_VARIANTS}>
                <Link
                  href={s.cta.href}
                  className="btn-pixel success magnet"
                  style={{ fontSize: 16, padding: "12px 28px" }}
                >
                  {s.cta.label}
                </Link>
              </motion.div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Progress dots */}
      <div className="absolute bottom-12 left-1/2 -translate-x-1/2 flex gap-2 z-50">
        {SLIDES.map((_, i) => (
          <button
            key={i}
            onClick={() => setIdx(i)}
            aria-label={`Slide ${i + 1}`}
            style={{
              width: i === idx ? 24 : 8,
              height: 8,
              background: i === idx ? s.accent : "var(--surface-2)",
              transition: "all 320ms ease",
              cursor: "pointer",
              border: "none",
            }}
          />
        ))}
      </div>

      {/* Controls hint */}
      <div className="absolute bottom-4 left-0 right-0 text-center font-mono text-[10px]" style={{ color: "var(--muted)", letterSpacing: "0.15em" }}>
        ← → arrow keys · 1-9 jump · P toggles auto-advance · Esc home
      </div>

      {/* Nav arrows */}
      <button
        onClick={prev}
        className="absolute left-4 top-1/2 -translate-y-1/2 z-50 font-pixel text-3xl opacity-30 hover:opacity-100 transition-opacity"
        style={{ color: "var(--fg)", background: "transparent", border: "none", cursor: "pointer" }}
        aria-label="Previous slide"
      >
        ←
      </button>
      <button
        onClick={next}
        className="absolute right-4 top-1/2 -translate-y-1/2 z-50 font-pixel text-3xl opacity-30 hover:opacity-100 transition-opacity"
        style={{ color: "var(--fg)", background: "transparent", border: "none", cursor: "pointer" }}
        aria-label="Next slide"
      >
        →
      </button>
    </div>
  );
}
