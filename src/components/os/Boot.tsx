"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Logo } from "../Logo";

function buildStages(appsCount: number) {
  return [
    { l: "kernel · pixel grid", d: 70 },
    { l: "memory · hydradb", d: 90 },
    { l: "agents · 5 sub-roles", d: 110 },
    { l: "tools · 17 registered", d: 90 },
    { l: "voice · whisper + 11labs", d: 80 },
    { l: `desktop · ${appsCount} apps`, d: 180 },
  ];
}

export function Boot({ onDone, appsCount = 27 }: { onDone: () => void; appsCount?: number }) {
  const STAGES = buildStages(appsCount);
  const [step, setStep] = useState(0);
  const [pct, setPct] = useState(0);
  const done = step >= STAGES.length;

  // Smooth pct ease
  useEffect(() => {
    const target = (Math.min(step + 1, STAGES.length) / STAGES.length) * 100;
    const t = setInterval(() => {
      setPct((p) => (p >= target ? target : Math.min(target, p + 1.6)));
    }, 12);
    return () => clearInterval(t);
  }, [step]);

  useEffect(() => {
    if (step >= STAGES.length) {
      const t = setTimeout(onDone, 420);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setStep((s) => s + 1), STAGES[step].d);
    return () => clearTimeout(t);
  }, [step, onDone]);

  return (
    <motion.div
      className="fixed inset-0 z-[10000] flex flex-col items-center justify-center overflow-hidden"
      initial={{ opacity: 1 }}
      animate={{ opacity: done ? 0 : 1 }}
      transition={{ duration: 0.36 }}
      style={{
        background:
          "radial-gradient(circle at 50% 35%, rgba(var(--surface-rgb), 0.6) 0%, var(--bg) 70%)",
      }}
    >
      {/* Soft grid bg */}
      <div
        className="absolute inset-0 opacity-15 pointer-events-none"
        style={{
          background:
            "repeating-linear-gradient(0deg, transparent 0 38px, rgba(var(--fg-rgb), 0.08) 38px 40px), repeating-linear-gradient(90deg, transparent 0 38px, rgba(var(--fg-rgb), 0.08) 38px 40px)",
        }}
      />

      {/* Concentric pulse rings behind logo */}
      <div className="relative flex items-center justify-center mb-8" style={{ width: 280, height: 280 }}>
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="absolute rounded-none"
            style={{
              width: 160,
              height: 160,
              border: "2px solid var(--accent)",
              opacity: 0.18 - i * 0.04,
            }}
            initial={{ scale: 0.6 }}
            animate={{ scale: [0.6, 1.4, 0.6], opacity: [0.0, 0.4, 0.0] }}
            transition={{ duration: 2.2, repeat: Infinity, delay: i * 0.6, ease: "easeOut" }}
          />
        ))}

        <motion.div
          initial={{ scale: 0.5, opacity: 0, rotate: -6 }}
          animate={{ scale: done ? 1.25 : 1, opacity: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 16 }}
        >
          <Logo size={128} withText={false} />
        </motion.div>
      </div>

      <motion.div
        className="font-pixel tracking-widest mb-1"
        style={{ color: "var(--fg)", fontSize: 24 }}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        DEL<span style={{ color: "var(--accent)" }}>OS</span>
      </motion.div>
      <motion.div
        className="font-mono mb-7"
        style={{ color: "var(--muted)", fontSize: 11, letterSpacing: "0.18em" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
      >
        agents that flow under pressure
      </motion.div>

      {/* Progress bar */}
      <div
        className="w-[360px] max-w-[86vw] h-1 mb-5 overflow-hidden relative"
        style={{ background: "rgba(var(--fg-rgb), 0.08)", borderRadius: 1 }}
      >
        <motion.div
          className="h-full"
          style={{
            width: `${pct}%`,
            background: "linear-gradient(90deg, var(--accent-2, var(--accent)), var(--accent))",
            boxShadow: "0 0 12px var(--ring)",
          }}
          transition={{ duration: 0.18 }}
        />
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
                {checked ? "✓" : active ? "·" : " "}
              </span>
              <span style={{ flex: 1 }}>{s.l}</span>
              {checked && <span style={{ opacity: 0.5 }}>ok</span>}
            </motion.div>
          );
        })}
      </div>

      <div className="absolute bottom-5 left-0 right-0 flex justify-center items-center gap-3 font-mono text-[9px]" style={{ color: "var(--muted)", letterSpacing: "0.2em" }}>
        <span>v2.1</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span>powered by hydradb</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span>{Math.round(pct)}%</span>
      </div>
    </motion.div>
  );
}
