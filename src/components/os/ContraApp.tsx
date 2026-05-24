"use client";
import { useEffect, useRef, useState } from "react";
import * as Icons from "lucide-react";

// Contra · DelOS Arcade tribute
// Pure-canvas side-scrolling run-n-gun. Pays homage to clear-code-projects'
// pygame Contra (https://github.com/clear-code-projects/Contra) but ships as
// a tiny in-browser playable so judges can fire shots, dodge enemies, and
// rack a score without leaving the OS. Native pygame port still lives in
// the Tauri build queue.

type Bullet = { x: number; y: number; vx: number };
type Enemy = { x: number; y: number; w: number; h: number; hp: number; vx: number };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; color: string };

const W = 520;
const H = 280;
const GROUND = H - 36;
const PLAYER_W = 18;
const PLAYER_H = 28;
const GRAVITY = 0.7;

export function ContraApp() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef({
    px: 60,
    py: GROUND - PLAYER_H,
    vy: 0,
    onGround: true,
    facing: 1 as 1 | -1,
    bullets: [] as Bullet[],
    enemies: [] as Enemy[],
    parts: [] as Particle[],
    score: 0,
    hp: 5,
    spawnT: 0,
    over: false,
    paused: false,
    keys: new Set<string>(),
    t: 0,
  });
  const [stats, setStats] = useState({ score: 0, hp: 5, over: false, paused: false });
  const [highScore, setHighScore] = useState(0);

  useEffect(() => {
    try {
      const v = Number(localStorage.getItem("delos.contra.hi") || 0);
      if (Number.isFinite(v)) setHighScore(v);
    } catch {}
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const s = stateRef.current;

    function onKey(e: KeyboardEvent) {
      // Don't hijack the OS while a text input is focused.
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.type === "keydown") s.keys.add(e.key);
      else s.keys.delete(e.key);
      if (e.type === "keydown" && [" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) e.preventDefault();
      if (e.type === "keydown" && e.key.toLowerCase() === "p") {
        s.paused = !s.paused;
        setStats((p) => ({ ...p, paused: s.paused }));
      }
      if (e.type === "keydown" && e.key.toLowerCase() === "r" && s.over) {
        reset();
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);

    function reset() {
      s.px = 60;
      s.py = GROUND - PLAYER_H;
      s.vy = 0;
      s.onGround = true;
      s.facing = 1;
      s.bullets = [];
      s.enemies = [];
      s.parts = [];
      s.score = 0;
      s.hp = 5;
      s.spawnT = 0;
      s.over = false;
      s.paused = false;
      s.t = 0;
      setStats({ score: 0, hp: 5, over: false, paused: false });
    }

    let lastShot = 0;
    function shoot() {
      const now = performance.now();
      if (now - lastShot < 140) return;
      lastShot = now;
      s.bullets.push({
        x: s.px + (s.facing === 1 ? PLAYER_W : 0),
        y: s.py + 10,
        vx: 8 * s.facing,
      });
    }

    function spawnEnemy() {
      const fromRight = Math.random() < 0.5;
      const x = fromRight ? W + 10 : -22;
      const w = 18;
      const h = 24;
      const vx = (fromRight ? -1 : 1) * (1.2 + Math.random() * 0.8);
      const hp = 1 + Math.floor(s.t / 1800);
      s.enemies.push({ x, y: GROUND - h, w, h, hp, vx });
    }

    function burst(x: number, y: number, color: string) {
      for (let i = 0; i < 12; i++) {
        s.parts.push({
          x,
          y,
          vx: (Math.random() - 0.5) * 4,
          vy: (Math.random() - 0.5) * 4 - 1,
          life: 28 + Math.random() * 12,
          color,
        });
      }
    }

    let raf = 0;
    function frame() {
      raf = requestAnimationFrame(frame);
      if (s.paused || s.over) {
        draw();
        return;
      }
      s.t += 1;

      // Movement
      const speed = 2.5;
      if (s.keys.has("ArrowLeft") || s.keys.has("a")) {
        s.px -= speed;
        s.facing = -1;
      }
      if (s.keys.has("ArrowRight") || s.keys.has("d")) {
        s.px += speed;
        s.facing = 1;
      }
      if ((s.keys.has(" ") || s.keys.has("ArrowUp") || s.keys.has("w")) && s.onGround) {
        s.vy = -11;
        s.onGround = false;
      }
      s.vy += GRAVITY;
      s.py += s.vy;
      if (s.py >= GROUND - PLAYER_H) {
        s.py = GROUND - PLAYER_H;
        s.vy = 0;
        s.onGround = true;
      }
      if (s.px < 4) s.px = 4;
      if (s.px + PLAYER_W > W - 4) s.px = W - 4 - PLAYER_W;
      if (s.keys.has("x") || s.keys.has("z") || s.keys.has("Enter")) shoot();

      // Bullets
      for (const b of s.bullets) b.x += b.vx;
      s.bullets = s.bullets.filter((b) => b.x > -10 && b.x < W + 10);

      // Spawn enemies — faster pace as time progresses
      s.spawnT -= 1;
      if (s.spawnT <= 0) {
        spawnEnemy();
        s.spawnT = Math.max(36, 110 - Math.floor(s.t / 80));
      }

      // Enemies
      for (const e of s.enemies) e.x += e.vx;
      // Player hit
      for (const e of s.enemies) {
        if (
          s.px < e.x + e.w &&
          s.px + PLAYER_W > e.x &&
          s.py < e.y + e.h &&
          s.py + PLAYER_H > e.y
        ) {
          s.hp -= 1;
          burst(s.px + 8, s.py + 14, "#FF5577");
          e.hp = 0;
          if (s.hp <= 0) {
            s.over = true;
            try {
              const hi = Math.max(highScore, s.score);
              localStorage.setItem("delos.contra.hi", String(hi));
              if (hi !== highScore) setHighScore(hi);
            } catch {}
          }
        }
      }
      // Bullet ↔ enemy
      for (const b of s.bullets) {
        for (const e of s.enemies) {
          if (e.hp <= 0) continue;
          if (b.x > e.x && b.x < e.x + e.w && b.y > e.y && b.y < e.y + e.h) {
            e.hp -= 1;
            b.x = -9999;
            if (e.hp <= 0) {
              s.score += 10;
              burst(e.x + e.w / 2, e.y + e.h / 2, "#FFD60A");
            } else {
              burst(b.x, b.y, "#5DE6FF");
            }
          }
        }
      }
      s.enemies = s.enemies.filter((e) => e.hp > 0 && e.x > -40 && e.x < W + 40);
      s.bullets = s.bullets.filter((b) => b.x > -10 && b.x < W + 10);

      // Particles
      for (const p of s.parts) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.15;
        p.life -= 1;
      }
      s.parts = s.parts.filter((p) => p.life > 0);

      // Push stats infrequently to avoid React thrash.
      if (s.t % 6 === 0) {
        setStats({ score: s.score, hp: s.hp, over: s.over, paused: s.paused });
      }

      draw();
    }

    function draw() {
      if (!ctx) return;
      // Sky
      ctx.fillStyle = "#07070B";
      ctx.fillRect(0, 0, W, H);
      // Stars
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = i % 5 === 0 ? "#5DE6FF" : "#3A3A55";
        const sx = (i * 73 + Math.floor(s.t * 0.4)) % W;
        ctx.fillRect(sx, (i * 13) % (GROUND - 20), 2, 2);
      }
      // Ground (yellow strip + dark soil)
      ctx.fillStyle = "#15151F";
      ctx.fillRect(0, GROUND, W, H - GROUND);
      ctx.fillStyle = "#FFD60A";
      ctx.fillRect(0, GROUND - 2, W, 2);
      // Distant pillars
      ctx.fillStyle = "#1C1C28";
      for (let i = 0; i < 6; i++) {
        const px = (i * 110 - Math.floor(s.t * 0.6)) % (W + 80) - 40;
        ctx.fillRect(px, GROUND - 40, 18, 40);
      }
      // Player
      ctx.fillStyle = "#FFD60A";
      ctx.fillRect(s.px, s.py, PLAYER_W, PLAYER_H);
      // Gun
      ctx.fillStyle = "#5DE6FF";
      ctx.fillRect(s.px + (s.facing === 1 ? PLAYER_W : -6), s.py + 12, 6, 4);
      // Bullets
      ctx.fillStyle = "#FFFFFF";
      for (const b of s.bullets) ctx.fillRect(b.x, b.y, 4, 3);
      // Enemies
      ctx.fillStyle = "#FF5577";
      for (const e of s.enemies) {
        ctx.fillRect(e.x, e.y, e.w, e.h);
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(e.x + 4, e.y + 6, 3, 3);
        ctx.fillRect(e.x + e.w - 7, e.y + 6, 3, 3);
        ctx.fillStyle = "#FF5577";
      }
      // Particles
      for (const p of s.parts) {
        ctx.globalAlpha = Math.max(0, p.life / 40);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, 3, 3);
      }
      ctx.globalAlpha = 1;

      // HUD
      ctx.font = "bold 11px 'JetBrains Mono', monospace";
      ctx.fillStyle = "#FFD60A";
      ctx.fillText(`SCORE ${s.score.toString().padStart(5, "0")}`, 8, 16);
      ctx.fillStyle = "#5DE6FF";
      ctx.fillText(`HI ${highScore.toString().padStart(5, "0")}`, W - 90, 16);
      ctx.fillStyle = "#FF5577";
      ctx.fillText(`HP ${"♥".repeat(Math.max(0, s.hp))}`, W / 2 - 30, 16);

      if (s.paused) overlay(ctx, "PAUSED · P to resume");
      if (s.over) overlay(ctx, `GAME OVER · score ${s.score} · R to restart`);
    }

    function overlay(c: CanvasRenderingContext2D, msg: string) {
      c.fillStyle = "rgba(7, 7, 11, 0.82)";
      c.fillRect(0, H / 2 - 28, W, 56);
      c.font = "bold 14px 'JetBrains Mono', monospace";
      c.fillStyle = "#FFD60A";
      c.textAlign = "center";
      c.fillText(msg, W / 2, H / 2 + 5);
      c.textAlign = "start";
    }

    frame();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function restart() {
    const s = stateRef.current;
    s.px = 60;
    s.py = GROUND - PLAYER_H;
    s.vy = 0;
    s.onGround = true;
    s.facing = 1;
    s.bullets = [];
    s.enemies = [];
    s.parts = [];
    s.score = 0;
    s.hp = 5;
    s.spawnT = 0;
    s.over = false;
    s.paused = false;
    s.t = 0;
    setStats({ score: 0, hp: 5, over: false, paused: false });
  }
  function togglePause() {
    const s = stateRef.current;
    s.paused = !s.paused;
    setStats((p) => ({ ...p, paused: s.paused }));
  }

  return (
    <div className="p-3 space-y-2 text-xs" style={{ minHeight: 360 }}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Icons.Crosshair size={14} color="var(--accent)" />
          <span className="font-pixel text-sm tracking-wider" style={{ color: "var(--accent)" }}>
            ★ CONTRA · DELOS ARCADE
          </span>
          <span className="pill pill-muted" style={{ fontSize: 9 }}>
            tribute to clear-code-projects/Contra
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="pill pill-info" style={{ fontSize: 9 }}>
            SCORE {String(stats.score).padStart(5, "0")}
          </span>
          <span className="pill pill-bad" style={{ fontSize: 9 }}>HP {stats.hp}</span>
          <button onClick={togglePause} className="pill pill-muted cursor-pointer" style={{ fontSize: 9 }}>
            {stats.paused ? "▶ PLAY" : "❚❚ PAUSE"}
          </button>
          <button onClick={restart} className="pill pill-warn cursor-pointer" style={{ fontSize: 9 }}>
            ↻ RESTART
          </button>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        tabIndex={0}
        style={{
          width: "100%",
          maxWidth: W,
          imageRendering: "pixelated",
          background: "#07070B",
          border: "2px solid var(--surface-2)",
          outline: "none",
        }}
      />

      <div className="grid grid-cols-2 gap-1 font-mono text-[10px]" style={{ color: "var(--muted)" }}>
        <div>← → / A D · move</div>
        <div>SPACE / ↑ / W · jump</div>
        <div>X · Z · ENTER · shoot</div>
        <div>P · pause · R · restart</div>
      </div>

      <p className="font-mono text-[10px]" style={{ color: "var(--muted)" }}>
        Native pygame port (clear-code-projects/Contra) ships with the Tauri build of DelOS. This in-browser tribute is the demo-day arcade entry — high score saved locally.
      </p>
    </div>
  );
}
