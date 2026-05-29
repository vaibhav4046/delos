"use client";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Logo } from "../Logo";

// Boot is on the critical path between landing and a usable desktop, so every
// millisecond matters. Total stage time is ~360ms + 240ms fade = ~600ms. Past
// that, the user gets twitchy. Stages double as a status check for the user
// ("yes, things are loading"); their text is informational not gating.
function buildStages(appsCount: number) {
  return [
    { l: "kernel · pixel grid",          d: 60 },
    { l: "memory · hydradb online",      d: 70 },
    { l: "agents · 5 sub-roles ready",   d: 70 },
    { l: `desktop · ${appsCount} apps`,  d: 80 },
    { l: "voice · whisper + 11labs",     d: 80 },
  ];
}

export function Boot({ onDone, appsCount = 27 }: { onDone: () => void; appsCount?: number }) {
  const STAGES = useMemo(() => buildStages(appsCount), [appsCount]);
  const [step, setStep] = useState(0);
  const [pct, setPct] = useState(0);
  const done = step >= STAGES.length;

  // Smooth percentage glide — independent of stage cadence so the bar feels
  // continuous, not staircased. Tuned to overshoot 100 by ~0.2s of progress
  // so the final reveal feels triumphant, not abrupt.
  useEffect(() => {
    const target = (Math.min(step + 1, STAGES.length) / STAGES.length) * 100;
    let raf = 0;
    const tick = () => {
      setPct((p) => {
        if (p >= target) return target;
        return Math.min(target, p + 2.4);
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step, STAGES.length]);

  useEffect(() => {
    if (step >= STAGES.length) {
      const t = setTimeout(onDone, 280);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setStep((s) => s + 1), STAGES[step].d);
    return () => clearTimeout(t);
  }, [step, onDone, STAGES]);

  // 20 static dust particles — randomised once on mount so each boot is
  // visually distinct without re-rendering positions per frame.
  const dust = useMemo(() => {
    // Seeded once on mount; render-time randomness is the intended behavior.
    /* eslint-disable react-hooks/purity */
    return Array.from({ length: 24 }).map(() => ({
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: 1 + Math.random() * 2,
      delay: Math.random() * 1.4,
      dur: 2.4 + Math.random() * 1.6,
    }));
    /* eslint-enable react-hooks/purity */
  }, []);

  return (
    <motion.div
      className="fixed inset-0 z-[10000] flex flex-col items-center justify-center overflow-hidden"
      initial={{ opacity: 1 }}
      animate={{ opacity: done ? 0 : 1 }}
      transition={{ duration: 0.28 }}
      style={{
        background:
          "radial-gradient(circle at 50% 30%, rgba(251, 197, 49, 0.10) 0%, rgba(var(--surface-rgb), 0.4) 35%, var(--bg) 85%)",
      }}
    >
      {/* Aurora layer · slow gradient sweep gives the screen depth without
          dragging GPU. Pure CSS, no JS animation cost. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "conic-gradient(from 180deg at 50% 50%, transparent 0deg, rgba(251, 197, 49, 0.06) 90deg, transparent 180deg, rgba(46, 204, 113, 0.05) 270deg, transparent 360deg)",
          animation: "boot-aurora 8s linear infinite",
        }}
      />

      {/* Crisp pixel grid · subtle, gives 4K screens a focal texture. */}
      <div
        className="absolute inset-0 opacity-[0.07] pointer-events-none"
        style={{
          background:
            "repeating-linear-gradient(0deg, transparent 0 42px, rgba(var(--fg-rgb), 0.16) 42px 43px), repeating-linear-gradient(90deg, transparent 0 42px, rgba(var(--fg-rgb), 0.16) 42px 43px)",
        }}
      />

      {/* Dust · floats gently. Cheap because each particle is a single div. */}
      {dust.map((d, i) => (
        <motion.span
          key={i}
          className="absolute pointer-events-none"
          style={{
            left: `${d.x}%`,
            top: `${d.y}%`,
            width: d.size,
            height: d.size,
            background: i % 3 === 0 ? "var(--accent)" : "var(--success)",
            boxShadow: `0 0 ${d.size * 4}px currentColor`,
            opacity: 0.6,
          }}
          animate={{ y: [0, -18, 0], opacity: [0.2, 0.9, 0.2] }}
          transition={{ duration: d.dur, repeat: Infinity, delay: d.delay, ease: "easeInOut" }}
        />
      ))}

      {/* Logo capsule · pulse halo behind, sharp pixel logo on top. */}
      <div className="relative flex items-center justify-center mb-7" style={{ width: 260, height: 200 }}>
        <motion.div
          className="absolute"
          style={{
            width: 220,
            height: 220,
            background: "radial-gradient(circle, var(--accent) 0%, transparent 60%)",
            opacity: 0.22,
          }}
          animate={{ scale: [0.9, 1.08, 0.9] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: done ? 1.18 : 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 18 }}
          style={{ filter: "drop-shadow(0 0 28px rgba(251, 197, 49, 0.45))" }}
        >
          <Logo size={120} withText={false} />
        </motion.div>
      </div>

      {/* Pixel wordmark with shimmer sweep. Shimmer is a translated gradient
          mask, GPU-friendly. */}
      <motion.div
        className="relative font-pixel tracking-widest mb-1 overflow-hidden"
        style={{ color: "var(--fg)", fontSize: 28, lineHeight: 1 }}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
      >
        DEL<span style={{ color: "var(--accent)" }}>OS</span>
        <span
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.65) 50%, transparent 70%)",
            mixBlendMode: "overlay",
            animation: "boot-shimmer 2.4s linear infinite",
          }}
        />
      </motion.div>
      <motion.div
        className="font-mono mb-6"
        style={{ color: "var(--muted)", fontSize: 10, letterSpacing: "0.24em" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15 }}
      >
        agents that flow under pressure
      </motion.div>

      {/* Progress bar with crisp tick separators every 20% so the user feels
          steady cadence even on fast machines. */}
      <div
        className="w-[360px] max-w-[86vw] h-1.5 mb-4 overflow-hidden relative"
        style={{ background: "rgba(var(--fg-rgb), 0.10)", borderRadius: 1 }}
      >
        <motion.div
          className="h-full"
          style={{
            width: `${pct}%`,
            background: "linear-gradient(90deg, var(--success), var(--accent), var(--success))",
            backgroundSize: "200% 100%",
            boxShadow: "0 0 14px rgba(251, 197, 49, 0.6)",
            animation: "boot-progress 1.4s linear infinite",
          }}
        />
        {[20, 40, 60, 80].map((tick) => (
          <span
            key={tick}
            className="absolute top-0 bottom-0"
            style={{ left: `${tick}%`, width: 1, background: "rgba(var(--bg-rgb), 0.6)" }}
          />
        ))}
      </div>

      {/* Stage list */}
      <div className="font-mono text-[10px] w-[360px] max-w-[86vw] space-y-0.5 mb-1" style={{ color: "var(--muted)" }}>
        {STAGES.slice(0, step + 1).map((s, i) => {
          const checked = i < step;
          const active = i === step;
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.18 }}
              className="flex items-center gap-2"
              style={{
                color: checked ? "var(--success)" : active ? "var(--accent)" : "var(--muted)",
              }}
            >
              <span style={{ width: 10, display: "inline-block" }}>
                {checked ? "✓" : active ? "▸" : " "}
              </span>
              <span style={{ flex: 1 }}>{s.l}</span>
              {checked && <span style={{ opacity: 0.5 }}>ok</span>}
            </motion.div>
          );
        })}
      </div>

      <div className="absolute bottom-5 left-0 right-0 flex justify-center items-center gap-3 font-mono text-[9px]" style={{ color: "var(--muted)", letterSpacing: "0.2em" }}>
        <span>v2.2</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span>powered by hydradb</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span>{Math.round(pct)}%</span>
      </div>

      <style jsx>{`
        @keyframes boot-aurora {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes boot-shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes boot-progress {
          0% { background-position: 0% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>
    </motion.div>
  );
}
