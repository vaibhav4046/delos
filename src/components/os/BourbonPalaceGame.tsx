"use client";
import { useEffect, useRef, useState } from "react";

// Bourbon Palace · original retrofuturistic arcade.
//
// Knight-class avatar runs through a neon palace, collecting prisms while
// dodging laser turrets and patrolling sentries. Pixelated 4K render via
// image-rendering: pixelated on a low-res canvas scaled up. Pure original
// art — no third-party sprite assets, no derivative level design.
//
// Controls
//   ←/→ or A/D · move
//   ↑/W or Space · jump (variable height: hold for higher)
//   ↓/S · crouch (smaller hitbox)
//   R · restart
// Game loop · 60Hz via requestAnimationFrame. Physics: integer pixel
// movement on a virtual 320×180 grid scaled to canvas size.

type Vec = { x: number; y: number };

type Player = {
  pos: Vec;
  vel: Vec;
  onGround: boolean;
  facing: 1 | -1;
  hp: number;
  invuln: number;
  crouching: boolean;
  walkCycle: number;
};

type Prism = { x: number; y: number; collected: boolean; pulse: number };

type Turret = { x: number; y: number; cooldown: number };

type Bullet = { x: number; y: number; vx: number };

type Sentry = { x: number; y: number; dir: 1 | -1; speed: number };

const W = 320;
const H = 180;
const GRAVITY = 0.32;
const JUMP_V = -5.3;
const MOVE_SPEED = 1.6;
const GROUND_Y = 156;

export function BourbonPalaceGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [score, setScore] = useState(0);
  const [hp, setHp] = useState(3);
  const [gameOver, setGameOver] = useState(false);
  const [win, setWin] = useState(false);
  const [paused, setPaused] = useState(false);
  const [running, setRunning] = useState(false);

  // Refs hold mutable game state — avoids re-render storm on 60fps tick.
  const playerRef = useRef<Player>({
    pos: { x: 24, y: GROUND_Y - 14 },
    vel: { x: 0, y: 0 },
    onGround: true,
    facing: 1,
    hp: 3,
    invuln: 0,
    crouching: false,
    walkCycle: 0,
  });
  const prismsRef = useRef<Prism[]>([]);
  const turretsRef = useRef<Turret[]>([]);
  const sentriesRef = useRef<Sentry[]>([]);
  const bulletsRef = useRef<Bullet[]>([]);
  const cameraRef = useRef({ x: 0 });
  const keysRef = useRef<Set<string>>(new Set());
  const tickRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const pausedRef = useRef(false);

  // Initial level layout · 8 prisms scattered, 3 turrets, 2 sentries.
  function resetLevel() {
    playerRef.current = {
      pos: { x: 24, y: GROUND_Y - 14 },
      vel: { x: 0, y: 0 },
      onGround: true,
      facing: 1,
      hp: 3,
      invuln: 0,
      crouching: false,
      walkCycle: 0,
    };
    prismsRef.current = [
      { x: 90, y: 140, collected: false, pulse: 0 },
      { x: 150, y: 122, collected: false, pulse: 0.3 },
      { x: 220, y: 140, collected: false, pulse: 0.6 },
      { x: 300, y: 100, collected: false, pulse: 0.9 },
      { x: 400, y: 140, collected: false, pulse: 1.2 },
      { x: 480, y: 80, collected: false, pulse: 1.5 },
      { x: 560, y: 140, collected: false, pulse: 1.8 },
      { x: 660, y: 122, collected: false, pulse: 2.1 },
    ];
    turretsRef.current = [
      { x: 200, y: GROUND_Y - 14, cooldown: 90 },
      { x: 380, y: GROUND_Y - 14, cooldown: 150 },
      { x: 560, y: GROUND_Y - 14, cooldown: 60 },
    ];
    sentriesRef.current = [
      { x: 320, y: GROUND_Y - 12, dir: 1, speed: 0.7 },
      { x: 600, y: GROUND_Y - 12, dir: -1, speed: 0.9 },
    ];
    bulletsRef.current = [];
    cameraRef.current.x = 0;
    tickRef.current = 0;
    setScore(0);
    setHp(3);
    setGameOver(false);
    setWin(false);
  }

  function start() {
    setRunning(true);
    setPaused(false);
    pausedRef.current = false;
    resetLevel();
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      keysRef.current.add(e.key.toLowerCase());
      if (e.key.toLowerCase() === "r") resetLevel();
      if (e.key.toLowerCase() === "p") {
        pausedRef.current = !pausedRef.current;
        setPaused(pausedRef.current);
      }
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
    }
    function onKeyUp(e: KeyboardEvent) {
      keysRef.current.delete(e.key.toLowerCase());
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useEffect(() => {
    if (!running) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    function tick() {
      if (!pausedRef.current && !gameOver && !win) update();
      render();
      frameRef.current = requestAnimationFrame(tick);
    }

    function update() {
      tickRef.current += 1;
      const p = playerRef.current;
      const keys = keysRef.current;
      const left = keys.has("arrowleft") || keys.has("a");
      const right = keys.has("arrowright") || keys.has("d");
      const jump = keys.has("arrowup") || keys.has("w") || keys.has(" ");
      const crouch = keys.has("arrowdown") || keys.has("s");

      // Horizontal motion
      if (left) { p.vel.x = -MOVE_SPEED; p.facing = -1; }
      else if (right) { p.vel.x = MOVE_SPEED; p.facing = 1; }
      else p.vel.x *= 0.78;

      // Jump · variable height (release early to cut jump short).
      if (jump && p.onGround) {
        p.vel.y = JUMP_V;
        p.onGround = false;
      }
      if (!jump && p.vel.y < -2) p.vel.y *= 0.92;

      p.crouching = crouch && p.onGround;

      // Gravity
      p.vel.y += GRAVITY;
      if (p.vel.y > 6) p.vel.y = 6;

      // Apply
      p.pos.x += p.vel.x;
      p.pos.y += p.vel.y;

      // Ground collision
      const playerH = p.crouching ? 8 : 14;
      if (p.pos.y >= GROUND_Y - playerH) {
        p.pos.y = GROUND_Y - playerH;
        p.vel.y = 0;
        p.onGround = true;
      }

      // World bounds (scrolling level)
      if (p.pos.x < 8) p.pos.x = 8;
      if (p.pos.x > 720) p.pos.x = 720;

      // Walk cycle for sprite frame
      if (Math.abs(p.vel.x) > 0.4 && p.onGround) p.walkCycle += 0.18;

      // Camera follows player (with deadzone)
      const target = Math.max(0, Math.min(720 - W, p.pos.x - W / 2));
      cameraRef.current.x += (target - cameraRef.current.x) * 0.12;

      if (p.invuln > 0) p.invuln -= 1;

      // Prisms
      for (const pr of prismsRef.current) {
        if (pr.collected) continue;
        pr.pulse += 0.08;
        if (Math.abs(pr.x - p.pos.x) < 9 && Math.abs(pr.y - p.pos.y) < 12) {
          pr.collected = true;
          setScore((s) => s + 100);
        }
      }

      // Turrets fire periodically
      for (const t of turretsRef.current) {
        t.cooldown -= 1;
        if (t.cooldown <= 0) {
          t.cooldown = 120 + Math.floor(Math.random() * 60);
          // Fire toward player if in range (320px line of sight)
          const dx = p.pos.x - t.x;
          if (Math.abs(dx) < 220) {
            bulletsRef.current.push({ x: t.x, y: t.y - 4, vx: dx > 0 ? 2.4 : -2.4 });
          }
        }
      }

      // Sentry patrols
      for (const s of sentriesRef.current) {
        s.x += s.dir * s.speed;
        if (s.x < 240 || s.x > 720) s.dir = (-s.dir) as 1 | -1;
        // Collision with player
        if (Math.abs(s.x - p.pos.x) < 8 && Math.abs(s.y - p.pos.y) < 12 && p.invuln === 0) {
          p.hp -= 1;
          p.invuln = 60;
          setHp(p.hp);
          p.vel.x = -p.facing * 3;
          p.vel.y = -2.4;
          if (p.hp <= 0) setGameOver(true);
        }
      }

      // Bullets
      for (const b of bulletsRef.current) {
        b.x += b.vx;
        if (Math.abs(b.x - p.pos.x) < 5 && Math.abs(b.y - p.pos.y) < 10 && p.invuln === 0) {
          p.hp -= 1;
          p.invuln = 60;
          setHp(p.hp);
          if (p.hp <= 0) setGameOver(true);
        }
      }
      bulletsRef.current = bulletsRef.current.filter((b) => b.x > -10 && b.x < 740);

      // Win condition
      if (prismsRef.current.every((pr) => pr.collected)) setWin(true);
    }

    function render() {
      // Sky gradient · deep magenta to neon cyan band
      const grad = ctx!.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, "#1a0026");
      grad.addColorStop(0.6, "#2d0050");
      grad.addColorStop(1, "#10092a");
      ctx!.fillStyle = grad;
      ctx!.fillRect(0, 0, W, H);

      const camX = cameraRef.current.x;

      // Far parallax · neon palace silhouette
      ctx!.fillStyle = "#3a0a5e";
      for (let i = 0; i < 10; i++) {
        const px = (i * 90 - camX * 0.3) % (W + 90);
        ctx!.fillRect(px, 80, 60, 76);
        ctx!.fillRect(px + 20, 60, 24, 20);
      }

      // Mid parallax · pillars
      ctx!.fillStyle = "#5e0a8f";
      for (let i = 0; i < 8; i++) {
        const px = (i * 130 - camX * 0.6) % (W + 130);
        ctx!.fillRect(px, 100, 14, 56);
        ctx!.fillStyle = "#7a17b0";
        ctx!.fillRect(px - 2, 96, 18, 6);
        ctx!.fillStyle = "#5e0a8f";
      }

      // Floor · gridded
      ctx!.fillStyle = "#0e0327";
      ctx!.fillRect(0, GROUND_Y, W, H - GROUND_Y);
      ctx!.strokeStyle = "#7a17b0";
      ctx!.lineWidth = 1;
      for (let x = 0; x < 40; x++) {
        const sx = (x * 16 - camX) % (W + 32);
        ctx!.beginPath();
        ctx!.moveTo(sx, GROUND_Y);
        ctx!.lineTo(sx, H);
        ctx!.stroke();
      }

      // Prisms · pulsing octahedrons
      for (const pr of prismsRef.current) {
        if (pr.collected) continue;
        const sx = pr.x - camX;
        if (sx < -10 || sx > W + 10) continue;
        const wobble = Math.sin(pr.pulse) * 2;
        const sy = pr.y + wobble;
        ctx!.fillStyle = "#ffd83a";
        ctx!.beginPath();
        ctx!.moveTo(sx, sy - 5);
        ctx!.lineTo(sx + 4, sy);
        ctx!.lineTo(sx, sy + 5);
        ctx!.lineTo(sx - 4, sy);
        ctx!.closePath();
        ctx!.fill();
        ctx!.fillStyle = "rgba(255,216,58,0.3)";
        ctx!.beginPath();
        ctx!.arc(sx, sy, 8, 0, Math.PI * 2);
        ctx!.fill();
      }

      // Turrets
      for (const t of turretsRef.current) {
        const sx = t.x - camX;
        if (sx < -16 || sx > W + 16) continue;
        ctx!.fillStyle = "#22d3ee";
        ctx!.fillRect(sx - 5, t.y - 2, 10, 16);
        ctx!.fillStyle = "#ff3a8a";
        ctx!.fillRect(sx - 3, t.y - 5, 6, 5);
      }

      // Sentries · drone-style
      for (const s of sentriesRef.current) {
        const sx = s.x - camX;
        if (sx < -10 || sx > W + 10) continue;
        ctx!.fillStyle = "#ff3a8a";
        ctx!.fillRect(sx - 4, s.y - 6, 8, 8);
        ctx!.fillStyle = "#fff";
        ctx!.fillRect(sx - 2, s.y - 4, 4, 2);
        ctx!.fillStyle = "#22d3ee";
        ctx!.fillRect(sx - 6, s.y + 1, 12, 2);
      }

      // Bullets
      for (const b of bulletsRef.current) {
        const sx = b.x - camX;
        ctx!.fillStyle = "#ff3a8a";
        ctx!.fillRect(sx - 1, b.y - 1, 3, 2);
        ctx!.fillStyle = "rgba(255,58,138,0.4)";
        ctx!.fillRect(sx - 3, b.y - 1, 2, 2);
      }

      // Player · simple pixel knight
      const p = playerRef.current;
      const psx = p.pos.x - camX;
      const psy = p.pos.y;
      const blink = p.invuln > 0 && tickRef.current % 8 < 4;
      if (!blink) {
        // Body
        ctx!.fillStyle = "#fcd34d";
        if (p.crouching) ctx!.fillRect(psx - 4, psy + 6, 8, 8);
        else ctx!.fillRect(psx - 4, psy, 8, 14);
        // Helmet
        ctx!.fillStyle = "#fbbf24";
        ctx!.fillRect(psx - 4, psy - 2, 8, 4);
        // Eye band
        ctx!.fillStyle = "#000";
        ctx!.fillRect(psx + (p.facing > 0 ? 0 : -3), psy + 1, 3, 1);
        // Boots
        ctx!.fillStyle = "#7c3aed";
        const stepOffset = Math.sin(p.walkCycle) > 0 ? 1 : 0;
        if (p.crouching) {
          ctx!.fillRect(psx - 4, psy + 12, 4, 2);
          ctx!.fillRect(psx + 0, psy + 12, 4, 2);
        } else {
          ctx!.fillRect(psx - 4, psy + 12 + stepOffset, 4, 2);
          ctx!.fillRect(psx + 0, psy + 12 - stepOffset, 4, 2);
        }
        // Cape · purple
        ctx!.fillStyle = "#a855f7";
        ctx!.fillRect(psx + (p.facing > 0 ? -6 : 2), psy + 2, 4, 8);
      }

      // CRT scanline overlay (subtle)
      ctx!.fillStyle = "rgba(0,0,0,0.08)";
      for (let y = 0; y < H; y += 2) ctx!.fillRect(0, y, W, 1);
    }

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [running, gameOver, win]);

  return (
    <div style={{ padding: 10, height: "100%", display: "flex", flexDirection: "column", gap: 8, background: "#08051a", color: "#fcd34d", fontFamily: "var(--font-pixel)" }}>
      {/* HUD */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 8px", border: "2px solid #5e0a8f", background: "#1a0026" }}>
        <div style={{ fontSize: 11, letterSpacing: "0.08em" }}>★ BOURBON PALACE</div>
        <div style={{ display: "flex", gap: 12, fontSize: 11, letterSpacing: "0.06em" }}>
          <span>SCORE <span style={{ color: "#22d3ee" }}>{String(score).padStart(5, "0")}</span></span>
          <span>HP {"♥".repeat(hp)}{"♡".repeat(Math.max(0, 3 - hp))}</span>
          <span style={{ color: paused ? "#ff3a8a" : "#22d3ee" }}>{paused ? "PAUSED" : "PLAY"}</span>
        </div>
      </div>

      {/* Canvas wrapper · scales the 320×180 grid 2× for crisp pixels */}
      <div style={{ flex: 1, display: "grid", placeItems: "center", background: "radial-gradient(ellipse at center, #1a0026 0%, #08051a 100%)", border: "2px solid #5e0a8f", overflow: "hidden" }}>
        {running ? (
          <canvas
            ref={canvasRef}
            width={W}
            height={H}
            style={{
              width: "100%",
              maxWidth: 640,
              aspectRatio: `${W}/${H}`,
              imageRendering: "pixelated" as const,
              outline: "1px solid #7a17b0",
              filter: "drop-shadow(0 0 12px rgba(168,85,247,0.5))",
            }}
            tabIndex={0}
          />
        ) : (
          <div style={{ textAlign: "center", color: "#fcd34d" }}>
            <div style={{ fontSize: 22, letterSpacing: "0.12em" }}>BOURBON PALACE</div>
            <div style={{ fontSize: 10, color: "#7a17b0", marginTop: 6, letterSpacing: "0.08em" }}>RETROFUTURISTIC · 1 PLAYER · v1.0</div>
            <button onClick={start} style={{ marginTop: 16, background: "#fbbf24", color: "#1a0026", border: "2px solid #fbbf24", padding: "8px 22px", letterSpacing: "0.12em", cursor: "pointer", boxShadow: "3px 3px 0 #7a17b0", fontFamily: "inherit" }}>▶ START</button>
            <div style={{ fontSize: 9, marginTop: 14, color: "#a855f7" }}>← → MOVE  ↑ JUMP  ↓ CROUCH  R RESTART  P PAUSE</div>
          </div>
        )}
      </div>

      {(gameOver || win) && (
        <div style={{ padding: 10, border: "2px solid #ff3a8a", background: "#2d0050", textAlign: "center" }}>
          <div style={{ fontSize: 14, color: win ? "#22d3ee" : "#ff3a8a", letterSpacing: "0.1em" }}>{win ? "★ PALACE LIBERATED" : "GAME OVER"}</div>
          <div style={{ fontSize: 11, marginTop: 4 }}>Final score · {score}</div>
          <button onClick={start} style={{ marginTop: 8, background: "#fbbf24", color: "#1a0026", border: "none", padding: "6px 16px", letterSpacing: "0.08em", cursor: "pointer", fontFamily: "inherit" }}>▶ PLAY AGAIN</button>
        </div>
      )}
    </div>
  );
}
