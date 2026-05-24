"use client";
import { useEffect, useRef, useState } from "react";
import * as Icons from "lucide-react";

// First-person raycasting shooter — 10 levels, AI enemies, pickups, ammo, score persistence.
// Pointer lock for mouse look. WASD strafe. Click/space shoot.

const W = 480;
const H = 300;
const FOV = Math.PI / 3; // 60 deg
const NUM_RAYS = W; // one ray per column
const MAX_DEPTH = 18;
const STEP_SIZE = 0.05;
const PLAYER_SPEED = 0.045;
const ROT_SPEED = 0.035;

// Tile codes:
//   0 = empty
//   1 = stone wall (gray)
//   2 = brick wall (red)
//   3 = exit (green glow)
//   4 = gold wall (yellow)
//   5 = pillar (dark)
const LEVELS: number[][][] = [
  // Level 1 — gentle intro
  [
    [1,1,1,1,1,1,1,1,1,1,1,1],
    [1,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,2,2,0,0,0,0,1],
    [1,0,0,1,0,0,0,0,1,0,0,1],
    [1,0,0,1,0,0,0,0,1,0,0,1],
    [1,0,0,0,0,2,2,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,1,0,0,0,0,0,0,1,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,3,1],
    [1,1,1,1,1,1,1,1,1,1,1,1],
  ],
  // Level 2 — long corridor
  [
    [1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,2,2,2,0,1,1,1,0,2,0,1],
    [1,0,0,0,0,0,0,0,0,0,2,0,1],
    [1,0,1,1,1,1,0,1,1,1,1,0,1],
    [1,0,0,0,0,1,0,0,0,0,0,0,1],
    [1,1,1,1,0,1,1,1,1,1,1,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,2,2,0,0,2,2,0,1],
    [1,0,0,0,0,0,0,0,0,0,3,0,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1],
  ],
  // Level 3 — maze
  [
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,0,0,0,1,0,0,0,0,0,0,0,0,1],
    [1,0,1,0,1,0,1,1,1,1,1,1,0,1],
    [1,0,1,0,0,0,0,0,0,0,0,1,0,1],
    [1,0,1,1,1,1,1,1,1,1,0,1,0,1],
    [1,0,0,0,0,2,0,0,0,1,0,1,0,1],
    [1,1,1,1,0,1,0,1,0,1,0,1,0,1],
    [1,0,0,0,0,1,0,1,0,0,0,1,0,1],
    [1,0,1,1,1,1,0,1,1,1,1,1,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,3,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  ],
  // Level 4 — open arena
  [
    [1,1,1,1,1,1,1,1,1,1,1,1],
    [1,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,5,0,2,0,0,2,0,5,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,2,0,0,0,0,0,0,2,0,1],
    [1,0,0,0,0,5,5,0,0,0,0,1],
    [1,0,2,0,0,5,5,0,0,2,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,5,0,2,0,0,2,0,5,0,1],
    [1,0,0,0,0,0,0,0,0,0,3,1],
    [1,1,1,1,1,1,1,1,1,1,1,1],
  ],
  // Level 5 — golden halls
  [
    [1,1,1,1,1,1,1,1,1,1,1,1],
    [1,0,4,4,0,0,0,0,4,4,0,1],
    [1,0,0,0,0,4,4,0,0,0,0,1],
    [1,0,4,0,0,0,0,0,0,4,0,1],
    [1,0,4,4,4,0,0,4,4,4,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,4,4,4,0,0,4,4,4,0,1],
    [1,0,4,0,0,0,0,0,0,4,0,1],
    [1,0,0,0,0,4,4,0,0,0,0,1],
    [1,0,4,4,0,0,0,0,4,4,3,1],
    [1,1,1,1,1,1,1,1,1,1,1,1],
  ],
  // Level 6 — twisting spiral
  [
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,1,1,1,1,1,1,1,1,1,1,1,0,1],
    [1,0,1,0,0,0,0,0,0,0,0,0,1,0,1],
    [1,0,1,0,1,1,1,1,1,1,1,0,1,0,1],
    [1,0,1,0,1,0,0,0,0,0,1,0,1,0,1],
    [1,0,1,0,1,0,1,1,1,0,1,0,1,0,1],
    [1,0,1,0,1,0,1,3,1,0,1,0,1,0,1],
    [1,0,1,0,1,0,0,0,1,0,1,0,1,0,1],
    [1,0,1,0,1,1,1,1,1,0,1,0,1,0,1],
    [1,0,1,0,0,0,0,0,0,0,1,0,1,0,1],
    [1,0,1,1,1,1,1,1,1,1,1,0,1,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,1,0,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,0,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  ],
  // Level 7 — pillars of doom
  [
    [1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,5,0,5,0,5,0,5,0,5,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,5,0,2,2,2,2,2,0,5,0,1],
    [1,0,0,0,2,0,0,0,2,0,0,0,1],
    [1,0,5,0,2,0,3,0,2,0,5,0,1],
    [1,0,0,0,2,0,0,0,2,0,0,0,1],
    [1,0,5,0,2,2,2,2,2,0,5,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,5,0,5,0,5,0,5,0,5,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1],
  ],
  // Level 8 — fortress
  [
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,4,4,4,4,1,1,4,4,4,4,0,1],
    [1,0,4,0,0,0,0,0,0,0,0,4,0,1],
    [1,0,4,0,2,2,0,0,2,2,0,4,0,1],
    [1,0,1,0,2,0,0,0,0,2,0,1,0,1],
    [1,0,0,0,0,0,0,3,0,0,0,0,0,1],
    [1,0,1,0,2,0,0,0,0,2,0,1,0,1],
    [1,0,4,0,2,2,0,0,2,2,0,4,0,1],
    [1,0,4,0,0,0,0,0,0,0,0,4,0,1],
    [1,0,4,4,4,4,1,1,4,4,4,4,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  ],
  // Level 9 — narrow death
  [
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,1],
    [1,1,1,0,1,0,1,0,1,0,1,0,1,0,1,1],
    [1,0,0,0,0,0,1,0,0,0,1,0,0,0,0,1],
    [1,0,1,1,1,1,1,0,1,1,1,1,1,1,0,1],
    [1,0,1,0,0,0,0,0,0,0,0,0,0,1,0,1],
    [1,0,1,0,1,1,1,1,1,1,1,1,0,1,0,1],
    [1,0,1,0,1,0,0,0,3,0,0,1,0,1,0,1],
    [1,0,1,0,1,0,1,1,1,1,0,1,0,1,0,1],
    [1,0,1,0,1,0,0,0,0,0,0,1,0,1,0,1],
    [1,0,1,0,1,1,1,1,1,1,1,1,0,1,0,1],
    [1,0,1,0,0,0,0,0,0,0,0,0,0,1,0,1],
    [1,0,1,1,1,1,1,1,1,1,1,1,1,1,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  ],
  // Level 10 — final boss arena
  [
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,2,4,2,4,2,4,2,4,2,4,2,0,1],
    [1,0,4,0,0,0,0,0,0,0,0,0,4,0,1],
    [1,0,2,0,5,0,5,0,5,0,5,0,2,0,1],
    [1,0,4,0,0,0,0,0,0,0,0,0,4,0,1],
    [1,0,2,0,5,0,2,3,2,0,5,0,2,0,1],
    [1,0,4,0,0,0,2,2,2,0,0,0,4,0,1],
    [1,0,2,0,5,0,5,0,5,0,5,0,2,0,1],
    [1,0,4,0,0,0,0,0,0,0,0,0,4,0,1],
    [1,0,2,4,2,4,2,4,2,4,2,4,2,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  ],
];

type EnemyState = "patrol" | "chase" | "shoot" | "hurt" | "dead";
type EnemyType = "imp" | "demon" | "baron" | "caco" | "soldier";
type Enemy = {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  state: EnemyState;
  t: number;
  dx: number;
  dy: number;
  shootCooldown: number;
  hurtTime: number;
  deathTime: number;
  type: EnemyType;
};

type Pickup = { x: number; y: number; type: "health" | "ammo" | "armor"; taken: boolean };

type LevelSpec = {
  map: number[][];
  enemies: Array<{ x: number; y: number; type: Enemy["type"]; hp: number }>;
  pickups: Array<{ x: number; y: number; type: Pickup["type"] }>;
  spawnX: number;
  spawnY: number;
  spawnAngle: number;
  name: string;
};

function buildLevel(idx: number): LevelSpec {
  const map = LEVELS[idx];
  const enemies: LevelSpec["enemies"] = [];
  const pickups: LevelSpec["pickups"] = [];
  const empties: Array<[number, number]> = [];
  for (let y = 1; y < map.length - 1; y++) {
    for (let x = 1; x < map[0].length - 1; x++) {
      if (map[y][x] === 0) empties.push([x, y]);
    }
  }
  // Player spawn — first empty near top-left corner. Compute BEFORE enemy
  // placement so we can sort empties by distance to spawn.
  let sx = 1.5, sy = 1.5;
  outer: for (let y = 1; y < map.length; y++) {
    for (let x = 1; x < map[0].length; x++) {
      if (map[y][x] === 0) { sx = x + 0.5; sy = y + 0.5; break outer; }
    }
  }
  // Deterministic rand per level
  const rand = (seed: number) => {
    let s = seed;
    return () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
  };
  const r = rand(idx * 1000 + 7);
  // Bug fix: enemies were placed in a fully shuffled empties list — so on
  // most levels the entire enemy roster spawned at the far end of the map.
  // Player saw an empty corridor for the first 10+ seconds, then enemies
  // "suddenly appeared" once they patrolled close. Now: place the FIRST
  // two enemies in the closest-to-spawn-but-not-adjacent tiles (visible
  // within a few steps on first render) and shuffle the rest.
  const sorted = [...empties].sort((a, b) => {
    const da = Math.hypot(a[0] + 0.5 - sx, a[1] + 0.5 - sy);
    const db = Math.hypot(b[0] + 0.5 - sx, b[1] + 0.5 - sy);
    return da - db;
  });
  // Skip empties within 2.5 tiles of spawn (avoid spawn-camping the player)
  const nearEnemySlots = sorted.filter(([x, y]) => {
    const d = Math.hypot(x + 0.5 - sx, y + 0.5 - sy);
    return d > 2.5 && d < 9; // sweet spot — visible but not on top of you
  }).slice(0, 2);
  // Remaining empties (excluding picked near slots + the spawn tile)
  const usedKeys = new Set(nearEnemySlots.map(([x, y]) => `${x},${y}`));
  usedKeys.add(`${Math.floor(sx)},${Math.floor(sy)}`);
  const remaining = empties.filter(([x, y]) => !usedKeys.has(`${x},${y}`));
  remaining.sort(() => r() - 0.5);
  const orderedEmpties = [...nearEnemySlots, ...remaining];
  const enemyCount = 3 + idx; // 3..12
  for (let i = 0; i < Math.min(enemyCount, orderedEmpties.length); i++) {
    const [x, y] = orderedEmpties[i];
    let type: EnemyType;
    if (idx >= 9 && i === 0) type = "baron";
    else if (idx >= 6 && i === 1) type = "caco";
    else if (idx >= 4 && i % 4 === 3) type = "soldier";
    else if (i % 3 === 0) type = "demon";
    else type = "imp";
    const hp = type === "baron" ? 8 : type === "caco" ? 5 : type === "demon" ? 4 : type === "soldier" ? 3 : 2;
    enemies.push({ x: x + 0.5, y: y + 0.5, type, hp });
  }
  const pickupCount = Math.max(2, 4 - Math.floor(idx / 3));
  for (let i = 0; i < pickupCount && enemyCount + i < orderedEmpties.length; i++) {
    const [x, y] = orderedEmpties[enemyCount + i];
    const type: Pickup["type"] = i === 0 ? "health" : i === 1 ? "ammo" : "armor";
    pickups.push({ x: x + 0.5, y: y + 0.5, type });
  }
  return {
    map,
    enemies,
    pickups,
    spawnX: sx,
    spawnY: sy,
    spawnAngle: 0,
    name: ["INTRO", "CORRIDOR", "MAZE", "ARENA", "GOLD HALLS", "SPIRAL", "PILLARS", "FORTRESS", "DEATH HALL", "FINAL BOSS"][idx] ?? "?",
  };
}

type SpriteFrames = { idle: string[]; walk: string[]; dead: string[] };
const ENEMY_SPRITES: Record<EnemyType, SpriteFrames> = {
  imp: {
    idle: [
      "..XXXX..",
      ".XRRRRX.",
      "XRWRRWRX",
      "XRRRRRRX",
      "XRRGGRRX",
      ".XRRRRX.",
      "..XXXX..",
      "..X..X..",
    ],
    walk: [
      "..XXXX..",
      ".XRRRRX.",
      "XRWRRWRX",
      "XRRRRRRX",
      "XRRGGRRX",
      ".XRRRRX.",
      "..XXXX..",
      ".X....X.",
    ],
    dead: [
      "........",
      "........",
      "........",
      "........",
      "..XXXX..",
      ".XRRRRX.",
      "XRRRRRRX",
      "XXXXXXXX",
    ],
  },
  demon: {
    idle: [
      ".XXXXXX.",
      "XRRRRRRX",
      "XRYRRYRX",
      "RRRBBRRR",
      "XRRWWWRX",
      "XRRRRRRX",
      "XXXXXXXX",
      ".X.XX.X.",
    ],
    walk: [
      ".XXXXXX.",
      "XRRRRRRX",
      "XRYRRYRX",
      "RRRBBRRR",
      "XRRWWWRX",
      "XRRRRRRX",
      "XXXXXXXX",
      "X.X..X.X",
    ],
    dead: [
      "........",
      "........",
      "........",
      ".XXXXXX.",
      "XRRRRRRX",
      "XRRYRRRX",
      "XRRRRRRX",
      "XXXXXXXX",
    ],
  },
  baron: {
    idle: [
      "XXXXXXXX",
      "XPPPPPPX",
      "XPYPPYPX",
      "PPPRRPPP",
      "XPRRWRPX",
      "XPPRRPPX",
      "XPPPPPPX",
      "XX.XX.XX",
    ],
    walk: [
      "XXXXXXXX",
      "XPPPPPPX",
      "XPYPPYPX",
      "PPPRRPPP",
      "XPRRWRPX",
      "XPPRRPPX",
      "XPPPPPPX",
      "X.X..X.X",
    ],
    dead: [
      "........",
      "........",
      "........",
      "XXXXXXXX",
      "XPPRRPPX",
      "XPRRRRPX",
      "XPPPPPPX",
      "XXXXXXXX",
    ],
  },
  caco: {
    idle: [
      "..XXXX..",
      ".XBBBBX.",
      "XBWBBWBX",
      "XBBYYBBX",
      "XBBRRBBX",
      "XBBBBBBX",
      ".XBBBBX.",
      "..XBBX..",
    ],
    walk: [
      "..XXXX..",
      ".XBBBBX.",
      "XBYBBYBX",
      "XBBWWBBX",
      "XBBRRBBX",
      "XBBBBBBX",
      ".XBBBBX.",
      "..X..X..",
    ],
    dead: [
      "........",
      "........",
      "........",
      ".XXXXXX.",
      "XBBBBBBX",
      "XBBRRBBX",
      "XBBBBBBX",
      "XXXXXXXX",
    ],
  },
  soldier: {
    idle: [
      "..XGGX..",
      ".XGWWGX.",
      "XGYGGYGX",
      "XGGGGGGX",
      "XGRRRRGX",
      "XGGGGGGX",
      ".XGGGGX.",
      ".X.XX.X.",
    ],
    walk: [
      "..XGGX..",
      ".XGWWGX.",
      "XGYGGYGX",
      "XGGGGGGX",
      "XGRRRRGX",
      "XGGGGGGX",
      ".XGGGGX.",
      "X.XXXX.X",
    ],
    dead: [
      "........",
      "........",
      "........",
      ".XGGGGX.",
      "XGGGGGGX",
      "XGRRRRGX",
      "XGGGGGGX",
      "XXXXXXXX",
    ],
  },
};

function colorFor(ch: string, shade: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.floor(n * shade)));
  switch (ch) {
    case "X": return `rgb(${c(40)},${c(20)},${c(20)})`;
    case "R": return `rgb(${c(200)},${c(60)},${c(45)})`;
    case "W": return `rgb(${c(255)},${c(255)},${c(240)})`;
    case "G": return `rgb(${c(240)},${c(170)},${c(50)})`;
    case "Y": return `rgb(${c(240)},${c(220)},${c(80)})`;
    case "B": return `rgb(${c(40)},${c(40)},${c(120)})`;
    case "P": return `rgb(${c(120)},${c(40)},${c(150)})`;
    default: return "transparent";
  }
}

const PICKUP_COLOR: Record<Pickup["type"], { fill: string; emoji: string; bonus: string }> = {
  health: { fill: "rgb(220,40,40)", emoji: "+", bonus: "+25 HP" },
  ammo: { fill: "rgb(240,210,50)", emoji: "▣", bonus: "+10 AMMO" },
  armor: { fill: "rgb(50,150,250)", emoji: "♢", bonus: "+15 ARMOR" },
};

const WALL_COLORS: Record<number, [number, number, number]> = {
  1: [0xa0, 0xa0, 0xb0], // gray stone
  2: [0xc0, 0x39, 0x2b], // red brick
  3: [0x40, 0xe0, 0x60], // exit green
  4: [0xfb, 0xc5, 0x31], // gold
  5: [0x40, 0x40, 0x50], // pillar dark
};

const HIGH_KEY = "delos.doom.high";
const LEVEL_KEY = "delos.doom.level";

export function DoomGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [levelIdx, setLevelIdx] = useState(0);
  const [tick, setTick] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [paused, setPaused] = useState(false);
  const [showLevelScreen, setShowLevelScreen] = useState<"start" | "complete" | "gameover" | "victory" | null>("start");
  const [locked, setLocked] = useState(false);

  const levelRef = useRef<LevelSpec>(buildLevel(0));
  const stateRef = useRef({
    px: 1.5,
    py: 1.5,
    pa: 0,
    pz: 0, // head bob z-offset
    walkPhase: 0,
    keys: new Set<string>(),
    enemies: [] as Enemy[],
    pickups: [] as Pickup[],
    blood: [] as Array<{ x: number; y: number; t: number; size: number }>,
    muzzle: 0,
    hp: 100,
    armor: 0,
    ammo: 50,
    score: 0,
    flash: 0,
    shake: 0,
    won: false,
    over: false,
  });

  function loadLevel(idx: number) {
    const spec = buildLevel(idx);
    levelRef.current = spec;
    const s = stateRef.current;
    s.px = spec.spawnX;
    s.py = spec.spawnY;
    s.pa = spec.spawnAngle;
    s.enemies = spec.enemies.map((e) => ({
      x: e.x,
      y: e.y,
      hp: e.hp,
      maxHp: e.hp,
      state: "patrol",
      t: Math.random() * Math.PI * 2,
      dx: 0,
      dy: 0,
      shootCooldown: 0,
      hurtTime: 0,
      deathTime: 0,
      type: e.type,
    }));
    s.pickups = spec.pickups.map((p) => ({ ...p, taken: false }));
    s.muzzle = 0;
    s.flash = 0;
    s.shake = 0;
    s.won = false;
    s.over = false;
    setTick((t) => t + 1);
  }

  // Load saved progress
  useEffect(() => {
    try {
      const h = Number(localStorage.getItem(HIGH_KEY) ?? 0);
      if (h > 0) setHighScore(h);
    } catch {}
  }, []);

  function reset(toLevel: number = 0) {
    const s = stateRef.current;
    s.hp = 100;
    s.armor = 0;
    s.ammo = 50;
    s.score = 0;
    setLevelIdx(toLevel);
    loadLevel(toLevel);
    setShowLevelScreen("start");
  }

  function nextLevel() {
    const s = stateRef.current;
    if (levelIdx >= LEVELS.length - 1) {
      // Victory
      setShowLevelScreen("victory");
      try {
        const h = Math.max(highScore, s.score);
        localStorage.setItem(HIGH_KEY, String(h));
        setHighScore(h);
      } catch {}
      return;
    }
    const nl = levelIdx + 1;
    setLevelIdx(nl);
    loadLevel(nl);
    setShowLevelScreen("complete");
    try { localStorage.setItem(LEVEL_KEY, String(nl)); } catch {}
  }

  function startLevel() {
    setShowLevelScreen(null);
    // Request pointer lock
    const cv = canvasRef.current;
    if (cv && document.pointerLockElement !== cv) {
      try { cv.requestPointerLock(); } catch {}
    }
  }

  // Keyboard
  useEffect(() => {
    function kd(e: KeyboardEvent) {
      const k = e.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " ", "shift", "escape", "p", "e", "r"].includes(k)) {
        if (k !== "escape") e.preventDefault();
        if (k === "p") setPaused((p) => !p);
        if (k === "r" && (stateRef.current.over || showLevelScreen === "gameover")) reset(0);
        if (k === " " || k === "e") {
          // Shoot
          shootHitscan();
          return;
        }
        stateRef.current.keys.add(k);
      }
    }
    function ku(e: KeyboardEvent) {
      stateRef.current.keys.delete(e.key.toLowerCase());
    }
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    return () => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLevelScreen]);

  // Pointer lock + mouse look
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    function onMove(e: MouseEvent) {
      if (document.pointerLockElement !== cv) return;
      stateRef.current.pa += e.movementX * 0.0028;
    }
    function onLockChange() {
      setLocked(document.pointerLockElement === cv);
    }
    function onClick() {
      if (showLevelScreen) return;
      if (document.pointerLockElement !== cv) {
        try { cv?.requestPointerLock(); } catch {}
        return;
      }
      shootHitscan();
    }
    cv.addEventListener("click", onClick);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("pointerlockchange", onLockChange);
    return () => {
      cv.removeEventListener("click", onClick);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("pointerlockchange", onLockChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLevelScreen]);

  function isWall(x: number, y: number): number {
    const map = levelRef.current.map;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (iy < 0 || iy >= map.length || ix < 0 || ix >= map[0].length) return 1;
    return map[iy][ix];
  }

  function shootHitscan() {
    const s = stateRef.current;
    if (s.over || showLevelScreen) return;
    if (s.ammo <= 0) {
      s.flash = 0.3;
      return;
    }
    s.ammo -= 1;
    s.muzzle = 1;
    s.shake = 0.6;
    const cosA = Math.cos(s.pa);
    const sinA = Math.sin(s.pa);
    let best: { e: Enemy; d: number } | null = null;
    for (const e of s.enemies) {
      if (e.state === "dead") continue;
      const dx = e.x - s.px;
      const dy = e.y - s.py;
      const d = Math.hypot(dx, dy);
      const dot = (dx / d) * cosA + (dy / d) * sinA;
      const cross = Math.abs(dx * sinA - dy * cosA) / d;
      if (dot < 0) continue;
      if (cross > 0.18) continue;
      // wall check
      let blocked = false;
      const steps = Math.floor(d * 8);
      for (let i = 1; i < steps; i++) {
        const tt = i / steps;
        const ix = s.px + dx * tt;
        const iy = s.py + dy * tt;
        const t = isWall(ix, iy);
        if (t && t !== 3) { blocked = true; break; }
      }
      if (blocked) continue;
      if (!best || d < best.d) best = { e, d };
    }
    if (best) {
      best.e.hp -= 1;
      best.e.hurtTime = 0.4;
      best.e.state = "hurt";
      // Blood splatter at enemy location
      for (let bi = 0; bi < 8; bi++) {
        s.blood.push({
          x: best.e.x + (Math.random() - 0.5) * 0.3,
          y: best.e.y + (Math.random() - 0.5) * 0.3,
          t: 1,
          size: 0.05 + Math.random() * 0.08,
        });
      }
      if (best.e.hp <= 0) {
        best.e.state = "dead";
        best.e.deathTime = Date.now();
        s.score += best.e.type === "baron" ? 300 : best.e.type === "caco" ? 200 : best.e.type === "demon" ? 150 : best.e.type === "soldier" ? 100 : 60;
        // Bigger gore on kill
        for (let bi = 0; bi < 20; bi++) {
          s.blood.push({
            x: best.e.x + (Math.random() - 0.5) * 0.6,
            y: best.e.y + (Math.random() - 0.5) * 0.6,
            t: 1.5,
            size: 0.08 + Math.random() * 0.15,
          });
        }
      } else {
        s.score += 10;
        // Make hit enemy aggressive
        setTimeout(() => {
          if (best!.e.state === "hurt") best!.e.state = "chase";
        }, 200);
      }
    }
    setTick((t) => t + 1);
  }

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx2d = cv.getContext("2d");
    if (!ctx2d) return;
    const ctx: CanvasRenderingContext2D = ctx2d;
    let raf = 0;

    function step() {
      if (paused || showLevelScreen) {
        renderFrame();
        raf = requestAnimationFrame(step);
        return;
      }
      const s = stateRef.current;

      // Rotate (keys)
      if (s.keys.has("arrowleft")) s.pa -= ROT_SPEED;
      if (s.keys.has("arrowright")) s.pa += ROT_SPEED;

      // Move
      const cosA = Math.cos(s.pa);
      const sinA = Math.sin(s.pa);
      let dx = 0, dy = 0;
      if (s.keys.has("w") || s.keys.has("arrowup")) { dx += cosA; dy += sinA; }
      if (s.keys.has("s") || s.keys.has("arrowdown")) { dx -= cosA; dy -= sinA; }
      if (s.keys.has("a")) { dx += sinA; dy -= cosA; }
      if (s.keys.has("d")) { dx -= sinA; dy += cosA; }
      const m = Math.hypot(dx, dy);
      if (m > 0) {
        const sp = s.keys.has("shift") ? PLAYER_SPEED * 1.6 : PLAYER_SPEED;
        dx = (dx / m) * sp;
        dy = (dy / m) * sp;
        if (!isWall(s.px + dx * 4, s.py)) s.px += dx;
        if (!isWall(s.px, s.py + dy * 4)) s.py += dy;
        s.walkPhase += sp * 8;
      } else {
        s.walkPhase *= 0.92;
      }

      // Exit tile triggers next level
      if (isWall(s.px, s.py) === 3) {
        s.score += 200;
        nextLevel();
      }

      // Pickup collection
      for (const p of s.pickups) {
        if (p.taken) continue;
        const dd = Math.hypot(p.x - s.px, p.y - s.py);
        if (dd < 0.5) {
          p.taken = true;
          if (p.type === "health") s.hp = Math.min(100, s.hp + 25);
          if (p.type === "ammo") s.ammo += 10;
          if (p.type === "armor") s.armor = Math.min(100, s.armor + 15);
          s.score += 25;
        }
      }

      // Enemy AI
      for (const e of s.enemies) {
        if (e.state === "dead") continue;
        e.t += 0.05;
        if (e.hurtTime > 0) e.hurtTime -= 0.02;
        const edx = s.px - e.x;
        const edy = s.py - e.y;
        const ed = Math.hypot(edx, edy);

        // State machine
        if (e.state === "hurt" && e.hurtTime <= 0) {
          e.state = "chase";
        }
        if (e.state === "patrol" && ed < 5) {
          e.state = "chase";
        }
        if (e.state === "chase" && ed > 8) {
          e.state = "patrol";
        }
        if (e.state === "chase" && ed < 3.5 && e.shootCooldown <= 0) {
          e.state = "shoot";
          e.shootCooldown =
            e.type === "baron" ? 50 :
            e.type === "caco" ? 55 :
            e.type === "soldier" ? 60 :
            e.type === "demon" ? 70 :
            100;
        }
        if (e.shootCooldown > 0) e.shootCooldown -= 1;
        if (e.state === "shoot") {
          // Damage if line of sight clean
          let blocked = false;
          const steps = Math.floor(ed * 6);
          for (let i = 1; i < steps; i++) {
            const tt = i / steps;
            const ix = e.x + edx * tt;
            const iy = e.y + edy * tt;
            const t = isWall(ix, iy);
            if (t && t !== 3) { blocked = true; break; }
          }
          if (!blocked) {
            const dmg =
              e.type === "baron" ? 8 :
              e.type === "caco" ? 7 :
              e.type === "demon" ? 5 :
              e.type === "soldier" ? 4 :
              3;
            const absorbed = Math.min(s.armor, dmg * 0.5);
            s.armor -= absorbed;
            s.hp -= dmg - absorbed;
            s.flash = 1;
            s.shake = 0.4;
          }
          e.state = "chase";
        }

        // Movement (patrol or chase)
        if (e.state === "patrol" || e.state === "chase") {
          const sp = e.type === "baron" ? 0.018 : e.type === "demon" ? 0.015 : 0.012;
          let tx = 0, ty = 0;
          if (e.state === "chase") {
            tx = edx / Math.max(ed, 0.001);
            ty = edy / Math.max(ed, 0.001);
          } else {
            // wander
            tx = Math.cos(e.t);
            ty = Math.sin(e.t);
          }
          const nx = e.x + tx * sp;
          const ny = e.y + ty * sp;
          if (!isWall(nx, e.y)) e.x = nx;
          if (!isWall(e.x, ny)) e.y = ny;

          // Melee damage if very close
          if (ed < 0.5) {
            s.hp -= 0.3;
            s.flash = 0.5;
          }
        }
      }

      // Decay effects
      s.muzzle *= 0.82;
      s.flash *= 0.88;
      s.shake *= 0.85;
      // Decay blood
      for (const b of s.blood) b.t -= 0.005;
      s.blood = s.blood.filter((b) => b.t > 0);

      if (s.hp <= 0) {
        s.hp = 0;
        s.over = true;
        setShowLevelScreen("gameover");
        try {
          const h = Math.max(highScore, s.score);
          localStorage.setItem(HIGH_KEY, String(h));
          setHighScore(h);
        } catch {}
      }

      renderFrame();
      raf = requestAnimationFrame(step);
    }

    function renderFrame() {
      const s = stateRef.current;
      const shakeX = (Math.random() - 0.5) * s.shake * 4;
      const shakeY = (Math.random() - 0.5) * s.shake * 4;
      ctx.save();
      ctx.translate(shakeX, shakeY);

      // Sky/floor with head bob
      const bobY = Math.sin(s.walkPhase) * 1.2;
      // Sky — gradient with horizon haze
      const skyGrad = ctx.createLinearGradient(0, 0, 0, H / 2);
      skyGrad.addColorStop(0, "#08051c");
      skyGrad.addColorStop(0.6, "#1a0a2a");
      skyGrad.addColorStop(1, "#4a1a5a");
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, W, H / 2 + bobY);
      // Floor — dark with subtle plane
      const floorGrad = ctx.createLinearGradient(0, H / 2, 0, H);
      floorGrad.addColorStop(0, "#2a1408");
      floorGrad.addColorStop(0.5, "#180a04");
      floorGrad.addColorStop(1, "#040201");
      ctx.fillStyle = floorGrad;
      ctx.fillRect(0, H / 2 + bobY, W, H / 2 - bobY);
      // Floor pseudo-perspective grid
      ctx.strokeStyle = "rgba(80, 40, 20, 0.4)";
      ctx.lineWidth = 1;
      for (let yi = 1; yi <= 12; yi++) {
        const t = yi / 12;
        const yp = H / 2 + bobY + Math.pow(t, 1.7) * (H / 2);
        ctx.beginPath();
        ctx.moveTo(0, yp);
        ctx.lineTo(W, yp);
        ctx.stroke();
      }

      // Raycast walls
      const zbuf = new Float32Array(NUM_RAYS);
      const startA = s.pa - FOV / 2;
      for (let r = 0; r < NUM_RAYS; r++) {
        const rayA = startA + (r / NUM_RAYS) * FOV;
        const cosA = Math.cos(rayA);
        const sinA = Math.sin(rayA);
        let depth = 0;
        let hit = 0;
        while (depth < MAX_DEPTH) {
          depth += STEP_SIZE;
          const x = s.px + cosA * depth;
          const y = s.py + sinA * depth;
          hit = isWall(x, y);
          if (hit) break;
        }
        depth *= Math.cos(rayA - s.pa); // fisheye fix
        zbuf[r] = depth;
        const wallH = Math.min(H * 2, (H * 0.95) / Math.max(depth, 0.1));
        const y0 = H / 2 - wallH / 2 + bobY;
        const color = WALL_COLORS[hit] ?? [200, 200, 200];
        const shade = Math.max(0.1, 1 - depth / 10);
        const fog = Math.max(0, Math.min(1, (depth - 6) / 10));
        // Hit UV for column-tone stripe
        const hitX = s.px + cosA * depth;
        const hitY = s.py + sinA * depth;
        const u = Math.abs(cosA) > Math.abs(sinA) ? (hitY - Math.floor(hitY)) : (hitX - Math.floor(hitX));
        // Column tone — alternating brick offset adds variation between rays
        const colSeed = Math.floor(u * 8) + hit * 7;
        const noise = ((colSeed * 9301 + 49297) % 233280) / 233280;
        let texMul = 0.85 + 0.3 * noise;
        if (hit === 5) texMul *= 0.7;
        if (hit === 4) texMul = 1.05 + 0.1 * noise;
        // Mortar stripes — darker at brick edges
        const mortarEdge = u < 0.06 || u > 0.94;
        if (mortarEdge) texMul *= 0.6;
        let cr = Math.floor(color[0] * shade * texMul);
        let cg = Math.floor(color[1] * shade * texMul);
        let cb = Math.floor(color[2] * shade * texMul);
        // Fog blend
        cr = Math.floor(cr * (1 - fog) + 0x1a * fog);
        cg = Math.floor(cg * (1 - fog) + 0x0a * fog);
        cb = Math.floor(cb * (1 - fog) + 0x2a * fog);
        ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
        ctx.fillRect(r, y0, 1, wallH);
        // Horizontal mortar lines as overlay (cheap — 4 strips per wall)
        const mortarColor = `rgba(0,0,0,${0.35 - fog * 0.3})`;
        ctx.fillStyle = mortarColor;
        const rowsPerWall = 4;
        for (let mi = 0; mi < rowsPerWall; mi++) {
          const my = y0 + (wallH * (mi + 0.5)) / rowsPerWall;
          ctx.fillRect(r, Math.floor(my), 1, 1);
        }
        // Exit pulse glow
        if (hit === 3) {
          ctx.fillStyle = `rgba(64, 224, 96, ${0.25 + 0.2 * Math.sin(Date.now() * 0.005)})`;
          ctx.fillRect(r, y0, 1, wallH);
        }
      }

      // Pickups
      const sortedPickups = s.pickups
        .filter((p) => !p.taken)
        .map((p) => ({ p, d: Math.hypot(p.x - s.px, p.y - s.py) }))
        .sort((a, b) => b.d - a.d);
      for (const { p, d } of sortedPickups) {
        if (d > 8) continue;
        const dx = p.x - s.px;
        const dy = p.y - s.py;
        const angle = Math.atan2(dy, dx) - s.pa;
        let a = angle;
        while (a > Math.PI) a -= Math.PI * 2;
        while (a < -Math.PI) a += Math.PI * 2;
        if (Math.abs(a) > FOV) continue;
        const sx = W / 2 + (a / (FOV / 2)) * (W / 2);
        const size = Math.min(H * 0.6, (H * 0.4) / Math.max(d, 0.3));
        const x0 = Math.floor(sx - size / 2);
        const y0 = Math.floor(H / 2 + size / 4 - size / 2);
        const colX = Math.floor(sx);
        if (colX >= 0 && colX < W && zbuf[colX] < d) continue;
        // Bobbing
        const bob = Math.sin(Date.now() * 0.004 + p.x * 7) * 4;
        const pc = PICKUP_COLOR[p.type];
        ctx.fillStyle = pc.fill;
        ctx.fillRect(x0, y0 + bob, size, size);
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.fillRect(x0 + 2, y0 + bob + 2, size - 4, 2);
        ctx.fillStyle = "rgba(0,0,0,0.4)";
        ctx.fillRect(x0 + 2, y0 + bob + size - 4, size - 4, 2);
        ctx.fillStyle = "white";
        ctx.font = `bold ${Math.floor(size * 0.5)}px ui-monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(pc.emoji, x0 + size / 2, y0 + bob + size / 2);
        ctx.textAlign = "start";
      }

      // Enemies + corpses (billboard sprites with z-buffer)
      const sortedEn = s.enemies
        .filter((e) => e.state !== "dead" || (e.deathTime > 0 && Date.now() - e.deathTime < 8000))
        .map((e) => ({ e, d: Math.hypot(e.x - s.px, e.y - s.py) }))
        .sort((a, b) => b.d - a.d);
      for (const { e, d } of sortedEn) {
        const dx = e.x - s.px;
        const dy = e.y - s.py;
        const angle = Math.atan2(dy, dx) - s.pa;
        let a = angle;
        while (a > Math.PI) a -= Math.PI * 2;
        while (a < -Math.PI) a += Math.PI * 2;
        if (Math.abs(a) > FOV) continue;
        const sx = W / 2 + (a / (FOV / 2)) * (W / 2);
        const size = Math.min(H * 0.9, (H * 0.85) / Math.max(d, 0.3));
        const x0 = Math.floor(sx - size / 2);
        const y0 = Math.floor(H / 2 - size / 2);
        const pix = 8;
        const cell = size / pix;
        // Pick frame: dead → dead sprite, moving → alternate idle/walk by t
        const frames = ENEMY_SPRITES[e.type];
        let sprite: string[];
        if (e.state === "dead") sprite = frames.dead;
        else if (e.state === "patrol" || e.state === "chase") {
          sprite = Math.floor(e.t * 4) % 2 === 0 ? frames.idle : frames.walk;
        } else sprite = frames.idle;
        const wave = e.state === "dead" ? 0 : Math.sin(e.t * 3) * (size * 0.02);
        const shade = Math.max(0.3, 1 - d / 10);
        const flash = e.hurtTime > 0 ? 1.5 : 1;
        const opacity = e.state === "dead" ? Math.max(0.3, 1 - (Date.now() - e.deathTime) / 8000) : 1;
        for (let py = 0; py < pix; py++) {
          for (let px = 0; px < pix; px++) {
            const ch = sprite[py][px];
            if (ch === ".") continue;
            const colX = Math.floor(x0 + px * cell);
            if (colX < 0 || colX >= W) continue;
            if (zbuf[colX] < d) continue;
            ctx.globalAlpha = opacity;
            ctx.fillStyle = colorFor(ch, shade * flash);
            ctx.fillRect(colX, Math.floor(y0 + py * cell + wave), Math.ceil(cell) + 1, Math.ceil(cell) + 1);
          }
        }
        ctx.globalAlpha = 1;
        // HP bar over enemy
        if (e.hp < e.maxHp && d < 6) {
          const barW = size * 0.6;
          const barX = sx - barW / 2;
          const barY = y0 - 6;
          ctx.fillStyle = "rgba(0,0,0,0.7)";
          ctx.fillRect(barX, barY, barW, 4);
          ctx.fillStyle = e.hp / e.maxHp > 0.5 ? "#6ab04c" : e.hp / e.maxHp > 0.2 ? "#fbc531" : "#c0392b";
          ctx.fillRect(barX, barY, barW * (e.hp / e.maxHp), 4);
        }
      }

      // Blood splatter sprites (billboard, on floor near impact)
      for (const b of s.blood) {
        const dx = b.x - s.px;
        const dy = b.y - s.py;
        const d = Math.hypot(dx, dy);
        if (d > 8) continue;
        const angle = Math.atan2(dy, dx) - s.pa;
        let aa = angle;
        while (aa > Math.PI) aa -= Math.PI * 2;
        while (aa < -Math.PI) aa += Math.PI * 2;
        if (Math.abs(aa) > FOV) continue;
        const sx = W / 2 + (aa / (FOV / 2)) * (W / 2);
        const size = Math.min(H * 0.3, (b.size * H) / Math.max(d, 0.3));
        const colX = Math.floor(sx);
        if (colX < 0 || colX >= W || zbuf[colX] < d) continue;
        const yc = H / 2 + size * 1.2 + bobY;
        ctx.fillStyle = `rgba(${Math.floor(140 * b.t)}, ${Math.floor(20 * b.t)}, ${Math.floor(20 * b.t)}, ${Math.min(1, b.t)})`;
        ctx.beginPath();
        ctx.ellipse(sx, yc, size, size * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // Weapon with sway
      const gunW = 130;
      const gunH = 90;
      const gx = W / 2 - gunW / 2 + Math.sin(s.walkPhase) * 3;
      const gy = H - gunH + 6 + Math.abs(Math.sin(s.walkPhase * 2)) * 4;
      const bob = Math.sin(Date.now() * 0.008) * 2;
      // Recoil offset
      const recoil = s.muzzle * 8;
      ctx.fillStyle = "#1a1a26";
      ctx.fillRect(gx + 30, gy + 45 + bob + recoil, 70, 50);
      ctx.fillStyle = "#2a2a36";
      ctx.fillRect(gx + 33, gy + 48 + bob + recoil, 64, 6); // top highlight
      ctx.fillStyle = "#3a3a4a";
      ctx.fillRect(gx + 45, gy + 15 + bob + recoil, 40, 45);
      ctx.fillStyle = "#4a4a5a";
      ctx.fillRect(gx + 47, gy + 17 + bob + recoil, 36, 2);
      ctx.fillStyle = "#0a0a14";
      ctx.fillRect(gx + 52, gy + 8 + bob + recoil, 26, 12);
      ctx.fillStyle = "#fbc531";
      ctx.fillRect(gx + 60, gy + 10 + bob + recoil, 10, 4);
      // Muzzle flash
      if (s.muzzle > 0.05) {
        const m = s.muzzle;
        ctx.fillStyle = `rgba(255,200,40,${m * 0.8})`;
        ctx.fillRect(gx + 55, gy - 4 + bob, 20, 18);
        ctx.fillStyle = `rgba(255,140,30,${m * 0.5})`;
        ctx.fillRect(gx + 48, gy - 12 + bob, 34, 30);
        // Light flash on screen
        ctx.fillStyle = `rgba(255,200,40,${m * 0.08})`;
        ctx.fillRect(0, 0, W, H);
      }

      // Crosshair
      ctx.strokeStyle = "rgba(251,197,49,0.85)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(W / 2 - 5, H / 2);
      ctx.lineTo(W / 2 - 1, H / 2);
      ctx.moveTo(W / 2 + 1, H / 2);
      ctx.lineTo(W / 2 + 5, H / 2);
      ctx.moveTo(W / 2, H / 2 - 5);
      ctx.lineTo(W / 2, H / 2 - 1);
      ctx.moveTo(W / 2, H / 2 + 1);
      ctx.lineTo(W / 2, H / 2 + 5);
      ctx.stroke();

      // Damage vignette
      if (s.flash > 0.05) {
        const grad = ctx.createRadialGradient(W / 2, H / 2, W / 4, W / 2, H / 2, W / 1.4);
        grad.addColorStop(0, `rgba(192,57,43,0)`);
        grad.addColorStop(1, `rgba(192,57,43,${s.flash * 0.6})`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
      }

      // HUD
      ctx.fillStyle = "rgba(0,0,0,0.75)";
      ctx.fillRect(0, H - 22, W, 22);
      ctx.fillStyle = "#fbc531";
      ctx.font = "bold 12px ui-monospace, monospace";
      ctx.fillText(`L${levelIdx + 1}`, 8, H - 6);
      ctx.fillStyle = s.hp < 30 ? "#c0392b" : s.hp < 60 ? "#e1a95f" : "#6ab04c";
      ctx.fillText(`HP ${Math.ceil(s.hp)}`, 36, H - 6);
      ctx.fillStyle = "#5fc4e1";
      ctx.fillText(`AR ${Math.ceil(s.armor)}`, 100, H - 6);
      ctx.fillStyle = s.ammo > 0 ? "#fbc531" : "#c0392b";
      ctx.fillText(`AM ${s.ammo}`, 158, H - 6);
      ctx.fillStyle = "#f4f1de";
      ctx.fillText(`SC ${s.score}`, 220, H - 6);
      const alive = s.enemies.filter((e) => e.state !== "dead").length;
      ctx.fillStyle = "#c0392b";
      ctx.fillText(`EN ${alive}`, 290, H - 6);
      ctx.fillStyle = "#aaa";
      ctx.fillText(`HI ${highScore}`, 350, H - 6);
      ctx.fillStyle = "#888";
      ctx.font = "9px ui-monospace, monospace";
      ctx.fillText(levelRef.current.name, W - 100, H - 6);

      ctx.restore();
    }

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, showLevelScreen, levelIdx, highScore, tick]);

  return (
    <div ref={wrapRef} className="p-3 space-y-2 text-xs" style={{ position: "relative" }}>
      <div className="flex items-center justify-between">
        <div className="font-pixel text-sm tracking-wider" style={{ color: "var(--danger)" }}>
          ★ DEL DOOM 3D — LEVEL {levelIdx + 1}/10 · {levelRef.current.name}
        </div>
        <div className="flex gap-1">
          <button onClick={() => setPaused((p) => !p)} className="pill pill-muted" style={{ cursor: "pointer", fontSize: 10 }}>
            {paused ? "▶" : "▌▌"} {paused ? "RESUME" : "PAUSE"}
          </button>
          <button onClick={() => reset(0)} className="pill pill-warn" style={{ cursor: "pointer", fontSize: 10 }}>
            <Icons.RotateCcw size={9} /> RESTART
          </button>
        </div>
      </div>
      <div style={{ position: "relative", display: "block", margin: "0 auto", maxWidth: 560, width: "100%" }}>
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          tabIndex={0}
          style={{
            width: "100%",
            aspectRatio: `${W} / ${H}`,
            imageRendering: "pixelated",
            display: "block",
            border: "2px solid var(--surface-2)",
            background: "var(--bg)",
            cursor: locked ? "none" : "crosshair",
          }}
        />
        {showLevelScreen && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center"
            style={{ background: "rgba(0,0,0,0.85)", color: "var(--fg)", padding: 16 }}
          >
            {showLevelScreen === "start" && (
              <>
                <div className="font-pixel text-2xl mb-2" style={{ color: "var(--accent)" }}>
                  LEVEL {levelIdx + 1}
                </div>
                <div className="font-pixel text-sm mb-4" style={{ color: "var(--fg)" }}>
                  {levelRef.current.name}
                </div>
                <div className="text-[10px] font-mono text-center mb-4 max-w-sm" style={{ color: "var(--muted)" }}>
                  WASD = move · MOUSE = look · CLICK = shoot · SHIFT = run<br />
                  E/SPACE = shoot · P = pause · R = restart · ESC = release mouse
                </div>
                <button onClick={startLevel} className="btn-pixel success">▶ ENTER LEVEL</button>
              </>
            )}
            {showLevelScreen === "complete" && (
              <>
                <div className="font-pixel text-2xl mb-2" style={{ color: "var(--success)" }}>
                  LEVEL COMPLETE
                </div>
                <div className="text-[11px] font-mono mb-4 text-center" style={{ color: "var(--fg)" }}>
                  +200 bonus · score {stateRef.current.score}
                </div>
                <button onClick={startLevel} className="btn-pixel success">▶ LEVEL {levelIdx + 1}</button>
              </>
            )}
            {showLevelScreen === "gameover" && (
              <>
                <div className="font-pixel text-3xl mb-2" style={{ color: "var(--danger)" }}>
                  YOU DIED
                </div>
                <div className="text-[11px] font-mono mb-4 text-center" style={{ color: "var(--fg)" }}>
                  final: {stateRef.current.score} · high: {highScore} · reached L{levelIdx + 1}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => reset(0)} className="btn-pixel danger">▶ RESTART</button>
                  <button onClick={() => reset(levelIdx)} className="btn-pixel">RETRY LEVEL</button>
                </div>
              </>
            )}
            {showLevelScreen === "victory" && (
              <>
                <div className="font-pixel text-3xl mb-2" style={{ color: "var(--success)" }}>
                  VICTORY
                </div>
                <div className="text-[11px] font-mono mb-4 text-center" style={{ color: "var(--fg)" }}>
                  ALL 10 LEVELS CLEARED · final {stateRef.current.score} · high {highScore}
                </div>
                <button onClick={() => reset(0)} className="btn-pixel success">▶ NEW GAME+</button>
              </>
            )}
          </div>
        )}
      </div>
      <div className="text-[10px] font-mono text-[color:var(--muted)] text-center">
        click canvas to lock mouse · WASD strafe · click/space shoot · shift run · P pause · R restart
      </div>
    </div>
  );
}
