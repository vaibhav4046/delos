"use client";
import { useEffect, useState } from "react";
import * as Icons from "lucide-react";

const AGENTS_BASE = [
  { id: "planner", icon: "Brain", label: "Planner", color: "var(--accent)", rRatio: 0.262, speed: 0.45, phase: 0 },
  { id: "executor", icon: "Cpu", label: "Executor", color: "var(--success)", rRatio: 0.262, speed: 0.45, phase: Math.PI * 0.5 },
  { id: "critic", icon: "Eye", label: "Critic", color: "var(--warn)", rRatio: 0.262, speed: 0.45, phase: Math.PI },
  { id: "memory", icon: "Database", label: "Memory", color: "var(--pipe)", rRatio: 0.262, speed: 0.45, phase: Math.PI * 1.5 },
  { id: "tooler", icon: "Wrench", label: "Tooler", color: "var(--danger)", rRatio: 0.405, speed: 0.28, phase: Math.PI * 0.25 },
  { id: "voice", icon: "Mic", label: "Voice", color: "var(--accent-2)", rRatio: 0.405, speed: 0.28, phase: Math.PI * 1.25 },
];

export function HeroOrbits() {
  const [t, setT] = useState(0);
  const [size, setSize] = useState(420);
  const All = Icons as unknown as Record<string, React.ComponentType<{ size?: number; color?: string }>>;

  useEffect(() => {
    function onResize() {
      const w = typeof window !== "undefined" ? window.innerWidth : 1200;
      setSize(w < 640 ? 280 : w < 1024 ? 340 : 420);
    }
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    function tick(now: number) {
      const dt = (now - last) / 1000;
      last = now;
      setT((v) => v + dt);
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const SIZE = size;
  const CENTER = SIZE / 2;
  const AGENTS = AGENTS_BASE.map((a) => ({ ...a, radius: Math.round(SIZE * a.rRatio) }));
  const iconSize = SIZE >= 380 ? 40 : SIZE >= 300 ? 32 : 28;
  const halfIcon = iconSize / 2;
  const coreSize = SIZE >= 380 ? 60 : 44;
  const halfCore = coreSize / 2;

  return (
    <div
      className="relative mx-auto"
      style={{ width: SIZE, height: SIZE, maxWidth: "100%" }}
      aria-hidden
    >
      {/* Concentric orbit rings */}
      <svg width={SIZE} height={SIZE} className="absolute inset-0" style={{ opacity: 0.25 }}>
        <circle cx={CENTER} cy={CENTER} r={Math.round(SIZE * 0.262)} fill="none" stroke="var(--accent)" strokeWidth="1" strokeDasharray="3 4" />
        <circle cx={CENTER} cy={CENTER} r={Math.round(SIZE * 0.405)} fill="none" stroke="var(--accent)" strokeWidth="1" strokeDasharray="3 4" />
      </svg>

      {/* Center: pulsing core */}
      <div
        className="absolute"
        style={{
          left: CENTER - halfCore,
          top: CENTER - halfCore,
          width: coreSize,
          height: coreSize,
          background: "var(--accent)",
          border: "3px solid var(--bg)",
          boxShadow: "0 0 0 2px var(--accent), 0 0 32px var(--ring)",
          animation: "heroPulse 2.4s ease-in-out infinite",
        }}
      />
      <div
        className="absolute flex items-center justify-center font-pixel text-sm tracking-widest"
        style={{
          left: CENTER - halfCore,
          top: CENTER - halfCore,
          width: coreSize,
          height: coreSize,
          color: "var(--on-accent)",
          zIndex: 2,
        }}
      >
        OS
      </div>

      {/* Connecting beams from core to each agent */}
      <svg width={SIZE} height={SIZE} className="absolute inset-0 pointer-events-none">
        {AGENTS.map((a) => {
          const angle = t * a.speed + a.phase;
          const ax = CENTER + Math.cos(angle) * a.radius;
          const ay = CENTER + Math.sin(angle) * a.radius;
          const opacity = 0.15 + 0.25 * Math.abs(Math.sin(t * 2 + a.phase));
          return (
            <line
              key={a.id}
              x1={CENTER}
              y1={CENTER}
              x2={ax}
              y2={ay}
              stroke="var(--accent)"
              strokeWidth="1"
              opacity={opacity}
            />
          );
        })}
      </svg>

      {/* Orbiting agents */}
      {AGENTS.map((a) => {
        const angle = t * a.speed + a.phase;
        const ax = CENTER + Math.cos(angle) * a.radius;
        const ay = CENTER + Math.sin(angle) * a.radius;
        const Cmp = All[a.icon] ?? Icons.Cpu;
        return (
          <div
            key={a.id}
            className="absolute"
            style={{
              left: ax - halfIcon,
              top: ay - halfIcon,
              width: iconSize,
              height: iconSize,
              background: "var(--surface)",
              border: `2px solid ${a.color}`,
              boxShadow: `2px 2px 0 var(--shadow), 0 0 12px ${a.color}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "none",
            }}
          >
            <Cmp size={Math.round(iconSize * 0.45)} color={a.color} />
          </div>
        );
      })}
    </div>
  );
}
