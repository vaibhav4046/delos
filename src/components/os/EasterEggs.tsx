"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

// Konami code unlocks "god-mode" toast + theme tweak.
// :matrix triggers green rain canvas overlay 30s.
// :varun shows Antigravity I/O homage banner.
// :doom dispatches voice-action to open Doom app.

const KONAMI = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
];

export function EasterEggs() {
  const [matrix, setMatrix] = useState(false);
  const [varun, setVarun] = useState(false);
  const [god, setGod] = useState(false);

  useEffect(() => {
    let history: string[] = [];
    function onKey(e: KeyboardEvent) {
      history.push(e.key);
      history = history.slice(-KONAMI.length);
      if (history.length === KONAMI.length && history.every((k, i) => k === KONAMI[i])) {
        setGod(true);
        window.dispatchEvent(new CustomEvent("toast", { detail: { text: "★ GOD MODE unlocked — type :varun in Terminal", tone: "ok" } }));
        setTimeout(() => setGod(false), 6000);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    function onCmd(e: Event) {
      const d = (e as CustomEvent<{ cmd: string }>).detail;
      if (!d) return;
      if (d.cmd === ":matrix") {
        setMatrix(true);
        setTimeout(() => setMatrix(false), 30_000);
      } else if (d.cmd === ":varun") {
        setVarun(true);
        setTimeout(() => setVarun(false), 12_000);
      } else if (d.cmd === ":doom") {
        window.dispatchEvent(new CustomEvent("delos-voice-action", { detail: { intent: "open_app", app: "doom" } }));
      } else if (d.cmd === ":god") {
        setGod(true);
        setTimeout(() => setGod(false), 6000);
      }
    }
    window.addEventListener("delos-terminal-cmd", onCmd as EventListener);
    return () => window.removeEventListener("delos-terminal-cmd", onCmd as EventListener);
  }, []);

  return (
    <>
      <AnimatePresence>
        {matrix && <MatrixRain key="matrix" />}
        {varun && <VarunBanner key="varun" />}
        {god && <GodModeFlash key="god" />}
      </AnimatePresence>
    </>
  );
}

function MatrixRain() {
  return (
    <motion.div
      className="fixed inset-0 pointer-events-none z-[9998]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      style={{
        background:
          "linear-gradient(180deg, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.65) 100%)",
        backdropFilter: "blur(2px)",
      }}
    >
      <MatrixCanvas />
      <div
        className="absolute top-4 left-1/2 -translate-x-1/2 pill pill-ok"
        style={{ fontSize: 12, padding: "6px 12px", background: "rgba(0,0,0,0.7)", color: "#33ff33", border: "1px solid #33ff33" }}
      >
        ★ MATRIX MODE · 30s
      </div>
    </motion.div>
  );
}

function MatrixCanvas() {
  useEffect(() => {
    const canvas = document.getElementById("__matrix") as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const fontSize = 14;
    const cols = Math.floor(canvas.width / fontSize);
    const drops = new Array(cols).fill(0);
    const chars = "01アイウエオカキクケコサシスセソタチツテト";
    let raf = 0;
    function tick() {
      if (!ctx || !canvas) return;
      ctx.fillStyle = "rgba(0,0,0,0.06)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#33ff33";
      ctx.font = `${fontSize}px monospace`;
      for (let i = 0; i < drops.length; i++) {
        const ch = chars.charAt(Math.floor(Math.random() * chars.length));
        ctx.fillText(ch, i * fontSize, drops[i] * fontSize);
        if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas id="__matrix" className="absolute inset-0" />;
}

function VarunBanner() {
  return (
    <motion.div
      className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[9999] pointer-events-auto"
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ type: "spring", stiffness: 240, damping: 22 }}
    >
      <div
        className="card-pixel"
        style={{
          background: "rgba(0,0,0,0.92)",
          borderColor: "var(--accent)",
          padding: 28,
          maxWidth: 560,
          boxShadow: "0 0 0 2px var(--bg), 0 0 0 4px var(--accent), 12px 12px 0 var(--shadow), 0 30px 80px rgba(0,0,0,0.6)",
        }}
      >
        <div className="font-pixel text-xs tracking-widest mb-2" style={{ color: "var(--accent)" }}>
          ★ I/O 2026 · ANTIGRAVITY 2.0 CALLBACK
        </div>
        <h1 className="font-pixel text-2xl sm:text-3xl mb-4 tracking-wider leading-tight" style={{ color: "var(--fg)" }}>
          93 agents · 12 hours
        </h1>
        <ul className="space-y-1 font-mono text-[12px]" style={{ color: "var(--fg)" }}>
          <li>· 15,000 model requests</li>
          <li>· 2.6B tokens streamed</li>
          <li>· $1,000 total spend</li>
          <li>· Doom running on the new OS</li>
        </ul>
        <p className="mt-4 font-mono text-[10px] leading-relaxed" style={{ color: "var(--muted)" }}>
          inspired by Varun Mohan · Google I/O 2026 keynote · the moment AI-OSes became real.
        </p>
        <p className="mt-3 font-mono text-[10px]" style={{ color: "var(--accent)" }}>
          DelOS is the open substrate.
        </p>
      </div>
    </motion.div>
  );
}

function GodModeFlash() {
  return (
    <motion.div
      className="fixed top-6 left-1/2 -translate-x-1/2 z-[9999] pointer-events-none"
      initial={{ y: -40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -40, opacity: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 22 }}
    >
      <div
        className="card-pixel"
        style={{
          background: "linear-gradient(135deg, var(--accent), var(--danger))",
          color: "var(--bg)",
          padding: "10px 18px",
          fontWeight: 800,
        }}
      >
        <span className="font-pixel text-sm tracking-widest">★ GOD MODE</span>
      </div>
    </motion.div>
  );
}
