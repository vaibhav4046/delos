"use client";
import { useEffect, useRef, useState } from "react";
import * as Icons from "lucide-react";

// DEL DOOM v3 — full rebuild.
// Adds: 7-weapon arsenal, 4 difficulties, per-level missions, contextual
// hints, mini-map, doors+keys, 8 enemy types incl. cyberdemon boss,
// proper physics (collision radius + sliding), sound beeps via WebAudio.

const W = 540;
const H = 320;
const FOV = Math.PI / 3;
const NUM_RAYS = W;
const MAX_DEPTH = 22;
const STEP_SIZE = 0.05;
const PLAYER_RADIUS = 0.22;
const PLAYER_SPEED = 0.046;
const ROT_SPEED = 0.035;

// Tile codes:
//   0 empty · 1 stone · 2 brick · 3 exit · 4 gold · 5 pillar
//   6 door (red key) · 7 door (yellow key) · 8 door (blue key) · 9 lava (damage)
const LEVELS: number[][][] = [
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
  // Level 4 — open arena with red-key door
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
    [1,0,0,0,0,0,6,0,0,0,3,1],
    [1,1,1,1,1,1,1,1,1,1,1,1],
  ],
  // Level 5 — golden halls + yellow door
  [
    [1,1,1,1,1,1,1,1,1,1,1,1],
    [1,0,4,4,0,0,0,0,4,4,0,1],
    [1,0,0,0,0,4,4,0,0,0,0,1],
    [1,0,4,0,0,0,0,0,0,4,0,1],
    [1,0,4,4,4,0,0,4,4,4,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,4,4,4,0,0,4,4,4,0,1],
    [1,0,4,0,0,0,7,0,0,4,0,1],
    [1,0,0,0,0,4,4,0,0,0,0,1],
    [1,0,4,4,0,0,0,0,4,4,3,1],
    [1,1,1,1,1,1,1,1,1,1,1,1],
  ],
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
  // Level 7 — pillars + lava traps
  [
    [1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,5,0,5,0,5,0,5,0,5,0,1],
    [1,0,0,0,9,0,0,0,9,0,0,0,1],
    [1,0,5,0,2,2,2,2,2,0,5,0,1],
    [1,0,0,0,2,0,0,0,2,0,0,0,1],
    [1,0,5,0,2,0,3,0,2,0,5,0,1],
    [1,0,0,0,2,0,0,0,2,0,0,0,1],
    [1,0,5,0,2,2,2,2,2,0,5,0,1],
    [1,0,0,0,9,0,0,0,9,0,0,0,1],
    [1,0,5,0,5,0,5,0,5,0,5,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1],
  ],
  // Level 8 — fortress + blue door
  [
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,4,4,4,4,1,1,4,4,4,4,0,1],
    [1,0,4,0,0,0,0,0,0,0,0,4,0,1],
    [1,0,4,0,2,2,0,0,2,2,0,4,0,1],
    [1,0,1,0,2,0,0,0,0,2,0,1,0,1],
    [1,0,0,0,0,0,8,3,0,0,0,0,0,1],
    [1,0,1,0,2,0,0,0,0,2,0,1,0,1],
    [1,0,4,0,2,2,0,0,2,2,0,4,0,1],
    [1,0,4,0,0,0,0,0,0,0,0,4,0,1],
    [1,0,4,4,4,4,1,1,4,4,4,4,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  ],
  // Level 9 — narrow death + lava
  [
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,1],
    [1,1,1,0,1,0,1,0,1,0,1,0,1,0,1,1],
    [1,0,0,0,0,0,1,0,0,0,1,0,0,0,0,1],
    [1,0,1,1,1,9,1,0,1,1,1,1,1,1,0,1],
    [1,0,1,0,0,0,0,0,0,0,0,0,0,1,0,1],
    [1,0,1,0,1,1,1,1,1,1,1,1,0,1,0,1],
    [1,0,1,0,1,0,0,0,3,0,0,1,0,1,0,1],
    [1,0,1,0,1,0,1,1,1,1,0,1,0,1,0,1],
    [1,0,1,0,1,0,0,0,0,0,0,1,0,1,0,1],
    [1,0,1,0,1,1,1,1,1,1,1,1,0,1,0,1],
    [1,0,1,0,0,0,0,0,0,0,0,0,0,1,0,1],
    [1,0,1,1,1,1,1,9,1,1,1,1,1,1,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  ],
  // Level 10 — final boss arena (cyberdemon)
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

// ---------- weapons ----------
type WeaponId = "fist" | "pistol" | "shotgun" | "chaingun" | "plasma" | "rocket" | "bfg";
type AmmoType = "none" | "bullet" | "shell" | "cell" | "rocket";

type Weapon = {
  id: WeaponId;
  name: string;
  short: string;
  ammoType: AmmoType;
  ammoPerShot: number;
  damage: number;
  pellets: number;
  spread: number;       // radians half-cone
  fireDelay: number;    // frames between shots
  recoil: number;
  range: number;
  unlockLevel: number;  // first level you can pick it up
  splash?: number;      // rocket / bfg AoE radius
};

const WEAPONS: Record<WeaponId, Weapon> = {
  fist:     { id: "fist",     name: "Fists",        short: "FIST",  ammoType: "none",   ammoPerShot: 0, damage: 3,  pellets: 1, spread: 0.05, fireDelay: 8,  recoil: 0.2, range: 1.5, unlockLevel: 0 },
  pistol:   { id: "pistol",   name: "Pistol",       short: "PIS",   ammoType: "bullet", ammoPerShot: 1, damage: 2,  pellets: 1, spread: 0.02, fireDelay: 10, recoil: 0.4, range: 15,  unlockLevel: 0 },
  shotgun:  { id: "shotgun",  name: "Shotgun",      short: "SHO",   ammoType: "shell",  ammoPerShot: 1, damage: 2,  pellets: 7, spread: 0.18, fireDelay: 28, recoil: 1.2, range: 10,  unlockLevel: 1 },
  chaingun: { id: "chaingun", name: "Chaingun",     short: "CHN",   ammoType: "bullet", ammoPerShot: 1, damage: 2,  pellets: 1, spread: 0.05, fireDelay: 4,  recoil: 0.25, range: 14,  unlockLevel: 2 },
  plasma:   { id: "plasma",   name: "Plasma Rifle", short: "PLS",   ammoType: "cell",   ammoPerShot: 1, damage: 3,  pellets: 1, spread: 0.04, fireDelay: 6,  recoil: 0.5, range: 16,  unlockLevel: 4 },
  rocket:   { id: "rocket",   name: "Rocket Launcher", short: "RKT", ammoType: "rocket", ammoPerShot: 1, damage: 8, pellets: 1, spread: 0.01, fireDelay: 30, recoil: 2.0, range: 18, unlockLevel: 5, splash: 1.8 },
  bfg:      { id: "bfg",      name: "BFG 9000",     short: "BFG",   ammoType: "cell",   ammoPerShot: 20, damage: 30, pellets: 1, spread: 0.02, fireDelay: 80, recoil: 3.0, range: 22, unlockLevel: 8, splash: 3.2 },
};

const WEAPON_ORDER: WeaponId[] = ["fist", "pistol", "shotgun", "chaingun", "plasma", "rocket", "bfg"];

// ---------- difficulty ----------
type DifficultyId = "tooyoung" | "easy" | "normal" | "hard" | "nightmare";
type Difficulty = {
  id: DifficultyId;
  name: string;
  short: string;
  enemyHpMul: number;
  enemyDmgMul: number;
  enemyCountMul: number;
  enemySpeedMul: number;
  enemyShootMul: number;   // <1 = shoot more often
  playerHpMul: number;
  ammoMul: number;
  description: string;
  color: string;
};

const DIFFICULTIES: Difficulty[] = [
  { id: "tooyoung", name: "I'm Too Young To Die", short: "TYTD",   enemyHpMul: 0.6, enemyDmgMul: 0.4, enemyCountMul: 0.7, enemySpeedMul: 0.8, enemyShootMul: 1.6, playerHpMul: 1.5, ammoMul: 2.0, description: "Story mode. Pickups doubled, enemies politer.",              color: "#6ab04c" },
  { id: "easy",     name: "Hey Not Too Rough",    short: "EASY",   enemyHpMul: 0.8, enemyDmgMul: 0.7, enemyCountMul: 0.9, enemySpeedMul: 0.9, enemyShootMul: 1.3, playerHpMul: 1.2, ammoMul: 1.4, description: "Casual. Survivable for new players.",                       color: "#5fc4e1" },
  { id: "normal",   name: "Hurt Me Plenty",       short: "NRM",    enemyHpMul: 1.0, enemyDmgMul: 1.0, enemyCountMul: 1.0, enemySpeedMul: 1.0, enemyShootMul: 1.0, playerHpMul: 1.0, ammoMul: 1.0, description: "Balanced. The intended fight.",                              color: "#fbc531" },
  { id: "hard",     name: "Ultra-Violence",       short: "UV",     enemyHpMul: 1.3, enemyDmgMul: 1.3, enemyCountMul: 1.3, enemySpeedMul: 1.2, enemyShootMul: 0.7, playerHpMul: 0.9, ammoMul: 0.8, description: "Brutal. More demons, faster, hit harder.",                   color: "#e1a95f" },
  { id: "nightmare",name: "Nightmare!",           short: "NM",     enemyHpMul: 1.6, enemyDmgMul: 1.6, enemyCountMul: 1.6, enemySpeedMul: 1.5, enemyShootMul: 0.4, playerHpMul: 0.7, ammoMul: 0.6, description: "Respawning hell. Don't say we didn't warn you.",             color: "#c0392b" },
];

// ---------- missions ----------
type MissionType = "exit" | "kill_all" | "kill_boss" | "find_key_red" | "find_key_yellow" | "find_key_blue" | "survive";
type Mission = { type: MissionType; brief: string; hint: string; par: number };

const MISSIONS: Mission[] = [
  { type: "exit",          brief: "Reach the green exit.",                        hint: "Look for the glowing green wall. Walk into it.",                 par: 60 },
  { type: "kill_all",      brief: "Clear every demon. Then exit.",                hint: "Strafe with A/D — don't stand still. Run = SHIFT.",              par: 100 },
  { type: "exit",          brief: "Escape the maze. Find the exit.",              hint: "Tight maze. Press M for mini-map.",                              par: 120 },
  { type: "find_key_red",  brief: "Get RED key, unlock door, escape.",            hint: "Red door = needs red key (♦). Hunt the imp carrying it.",        par: 130 },
  { type: "find_key_yellow", brief: "Get YELLOW key, unlock door, escape.",       hint: "Soldier drops the yellow key (◆). Pillars block line of sight.", par: 140 },
  { type: "kill_all",      brief: "Clear the spiral. Then exit.",                 hint: "Cacodemons phase through corners. Use shotgun.",                 par: 170 },
  { type: "exit",          brief: "Cross the lava pillars.",                      hint: "Orange tiles = LAVA. Damage over time. Avoid.",                  par: 110 },
  { type: "find_key_blue", brief: "Get BLUE key, unlock door, escape.",           hint: "Caco-demon guards the blue key (●).",                            par: 160 },
  { type: "kill_all",      brief: "Eliminate ALL hostiles. Final exam.",          hint: "Plasma rifle outclasses chaingun at range. Switch with 5.",      par: 200 },
  { type: "kill_boss",     brief: "DEFEAT THE CYBERDEMON. Save Earth.",           hint: "Cyberdemon ignores everything but rockets + BFG.",               par: 300 },
];

// ---------- enemies ----------
type EnemyState = "patrol" | "chase" | "shoot" | "hurt" | "dead";
type EnemyType = "imp" | "demon" | "baron" | "caco" | "soldier" | "zombie" | "lostsoul" | "cyberdemon";

type EnemyDef = {
  hp: number;
  speed: number;
  damage: number;
  range: number;
  cooldown: number;
  scoreOnKill: number;
  size: number;          // billboard scale
  flying: boolean;       // ignores wall collision (sort of)
  carriesKey?: "red" | "yellow" | "blue";
  isBoss?: boolean;
};

const ENEMY_DEFS: Record<EnemyType, EnemyDef> = {
  zombie:     { hp: 1, speed: 0.010, damage: 2, range: 4,  cooldown: 110, scoreOnKill: 40,  size: 0.85, flying: false },
  imp:        { hp: 2, speed: 0.012, damage: 3, range: 5,  cooldown: 100, scoreOnKill: 60,  size: 0.9,  flying: false },
  soldier:    { hp: 3, speed: 0.013, damage: 4, range: 6,  cooldown: 60,  scoreOnKill: 100, size: 0.95, flying: false },
  demon:      { hp: 4, speed: 0.017, damage: 5, range: 1.2,cooldown: 70,  scoreOnKill: 150, size: 1.05, flying: false },
  caco:       { hp: 5, speed: 0.014, damage: 7, range: 6,  cooldown: 55,  scoreOnKill: 200, size: 1.1,  flying: true },
  lostsoul:   { hp: 2, speed: 0.022, damage: 4, range: 0.8,cooldown: 40,  scoreOnKill: 80,  size: 0.7,  flying: true },
  baron:      { hp: 8, speed: 0.018, damage: 8, range: 7,  cooldown: 50,  scoreOnKill: 300, size: 1.2,  flying: false },
  cyberdemon: { hp: 40,speed: 0.020, damage: 12,range: 12, cooldown: 30,  scoreOnKill: 2000, size: 1.6, flying: false, isBoss: true },
};

type Enemy = {
  x: number; y: number;
  hp: number; maxHp: number;
  state: EnemyState;
  t: number;
  shootCooldown: number;
  hurtTime: number;
  deathTime: number;
  type: EnemyType;
  carriesKey?: "red" | "yellow" | "blue";
};

type PickupType = "health" | "armor" | "bullet" | "shell" | "cell" | "rocket" | "weapon_shotgun" | "weapon_chaingun" | "weapon_plasma" | "weapon_rocket" | "weapon_bfg" | "key_red" | "key_yellow" | "key_blue" | "megasphere";
type Pickup = { x: number; y: number; type: PickupType; taken: boolean };

type LevelSpec = {
  map: number[][];
  enemies: Enemy[];
  pickups: Pickup[];
  spawnX: number;
  spawnY: number;
  spawnAngle: number;
  name: string;
  mission: Mission;
};

const LEVEL_NAMES = ["INTRO", "CORRIDOR", "MAZE", "RED ARENA", "GOLD HALLS", "SPIRAL", "LAVA PIT", "FORTRESS", "DEATH HALL", "CYBERDEMON"];

function buildLevel(idx: number, diff: Difficulty): LevelSpec {
  const map = LEVELS[idx];
  const empties: Array<[number, number]> = [];
  for (let y = 1; y < map.length - 1; y++) {
    for (let x = 1; x < map[0].length - 1; x++) {
      if (map[y][x] === 0) empties.push([x, y]);
    }
  }
  let sx = 1.5, sy = 1.5;
  outer: for (let y = 1; y < map.length; y++) {
    for (let x = 1; x < map[0].length; x++) {
      if (map[y][x] === 0) { sx = x + 0.5; sy = y + 0.5; break outer; }
    }
  }
  const rand = (seed: number) => {
    let s = seed;
    return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  };
  const r = rand(idx * 1000 + 7);

  const mission = MISSIONS[idx];
  const sorted = [...empties].sort((a, b) =>
    Math.hypot(a[0] + 0.5 - sx, a[1] + 0.5 - sy) - Math.hypot(b[0] + 0.5 - sx, b[1] + 0.5 - sy),
  );
  const nearSlots = sorted.filter(([x, y]) => {
    const d = Math.hypot(x + 0.5 - sx, y + 0.5 - sy);
    return d > 2.5 && d < 9;
  }).slice(0, 2);
  const usedKeys = new Set(nearSlots.map(([x, y]) => `${x},${y}`));
  usedKeys.add(`${Math.floor(sx)},${Math.floor(sy)}`);
  const remaining = empties.filter(([x, y]) => !usedKeys.has(`${x},${y}`));
  remaining.sort(() => r() - 0.5);
  const ordered = [...nearSlots, ...remaining];

  // Enemy roster
  const enemies: Enemy[] = [];
  const isBossLevel = idx === 9;
  if (isBossLevel) {
    // Boss + ring of supporters
    const center = ordered[Math.floor(ordered.length / 2)] ?? ordered[0];
    enemies.push(makeEnemy(center[0] + 0.5, center[1] + 0.5, "cyberdemon", diff));
    const ring = ordered.slice(0, Math.floor(6 * diff.enemyCountMul));
    for (let i = 0; i < ring.length; i++) {
      const [x, y] = ring[i];
      const t: EnemyType = i % 3 === 0 ? "baron" : i % 3 === 1 ? "caco" : "lostsoul";
      enemies.push(makeEnemy(x + 0.5, y + 0.5, t, diff));
    }
  } else {
    const baseCount = 3 + idx;
    const enemyCount = Math.max(2, Math.round(baseCount * diff.enemyCountMul));
    for (let i = 0; i < Math.min(enemyCount, ordered.length); i++) {
      const [x, y] = ordered[i];
      let type: EnemyType;
      if (idx >= 6 && i === 0) type = "baron";
      else if (idx >= 5 && i === 1) type = "caco";
      else if (idx >= 7 && i === 2) type = "lostsoul";
      else if (idx >= 3 && i % 4 === 3) type = "soldier";
      else if (i === 0 && idx <= 2) type = "zombie";
      else if (i % 3 === 0) type = "demon";
      else type = "imp";
      enemies.push(makeEnemy(x + 0.5, y + 0.5, type, diff));
    }
  }

  // Mission key carrier
  if (mission.type === "find_key_red" || mission.type === "find_key_yellow" || mission.type === "find_key_blue") {
    const key = mission.type === "find_key_red" ? "red" : mission.type === "find_key_yellow" ? "yellow" : "blue";
    // Give to last (= furthest) enemy so player has to clear
    const carrier = enemies[enemies.length - 1] ?? enemies[0];
    if (carrier) carrier.carriesKey = key;
  }

  // Pickups
  const pickups: Pickup[] = [];
  const placePickup = (type: PickupType) => {
    const slot = ordered[enemies.length + pickups.length];
    if (!slot) return;
    const [x, y] = slot;
    pickups.push({ x: x + 0.5, y: y + 0.5, type, taken: false });
  };
  placePickup("health");
  placePickup("bullet");
  if (idx >= 1) placePickup("shell");
  if (idx >= 2) placePickup("armor");
  if (idx >= 4) placePickup("cell");
  if (idx >= 5) placePickup("rocket");
  // Weapons placed on their unlock level
  if (idx === WEAPONS.shotgun.unlockLevel) placePickup("weapon_shotgun");
  if (idx === WEAPONS.chaingun.unlockLevel) placePickup("weapon_chaingun");
  if (idx === WEAPONS.plasma.unlockLevel) placePickup("weapon_plasma");
  if (idx === WEAPONS.rocket.unlockLevel) placePickup("weapon_rocket");
  if (idx === WEAPONS.bfg.unlockLevel) placePickup("weapon_bfg");
  if (idx === 9) placePickup("megasphere"); // boss prep

  return {
    map,
    enemies,
    pickups,
    spawnX: sx,
    spawnY: sy,
    spawnAngle: 0,
    name: LEVEL_NAMES[idx] ?? `LEVEL ${idx + 1}`,
    mission,
  };
}

function makeEnemy(x: number, y: number, type: EnemyType, diff: Difficulty): Enemy {
  const def = ENEMY_DEFS[type];
  const hp = Math.round(def.hp * diff.enemyHpMul);
  return {
    x, y, type,
    hp, maxHp: hp,
    state: "patrol",
    t: Math.random() * Math.PI * 2,
    shootCooldown: 0,
    hurtTime: 0,
    deathTime: 0,
  };
}

// ---------- sprites (8x8 pixel font) ----------
type SpriteFrames = { idle: string[]; walk: string[]; dead: string[] };

const ENEMY_SPRITES: Record<EnemyType, SpriteFrames> = {
  zombie: {
    idle: ["..XGGX..",".XGGGGX.","XGYGGYGX","XGGGGGGX","XGRGRGGX","XGGGGGGX",".XGGGGX.",".X....X."],
    walk: ["..XGGX..",".XGGGGX.","XGYGGYGX","XGGGGGGX","XGRGRGGX","XGGGGGGX",".XGGGGX.","X.X..X.X"],
    dead: ["........","........","........",".XGGGGX.","XGGGGGGX","XGRRRRGX","XGGGGGGX","XXXXXXXX"],
  },
  imp: {
    idle: ["..XXXX..",".XRRRRX.","XRWRRWRX","XRRRRRRX","XRRGGRRX",".XRRRRX.","..XXXX..","..X..X.."],
    walk: ["..XXXX..",".XRRRRX.","XRWRRWRX","XRRRRRRX","XRRGGRRX",".XRRRRX.","..XXXX..",".X....X."],
    dead: ["........","........","........","........","..XXXX..",".XRRRRX.","XRRRRRRX","XXXXXXXX"],
  },
  soldier: {
    idle: ["..XGGX..",".XGWWGX.","XGYGGYGX","XGGGGGGX","XGRRRRGX","XGGGGGGX",".XGGGGX.",".X.XX.X."],
    walk: ["..XGGX..",".XGWWGX.","XGYGGYGX","XGGGGGGX","XGRRRRGX","XGGGGGGX",".XGGGGX.","X.XXXX.X"],
    dead: ["........","........","........",".XGGGGX.","XGGGGGGX","XGRRRRGX","XGGGGGGX","XXXXXXXX"],
  },
  demon: {
    idle: [".XXXXXX.","XRRRRRRX","XRYRRYRX","RRRBBRRR","XRRWWWRX","XRRRRRRX","XXXXXXXX",".X.XX.X."],
    walk: [".XXXXXX.","XRRRRRRX","XRYRRYRX","RRRBBRRR","XRRWWWRX","XRRRRRRX","XXXXXXXX","X.X..X.X"],
    dead: ["........","........","........",".XXXXXX.","XRRRRRRX","XRRYRRRX","XRRRRRRX","XXXXXXXX"],
  },
  caco: {
    idle: ["..XXXX..",".XBBBBX.","XBWBBWBX","XBBYYBBX","XBBRRBBX","XBBBBBBX",".XBBBBX.","..XBBX.."],
    walk: ["..XXXX..",".XBBBBX.","XBYBBYBX","XBBWWBBX","XBBRRBBX","XBBBBBBX",".XBBBBX.","..X..X.."],
    dead: ["........","........","........",".XXXXXX.","XBBBBBBX","XBBRRBBX","XBBBBBBX","XXXXXXXX"],
  },
  lostsoul: {
    idle: ["..XYYX..",".XYRYRX.","XYRWWWRX","XYRRYRRX","XYYRRYXY",".XYYYYX.","..XYYX..","..Y..Y.."],
    walk: ["..XYYX..",".XYRRRX.","XYRWWWRX","XYRYYYYX","XYRRYRYX",".XYYYYX.","..XYYX..","..R..R.."],
    dead: ["........","........","........","........","..XYYX..",".XYYYYX.","XYRRRRYX","XXXXXXXX"],
  },
  baron: {
    idle: ["XXXXXXXX","XPPPPPPX","XPYPPYPX","PPPRRPPP","XPRRWRPX","XPPRRPPX","XPPPPPPX","XX.XX.XX"],
    walk: ["XXXXXXXX","XPPPPPPX","XPYPPYPX","PPPRRPPP","XPRRWRPX","XPPRRPPX","XPPPPPPX","X.X..X.X"],
    dead: ["........","........","........","XXXXXXXX","XPPRRPPX","XPRRRRPX","XPPPPPPX","XXXXXXXX"],
  },
  cyberdemon: {
    idle: ["XXRRRRXX","XRRWWRRX","RRYRRYRR","RRRBBRRR","RRRRRRRR","XRRGGRRX","XRR..RRX","XR....RX"],
    walk: ["XXRRRRXX","XRRWWRRX","RRYRRYRR","RRRBBRRR","RRRRRRRR","XRRGGRRX","XRR..RRX","R......R"],
    dead: ["........","........","XXRRRRXX","XRRWWRRX","RRRYYRRRR","RRRRRRRRR","XRRGGRRX","XXXXXXXX"],
  },
};

function colorFor(ch: string, shade: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.floor(n * shade)));
  switch (ch) {
    case "X": return `rgb(${c(40)},${c(20)},${c(20)})`;
    case "R": return `rgb(${c(220)},${c(60)},${c(45)})`;
    case "W": return `rgb(${c(255)},${c(255)},${c(240)})`;
    case "G": return `rgb(${c(240)},${c(170)},${c(50)})`;
    case "Y": return `rgb(${c(245)},${c(225)},${c(80)})`;
    case "B": return `rgb(${c(40)},${c(40)},${c(120)})`;
    case "P": return `rgb(${c(140)},${c(50)},${c(170)})`;
    default: return "transparent";
  }
}

const PICKUP_VIS: Record<PickupType, { fill: string; emoji: string; label: string }> = {
  health:          { fill: "rgb(220,40,40)",  emoji: "+",  label: "+25 HP" },
  armor:           { fill: "rgb(50,150,250)", emoji: "♢",  label: "+25 ARMOR" },
  bullet:          { fill: "rgb(240,210,50)", emoji: "▣",  label: "+20 bullets" },
  shell:           { fill: "rgb(240,140,50)", emoji: "▦",  label: "+8 shells" },
  cell:            { fill: "rgb(120,180,250)",emoji: "⚡",  label: "+30 cells" },
  rocket:          { fill: "rgb(190,50,50)",  emoji: "►",  label: "+5 rockets" },
  weapon_shotgun:  { fill: "rgb(240,140,50)", emoji: "S",  label: "SHOTGUN" },
  weapon_chaingun: { fill: "rgb(240,210,50)", emoji: "C",  label: "CHAINGUN" },
  weapon_plasma:   { fill: "rgb(120,180,250)",emoji: "P",  label: "PLASMA RIFLE" },
  weapon_rocket:   { fill: "rgb(190,50,50)",  emoji: "R",  label: "ROCKET LAUNCHER" },
  weapon_bfg:      { fill: "rgb(60,255,140)", emoji: "B",  label: "BFG 9000" },
  key_red:         { fill: "rgb(220,40,40)",  emoji: "♦",  label: "RED KEY" },
  key_yellow:      { fill: "rgb(240,210,50)", emoji: "◆",  label: "YELLOW KEY" },
  key_blue:        { fill: "rgb(50,150,250)", emoji: "●",  label: "BLUE KEY" },
  megasphere:      { fill: "rgb(0,255,180)",  emoji: "★",  label: "MEGASPHERE" },
};

const WALL_COLORS: Record<number, [number, number, number]> = {
  1: [0xa0, 0xa0, 0xb0],
  2: [0xc0, 0x39, 0x2b],
  3: [0x40, 0xe0, 0x60],
  4: [0xfb, 0xc5, 0x31],
  5: [0x40, 0x40, 0x50],
  6: [0xc0, 0x39, 0x2b], // red door
  7: [0xfb, 0xc5, 0x31], // yellow door
  8: [0x50, 0x90, 0xff], // blue door
  9: [0xff, 0x66, 0x10], // lava
};

const HIGH_KEY = "delos.doom.high";
const LEVEL_KEY = "delos.doom.level";
const DIFF_KEY = "delos.doom.diff";

// ---------- WebAudio (no asset deps) ----------
function beep(audioCtx: AudioContext | null, freq: number, dur: number, type: OscillatorType = "square", vol = 0.05) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(vol, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + dur);
}

export function DoomGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<AudioContext | null>(null);

  const [levelIdx, setLevelIdx] = useState(0);
  const [tick, setTick] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [paused, setPaused] = useState(false);
  const [showLevelScreen, setShowLevelScreen] = useState<"start" | "diff" | "brief" | "complete" | "gameover" | "victory" | null>("diff");
  const [diffId, setDiffId] = useState<DifficultyId>("normal");
  const [locked, setLocked] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const hintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const diff = DIFFICULTIES.find((d) => d.id === diffId) ?? DIFFICULTIES[2];
  const levelRef = useRef<LevelSpec>(buildLevel(0, diff));
  const stateRef = useRef({
    px: 1.5,
    py: 1.5,
    pa: 0,
    walkPhase: 0,
    keys: new Set<string>(),
    enemies: [] as Enemy[],
    pickups: [] as Pickup[],
    projectiles: [] as Array<{ x: number; y: number; vx: number; vy: number; t: number; from: "player" | "enemy"; dmg: number; splash?: number; color: string }>,
    blood: [] as Array<{ x: number; y: number; t: number; size: number }>,
    muzzle: 0,
    hp: 100,
    maxHp: 100,
    armor: 0,
    maxArmor: 100,
    score: 0,
    flash: 0,
    shake: 0,
    won: false,
    over: false,
    currentWeapon: "pistol" as WeaponId,
    weaponsOwned: { fist: true, pistol: true, shotgun: false, chaingun: false, plasma: false, rocket: false, bfg: false } as Record<WeaponId, boolean>,
    ammo: { bullet: 30, shell: 0, cell: 0, rocket: 0 } as Record<Exclude<AmmoType, "none">, number>,
    fireCooldown: 0,
    keysHeld: { red: false, yellow: false, blue: false } as Record<"red" | "yellow" | "blue", boolean>,
    levelStartTime: Date.now(),
    enemiesKilled: 0,
  });

  function showHint(msg: string, ms = 4000) {
    setHint(msg);
    if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);
    hintTimeoutRef.current = setTimeout(() => setHint(null), ms);
  }

  function loadLevel(idx: number) {
    const d = DIFFICULTIES.find((dd) => dd.id === diffId) ?? DIFFICULTIES[2];
    const spec = buildLevel(idx, d);
    levelRef.current = spec;
    const s = stateRef.current;
    s.px = spec.spawnX;
    s.py = spec.spawnY;
    s.pa = spec.spawnAngle;
    s.enemies = spec.enemies;
    s.pickups = spec.pickups;
    s.projectiles = [];
    s.blood = [];
    s.muzzle = 0;
    s.flash = 0;
    s.shake = 0;
    s.won = false;
    s.over = false;
    s.keysHeld = { red: false, yellow: false, blue: false };
    s.levelStartTime = Date.now();
    s.enemiesKilled = 0;
    s.fireCooldown = 0;
    setTick((t) => t + 1);
  }

  useEffect(() => {
    try {
      const h = Number(localStorage.getItem(HIGH_KEY) ?? 0);
      if (h > 0) setHighScore(h);
      const savedDiff = localStorage.getItem(DIFF_KEY);
      if (savedDiff && DIFFICULTIES.find((d) => d.id === savedDiff)) setDiffId(savedDiff as DifficultyId);
    } catch {}
  }, []);

  function ensureAudio() {
    if (!audioRef.current) {
      try {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioRef.current = new Ctx();
      } catch {}
    }
    return audioRef.current;
  }

  function reset(toLevel = 0) {
    const s = stateRef.current;
    const d = DIFFICULTIES.find((dd) => dd.id === diffId) ?? DIFFICULTIES[2];
    s.maxHp = Math.round(100 * d.playerHpMul);
    s.hp = s.maxHp;
    s.armor = 0;
    s.maxArmor = 100;
    s.score = 0;
    s.currentWeapon = "pistol";
    s.weaponsOwned = { fist: true, pistol: true, shotgun: false, chaingun: false, plasma: false, rocket: false, bfg: false };
    s.ammo = {
      bullet: Math.round(30 * d.ammoMul),
      shell: 0,
      cell: 0,
      rocket: 0,
    };
    setLevelIdx(toLevel);
    loadLevel(toLevel);
    setShowLevelScreen("brief");
  }

  function nextLevel() {
    const s = stateRef.current;
    if (levelIdx >= LEVELS.length - 1) {
      setShowLevelScreen("victory");
      try {
        const h = Math.max(highScore, s.score);
        localStorage.setItem(HIGH_KEY, String(h));
        setHighScore(h);
      } catch {}
      return;
    }
    const nl = levelIdx + 1;
    s.score += 200;
    setLevelIdx(nl);
    loadLevel(nl);
    setShowLevelScreen("complete");
    try { localStorage.setItem(LEVEL_KEY, String(nl)); } catch {}
  }

  function startLevel() {
    setShowLevelScreen(null);
    const cv = canvasRef.current;
    if (cv && document.pointerLockElement !== cv) {
      try { cv.requestPointerLock(); } catch {}
    }
    ensureAudio();
    const lvl = levelRef.current;
    showHint(lvl.mission.hint, 6000);
  }

  function selectDifficulty(id: DifficultyId) {
    setDiffId(id);
    try { localStorage.setItem(DIFF_KEY, id); } catch {}
    const d = DIFFICULTIES.find((dd) => dd.id === id) ?? DIFFICULTIES[2];
    const s = stateRef.current;
    s.maxHp = Math.round(100 * d.playerHpMul);
    s.hp = s.maxHp;
    s.ammo.bullet = Math.round(30 * d.ammoMul);
    setShowLevelScreen("brief");
    loadLevel(0);
  }

  function switchWeapon(id: WeaponId) {
    const s = stateRef.current;
    if (!s.weaponsOwned[id]) {
      showHint(`Weapon locked: ${WEAPONS[id].name}. Find it on level ${WEAPONS[id].unlockLevel + 1}.`, 2500);
      return;
    }
    const w = WEAPONS[id];
    if (w.ammoType !== "none" && s.ammo[w.ammoType] < w.ammoPerShot) {
      showHint(`No ${w.ammoType} for ${w.name}.`, 1800);
    }
    s.currentWeapon = id;
    beep(audioRef.current, 600, 0.05, "sine", 0.04);
    setTick((t) => t + 1);
  }

  function isWall(x: number, y: number): number {
    const map = levelRef.current.map;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (iy < 0 || iy >= map.length || ix < 0 || ix >= map[0].length) return 1;
    return map[iy][ix];
  }

  // Walls block (incl. locked doors); lava (9) and exit (3) don't block movement
  function isBlocking(x: number, y: number): boolean {
    const t = isWall(x, y);
    const s = stateRef.current;
    if (t === 0 || t === 3 || t === 9) return false;
    if (t === 6 && s.keysHeld.red) return false;
    if (t === 7 && s.keysHeld.yellow) return false;
    if (t === 8 && s.keysHeld.blue) return false;
    return true;
  }

  function fireWeapon() {
    const s = stateRef.current;
    if (s.over || showLevelScreen) return;
    const w = WEAPONS[s.currentWeapon];
    if (s.fireCooldown > 0) return;
    if (w.ammoType !== "none" && s.ammo[w.ammoType] < w.ammoPerShot) {
      beep(audioRef.current, 100, 0.08, "square", 0.04);
      s.flash = 0.2;
      return;
    }
    if (w.ammoType !== "none") s.ammo[w.ammoType] -= w.ammoPerShot;
    s.fireCooldown = w.fireDelay;
    s.muzzle = 1;
    s.shake = w.recoil * 0.5;

    // Sound by weapon
    const ac = audioRef.current;
    if (w.id === "pistol")     beep(ac, 900, 0.06, "square", 0.05);
    else if (w.id === "shotgun")  { beep(ac, 200, 0.08, "sawtooth", 0.08); beep(ac, 120, 0.12, "sawtooth", 0.05); }
    else if (w.id === "chaingun") beep(ac, 700 + Math.random() * 200, 0.04, "square", 0.04);
    else if (w.id === "plasma")   beep(ac, 1400, 0.05, "sine", 0.05);
    else if (w.id === "rocket")   beep(ac, 80, 0.2, "sawtooth", 0.1);
    else if (w.id === "bfg")      { beep(ac, 60, 0.4, "sawtooth", 0.12); beep(ac, 1800, 0.4, "sine", 0.06); }
    else                          beep(ac, 250, 0.05, "square", 0.04);

    // Rocket / BFG fire projectiles
    if (w.id === "rocket" || w.id === "bfg") {
      const cosA = Math.cos(s.pa);
      const sinA = Math.sin(s.pa);
      const speed = w.id === "bfg" ? 0.18 : 0.22;
      s.projectiles.push({
        x: s.px + cosA * 0.4,
        y: s.py + sinA * 0.4,
        vx: cosA * speed,
        vy: sinA * speed,
        t: 1.5,
        from: "player",
        dmg: w.damage,
        splash: w.splash,
        color: w.id === "bfg" ? "rgb(60,255,140)" : "rgb(255,140,40)",
      });
      return;
    }

    // Hitscan weapons (fist / pistol / shotgun / chaingun / plasma)
    for (let pellet = 0; pellet < w.pellets; pellet++) {
      const spreadA = (Math.random() - 0.5) * w.spread * 2;
      const aa = s.pa + spreadA;
      const cosA = Math.cos(aa);
      const sinA = Math.sin(aa);
      const hit = traceShot(s.px, s.py, cosA, sinA, w.range);
      if (hit) {
        hit.hp -= w.damage;
        hit.hurtTime = 0.4;
        hit.state = "hurt";
        for (let bi = 0; bi < 6; bi++) {
          s.blood.push({
            x: hit.x + (Math.random() - 0.5) * 0.3,
            y: hit.y + (Math.random() - 0.5) * 0.3,
            t: 1,
            size: 0.05 + Math.random() * 0.08,
          });
        }
        if (hit.hp <= 0) killEnemy(hit);
        else {
          s.score += 10;
          setTimeout(() => { if (hit.state === "hurt") hit.state = "chase"; }, 200);
        }
      }
    }
    setTick((t) => t + 1);
  }

  function traceShot(ox: number, oy: number, cosA: number, sinA: number, range: number): Enemy | null {
    const s = stateRef.current;
    let best: Enemy | null = null;
    let bestD = Infinity;
    for (const e of s.enemies) {
      if (e.state === "dead") continue;
      const dx = e.x - ox;
      const dy = e.y - oy;
      const d = Math.hypot(dx, dy);
      if (d > range) continue;
      const dot = (dx / d) * cosA + (dy / d) * sinA;
      const cross = Math.abs(dx * sinA - dy * cosA) / d;
      const tolerance = ENEMY_DEFS[e.type].size * 0.22;
      if (dot < 0) continue;
      if (cross > tolerance) continue;
      // wall blocking
      let blocked = false;
      const steps = Math.max(4, Math.floor(d * 8));
      for (let i = 1; i < steps; i++) {
        const tt = i / steps;
        const ix = ox + dx * tt;
        const iy = oy + dy * tt;
        const t = isWall(ix, iy);
        if (t && t !== 3 && t !== 9) {
          if ((t === 6 && s.keysHeld.red) || (t === 7 && s.keysHeld.yellow) || (t === 8 && s.keysHeld.blue)) continue;
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      if (d < bestD) { best = e; bestD = d; }
    }
    return best;
  }

  function killEnemy(e: Enemy) {
    const s = stateRef.current;
    const def = ENEMY_DEFS[e.type];
    e.state = "dead";
    e.deathTime = Date.now();
    s.score += def.scoreOnKill;
    s.enemiesKilled += 1;
    // Drop key if carrier
    if (e.carriesKey) {
      const carried = e.carriesKey;
      const t: PickupType = carried === "red" ? "key_red" : carried === "yellow" ? "key_yellow" : "key_blue";
      s.pickups.push({ x: e.x, y: e.y, type: t, taken: false });
      e.carriesKey = undefined;
      const label = carried === "red" ? "Red" : carried === "yellow" ? "Yellow" : "Blue";
      showHint(`${label} key dropped! Pick it up.`, 3500);
    }
    beep(audioRef.current, 200, 0.15, "sawtooth", 0.06);
    // Big gore
    for (let bi = 0; bi < 20; bi++) {
      s.blood.push({
        x: e.x + (Math.random() - 0.5) * 0.6,
        y: e.y + (Math.random() - 0.5) * 0.6,
        t: 1.5,
        size: 0.08 + Math.random() * 0.15,
      });
    }
  }

  function damageEnemyAOE(cx: number, cy: number, radius: number, dmg: number) {
    const s = stateRef.current;
    for (const e of s.enemies) {
      if (e.state === "dead") continue;
      const d = Math.hypot(e.x - cx, e.y - cy);
      if (d > radius) continue;
      const falloff = 1 - d / radius;
      e.hp -= dmg * falloff;
      e.hurtTime = 0.4;
      e.state = "hurt";
      if (e.hp <= 0) killEnemy(e);
    }
    // Splash hurts player too (rocket self-damage)
    const dPlayer = Math.hypot(s.px - cx, s.py - cy);
    if (dPlayer < radius) {
      const dmgP = dmg * 0.4 * (1 - dPlayer / radius);
      applyPlayerDamage(dmgP);
    }
  }

  function applyPlayerDamage(dmg: number) {
    const s = stateRef.current;
    const absorbed = Math.min(s.armor, dmg * 0.6);
    s.armor -= absorbed;
    s.hp -= dmg - absorbed;
    s.flash = Math.min(1, s.flash + dmg / 40);
    s.shake = Math.min(1, s.shake + dmg / 30);
  }

  // Keyboard
  useEffect(() => {
    function kd(e: KeyboardEvent) {
      const k = e.key.toLowerCase();
      const trapKeys = ["w","a","s","d","arrowup","arrowdown","arrowleft","arrowright"," ","shift","escape","p","e","r","m","1","2","3","4","5","6","7","tab"];
      if (trapKeys.includes(k)) {
        if (k !== "escape") e.preventDefault();
        if (k === "p") setPaused((p) => !p);
        if (k === "m") setShowMap((v) => !v);
        if (k === "r" && (stateRef.current.over || showLevelScreen === "gameover")) reset(0);
        if (k === " " || k === "e") { fireWeapon(); return; }
        if (k === "tab") {
          // cycle weapon
          const s = stateRef.current;
          const owned = WEAPON_ORDER.filter((w) => s.weaponsOwned[w]);
          const i = owned.indexOf(s.currentWeapon);
          switchWeapon(owned[(i + 1) % owned.length]);
          return;
        }
        if (["1","2","3","4","5","6","7"].includes(k)) {
          switchWeapon(WEAPON_ORDER[Number(k) - 1]);
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

  // Pointer lock + mouse look + click fire
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
      fireWeapon();
    }
    function onWheel(e: WheelEvent) {
      if (showLevelScreen) return;
      e.preventDefault();
      const s = stateRef.current;
      const owned = WEAPON_ORDER.filter((w) => s.weaponsOwned[w]);
      const i = owned.indexOf(s.currentWeapon);
      const next = owned[(i + (e.deltaY > 0 ? 1 : -1) + owned.length) % owned.length];
      switchWeapon(next);
    }
    cv.addEventListener("click", onClick);
    cv.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("mousemove", onMove);
    document.addEventListener("pointerlockchange", onLockChange);
    return () => {
      cv.removeEventListener("click", onClick);
      cv.removeEventListener("wheel", onWheel);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("pointerlockchange", onLockChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLevelScreen]);

  // ---- main loop ----
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx2d = cv.getContext("2d");
    if (!ctx2d) return;
    const ctx: CanvasRenderingContext2D = ctx2d;
    let raf = 0;

    function tryMove(nx: number, ny: number, ox: number, oy: number): [number, number] {
      // Collision with radius — allow sliding along walls
      let fx = ox, fy = oy;
      if (!isBlocking(nx + PLAYER_RADIUS, oy) && !isBlocking(nx - PLAYER_RADIUS, oy)) fx = nx;
      if (!isBlocking(fx, ny + PLAYER_RADIUS) && !isBlocking(fx, ny - PLAYER_RADIUS)) fy = ny;
      return [fx, fy];
    }

    function step() {
      if (paused || showLevelScreen) {
        renderFrame();
        raf = requestAnimationFrame(step);
        return;
      }
      const s = stateRef.current;
      const lvl = levelRef.current;
      const diffNow = DIFFICULTIES.find((dd) => dd.id === diffId) ?? DIFFICULTIES[2];

      if (s.keys.has("arrowleft")) s.pa -= ROT_SPEED;
      if (s.keys.has("arrowright")) s.pa += ROT_SPEED;

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
        const [nx, ny] = tryMove(s.px + dx, s.py + dy, s.px, s.py);
        s.px = nx; s.py = ny;
        s.walkPhase += sp * 8;
      } else {
        s.walkPhase *= 0.92;
      }

      // Lava damage
      if (isWall(s.px, s.py) === 9) {
        s.hp -= 0.15;
        s.flash = Math.max(s.flash, 0.3);
      }

      // Exit
      if (isWall(s.px, s.py) === 3) {
        const completed = checkMission();
        if (completed) {
          beep(audioRef.current, 1600, 0.4, "sine", 0.06);
          nextLevel();
        } else {
          showHint(missionStatus(), 2500);
        }
      }

      // Pickup collection
      for (const p of s.pickups) {
        if (p.taken) continue;
        const dd = Math.hypot(p.x - s.px, p.y - s.py);
        if (dd < 0.5) {
          p.taken = true;
          applyPickup(p.type);
        }
      }

      // Fire cooldown
      if (s.fireCooldown > 0) s.fireCooldown -= 1;

      // Enemy AI
      for (const e of s.enemies) {
        if (e.state === "dead") continue;
        e.t += 0.05;
        if (e.hurtTime > 0) e.hurtTime -= 0.02;
        const def = ENEMY_DEFS[e.type];
        const edx = s.px - e.x;
        const edy = s.py - e.y;
        const ed = Math.hypot(edx, edy);

        if (e.state === "hurt" && e.hurtTime <= 0) e.state = "chase";
        const aggroRange = def.isBoss ? 30 : 6;
        if (e.state === "patrol" && ed < aggroRange) e.state = "chase";
        if (e.state === "chase" && ed > aggroRange * 1.6 && !def.isBoss) e.state = "patrol";

        if (e.state === "chase" && ed < def.range && e.shootCooldown <= 0) {
          e.state = "shoot";
          e.shootCooldown = Math.round(def.cooldown * diffNow.enemyShootMul);
        }
        if (e.shootCooldown > 0) e.shootCooldown -= 1;

        if (e.state === "shoot") {
          let blocked = false;
          const steps = Math.max(4, Math.floor(ed * 6));
          for (let i = 1; i < steps; i++) {
            const tt = i / steps;
            const ix = e.x + edx * tt;
            const iy = e.y + edy * tt;
            const t = isWall(ix, iy);
            if (t && t !== 3 && t !== 9 && !(t === 6 && s.keysHeld.red) && !(t === 7 && s.keysHeld.yellow) && !(t === 8 && s.keysHeld.blue)) {
              blocked = true; break;
            }
          }
          if (!blocked) {
            // Boss: fire rockets. Caco/lostsoul: fireball. Others: hitscan.
            if (e.type === "cyberdemon") {
              const nrm = ed > 0.001 ? 1 / ed : 1;
              s.projectiles.push({
                x: e.x, y: e.y,
                vx: edx * nrm * 0.10,
                vy: edy * nrm * 0.10,
                t: 4,
                from: "enemy",
                dmg: def.damage * diffNow.enemyDmgMul,
                splash: 1.5,
                color: "rgb(255,80,40)",
              });
            } else if (e.type === "caco" || e.type === "baron") {
              const nrm = ed > 0.001 ? 1 / ed : 1;
              s.projectiles.push({
                x: e.x, y: e.y,
                vx: edx * nrm * 0.09,
                vy: edy * nrm * 0.09,
                t: 4,
                from: "enemy",
                dmg: def.damage * diffNow.enemyDmgMul,
                color: e.type === "baron" ? "rgb(120,40,170)" : "rgb(60,140,220)",
              });
            } else {
              applyPlayerDamage(def.damage * diffNow.enemyDmgMul);
            }
            beep(audioRef.current, 300 + Math.random() * 200, 0.06, "sawtooth", 0.04);
          }
          e.state = "chase";
        }

        if (e.state === "patrol" || e.state === "chase") {
          const sp = def.speed * diffNow.enemySpeedMul;
          let tx = 0, ty = 0;
          if (e.state === "chase") {
            tx = edx / Math.max(ed, 0.001);
            ty = edy / Math.max(ed, 0.001);
          } else {
            tx = Math.cos(e.t);
            ty = Math.sin(e.t);
          }
          const nx = e.x + tx * sp;
          const ny = e.y + ty * sp;
          // Flying enemies ignore most walls (still bounded by border)
          if (def.flying) {
            if (isWall(nx, e.y) !== 1) e.x = nx;
            if (isWall(e.x, ny) !== 1) e.y = ny;
          } else {
            if (!isBlocking(nx, e.y)) e.x = nx;
            if (!isBlocking(e.x, ny)) e.y = ny;
          }
          // Melee dmg
          const melee = def.flying ? 0.4 : 0.5;
          if (ed < melee) {
            applyPlayerDamage(0.3 * def.damage * 0.4 * diffNow.enemyDmgMul);
          }
        }
      }

      // Projectiles update
      for (const p of s.projectiles) {
        p.x += p.vx;
        p.y += p.vy;
        p.t -= 1 / 60;
        const wallHit = isWall(p.x, p.y);
        let explode = false;
        if (wallHit && wallHit !== 3 && wallHit !== 9) explode = true;
        if (p.t <= 0) explode = true;
        // Hit player (enemy projectile)
        if (p.from === "enemy") {
          const d = Math.hypot(p.x - s.px, p.y - s.py);
          if (d < 0.4) { explode = true; }
        } else {
          // Player projectile vs enemies
          for (const e of s.enemies) {
            if (e.state === "dead") continue;
            const d = Math.hypot(p.x - e.x, p.y - e.y);
            if (d < ENEMY_DEFS[e.type].size * 0.35) { explode = true; break; }
          }
        }
        if (explode) {
          if (p.splash) damageEnemyAOE(p.x, p.y, p.splash, p.dmg);
          else if (p.from === "enemy") applyPlayerDamage(p.dmg);
          else {
            const target = traceShot(p.x - p.vx * 5, p.y - p.vy * 5, p.vx, p.vy, 1);
            if (target) {
              target.hp -= p.dmg;
              target.hurtTime = 0.4;
              if (target.hp <= 0) killEnemy(target);
            }
          }
          s.shake = Math.max(s.shake, 0.4);
          p.t = -1;
          beep(audioRef.current, 120, 0.15, "sawtooth", 0.06);
        }
      }
      s.projectiles = s.projectiles.filter((p) => p.t > 0);

      s.muzzle *= 0.82;
      s.flash *= 0.88;
      s.shake *= 0.85;
      for (const b of s.blood) b.t -= 0.005;
      s.blood = s.blood.filter((b) => b.t > 0);

      if (s.hp <= 0) {
        s.hp = 0;
        s.over = true;
        setShowLevelScreen("gameover");
        beep(audioRef.current, 80, 0.6, "sawtooth", 0.1);
        try {
          const h = Math.max(highScore, s.score);
          localStorage.setItem(HIGH_KEY, String(h));
          setHighScore(h);
        } catch {}
      }

      // Nightmare: respawn weak enemies every 12s
      if (diffNow.id === "nightmare" && Math.floor((Date.now() - s.levelStartTime) / 1000) > 0 && (Date.now() - s.levelStartTime) % 12000 < 50) {
        for (const e of s.enemies) {
          if (e.state === "dead" && (e.type === "zombie" || e.type === "imp")) {
            e.state = "patrol"; e.hp = e.maxHp; e.deathTime = 0;
          }
        }
      }

      void lvl; // silence
      renderFrame();
      raf = requestAnimationFrame(step);
    }

    function checkMission(): boolean {
      const s = stateRef.current;
      const lvl = levelRef.current;
      const m = lvl.mission;
      if (m.type === "exit") return true;
      if (m.type === "kill_all") return s.enemies.every((e) => e.state === "dead");
      if (m.type === "kill_boss") return s.enemies.filter((e) => ENEMY_DEFS[e.type].isBoss).every((e) => e.state === "dead");
      if (m.type === "find_key_red")    return s.keysHeld.red;
      if (m.type === "find_key_yellow") return s.keysHeld.yellow;
      if (m.type === "find_key_blue")   return s.keysHeld.blue;
      return true;
    }

    function missionStatus(): string {
      const s = stateRef.current;
      const lvl = levelRef.current;
      const m = lvl.mission;
      if (m.type === "kill_all") {
        const left = s.enemies.filter((e) => e.state !== "dead").length;
        return `Mission incomplete: ${left} demon${left === 1 ? "" : "s"} remain.`;
      }
      if (m.type === "kill_boss") return "Boss still alive. Empty the BFG.";
      if (m.type === "find_key_red")    return "Need RED KEY first.";
      if (m.type === "find_key_yellow") return "Need YELLOW KEY first.";
      if (m.type === "find_key_blue")   return "Need BLUE KEY first.";
      return "Find the exit.";
    }

    function applyPickup(t: PickupType) {
      const s = stateRef.current;
      const ac = audioRef.current;
      beep(ac, 1200, 0.05, "sine", 0.04);
      const v = PICKUP_VIS[t].label;
      switch (t) {
        case "health":          s.hp = Math.min(s.maxHp, s.hp + 25); break;
        case "armor":           s.armor = Math.min(s.maxArmor, s.armor + 25); break;
        case "bullet":          s.ammo.bullet += 20; break;
        case "shell":           s.ammo.shell += 8; break;
        case "cell":            s.ammo.cell += 30; break;
        case "rocket":          s.ammo.rocket += 5; break;
        case "weapon_shotgun":  s.weaponsOwned.shotgun = true; s.ammo.shell += 8; s.currentWeapon = "shotgun"; showHint("SHOTGUN acquired! Press 3.", 3500); break;
        case "weapon_chaingun": s.weaponsOwned.chaingun = true; s.ammo.bullet += 25; s.currentWeapon = "chaingun"; showHint("CHAINGUN acquired! Press 4.", 3500); break;
        case "weapon_plasma":   s.weaponsOwned.plasma = true; s.ammo.cell += 30; s.currentWeapon = "plasma"; showHint("PLASMA RIFLE acquired! Press 5.", 3500); break;
        case "weapon_rocket":   s.weaponsOwned.rocket = true; s.ammo.rocket += 4; s.currentWeapon = "rocket"; showHint("ROCKET LAUNCHER! Don't stand too close. Press 6.", 3500); break;
        case "weapon_bfg":      s.weaponsOwned.bfg = true; s.ammo.cell += 40; s.currentWeapon = "bfg"; showHint("BFG 9000 acquired! 20 cells per shot. Press 7.", 4500); break;
        case "key_red":         s.keysHeld.red = true; showHint("RED key — red doors now open.", 3500); break;
        case "key_yellow":      s.keysHeld.yellow = true; showHint("YELLOW key — yellow doors now open.", 3500); break;
        case "key_blue":        s.keysHeld.blue = true; showHint("BLUE key — blue doors now open.", 3500); break;
        case "megasphere":      s.hp = s.maxHp + 100; s.armor = s.maxArmor + 100; showHint("MEGASPHERE: 200/200!", 3500); break;
      }
      void v;
      s.score += 25;
    }

    function renderFrame() {
      const s = stateRef.current;
      const lvl = levelRef.current;
      const shakeX = (Math.random() - 0.5) * s.shake * 4;
      const shakeY = (Math.random() - 0.5) * s.shake * 4;
      ctx.save();
      ctx.translate(shakeX, shakeY);

      const bobY = Math.sin(s.walkPhase) * 1.2;

      // Sky
      const skyGrad = ctx.createLinearGradient(0, 0, 0, H / 2);
      skyGrad.addColorStop(0, "#08051c");
      skyGrad.addColorStop(0.6, "#1a0a2a");
      skyGrad.addColorStop(1, "#4a1a5a");
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, W, H / 2 + bobY);
      // Floor
      const floorGrad = ctx.createLinearGradient(0, H / 2, 0, H);
      floorGrad.addColorStop(0, "#2a1408");
      floorGrad.addColorStop(0.5, "#180a04");
      floorGrad.addColorStop(1, "#040201");
      ctx.fillStyle = floorGrad;
      ctx.fillRect(0, H / 2 + bobY, W, H / 2 - bobY);
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

      // Raycast
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
          if (hit && hit !== 9) {
            // Treat unlocked doors as passable in raycast
            if ((hit === 6 && s.keysHeld.red) || (hit === 7 && s.keysHeld.yellow) || (hit === 8 && s.keysHeld.blue)) continue;
            break;
          }
        }
        depth *= Math.cos(rayA - s.pa);
        zbuf[r] = depth;
        const wallH = Math.min(H * 2, (H * 0.95) / Math.max(depth, 0.1));
        const y0 = H / 2 - wallH / 2 + bobY;
        const color = WALL_COLORS[hit] ?? [200, 200, 200];
        const shade = Math.max(0.1, 1 - depth / 12);
        const fog = Math.max(0, Math.min(1, (depth - 8) / 12));
        const hitX = s.px + cosA * depth;
        const hitY = s.py + sinA * depth;
        const u = Math.abs(cosA) > Math.abs(sinA) ? (hitY - Math.floor(hitY)) : (hitX - Math.floor(hitX));
        const colSeed = Math.floor(u * 8) + hit * 7;
        const noise = ((colSeed * 9301 + 49297) % 233280) / 233280;
        let texMul = 0.85 + 0.3 * noise;
        if (hit === 5) texMul *= 0.7;
        if (hit === 4) texMul = 1.05 + 0.1 * noise;
        if (hit === 6 || hit === 7 || hit === 8) texMul = 1.1; // doors bright
        const mortarEdge = u < 0.06 || u > 0.94;
        if (mortarEdge) texMul *= 0.6;
        let cr = Math.floor(color[0] * shade * texMul);
        let cg = Math.floor(color[1] * shade * texMul);
        let cb = Math.floor(color[2] * shade * texMul);
        cr = Math.floor(cr * (1 - fog) + 0x1a * fog);
        cg = Math.floor(cg * (1 - fog) + 0x0a * fog);
        cb = Math.floor(cb * (1 - fog) + 0x2a * fog);
        ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
        ctx.fillRect(r, y0, 1, wallH);
        const mortarColor = `rgba(0,0,0,${0.35 - fog * 0.3})`;
        ctx.fillStyle = mortarColor;
        const rowsPerWall = 4;
        for (let mi = 0; mi < rowsPerWall; mi++) {
          const my = y0 + (wallH * (mi + 0.5)) / rowsPerWall;
          ctx.fillRect(r, Math.floor(my), 1, 1);
        }
        if (hit === 3) {
          ctx.fillStyle = `rgba(64, 224, 96, ${0.25 + 0.2 * Math.sin(Date.now() * 0.005)})`;
          ctx.fillRect(r, y0, 1, wallH);
        }
      }

      // Lava overlay on floor — when player stands near, glow
      // (cheap effect — render a fixed-position glow band)
      // Pickups
      const sortedPickups = s.pickups
        .filter((p) => !p.taken)
        .map((p) => ({ p, d: Math.hypot(p.x - s.px, p.y - s.py) }))
        .sort((a, b) => b.d - a.d);
      for (const { p, d } of sortedPickups) {
        if (d > 10) continue;
        const dx2 = p.x - s.px;
        const dy2 = p.y - s.py;
        const angle = Math.atan2(dy2, dx2) - s.pa;
        let a = angle;
        while (a > Math.PI) a -= Math.PI * 2;
        while (a < -Math.PI) a += Math.PI * 2;
        if (Math.abs(a) > FOV) continue;
        const sx2 = W / 2 + (a / (FOV / 2)) * (W / 2);
        const size = Math.min(H * 0.6, (H * 0.4) / Math.max(d, 0.3));
        const x0 = Math.floor(sx2 - size / 2);
        const y0 = Math.floor(H / 2 + size / 4 - size / 2);
        const colX = Math.floor(sx2);
        if (colX >= 0 && colX < W && zbuf[colX] < d) continue;
        const bob = Math.sin(Date.now() * 0.004 + p.x * 7) * 4;
        const pc = PICKUP_VIS[p.type];
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

      // Projectiles
      for (const proj of s.projectiles) {
        const dx2 = proj.x - s.px;
        const dy2 = proj.y - s.py;
        const d = Math.hypot(dx2, dy2);
        if (d > 12) continue;
        const angle = Math.atan2(dy2, dx2) - s.pa;
        let aa = angle;
        while (aa > Math.PI) aa -= Math.PI * 2;
        while (aa < -Math.PI) aa += Math.PI * 2;
        if (Math.abs(aa) > FOV) continue;
        const sx2 = W / 2 + (aa / (FOV / 2)) * (W / 2);
        const size = Math.min(H * 0.2, (H * 0.18) / Math.max(d, 0.3));
        const colX = Math.floor(sx2);
        if (colX < 0 || colX >= W || zbuf[colX] < d) continue;
        ctx.fillStyle = proj.color;
        ctx.beginPath();
        ctx.arc(sx2, H / 2, size / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.beginPath();
        ctx.arc(sx2, H / 2, size / 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Enemies
      const sortedEn = s.enemies
        .filter((e) => e.state !== "dead" || (e.deathTime > 0 && Date.now() - e.deathTime < 8000))
        .map((e) => ({ e, d: Math.hypot(e.x - s.px, e.y - s.py) }))
        .sort((a, b) => b.d - a.d);
      for (const { e, d } of sortedEn) {
        const dx2 = e.x - s.px;
        const dy2 = e.y - s.py;
        const angle = Math.atan2(dy2, dx2) - s.pa;
        let a = angle;
        while (a > Math.PI) a -= Math.PI * 2;
        while (a < -Math.PI) a += Math.PI * 2;
        if (Math.abs(a) > FOV) continue;
        const sx2 = W / 2 + (a / (FOV / 2)) * (W / 2);
        const def = ENEMY_DEFS[e.type];
        const size = Math.min(H * 1.4, (H * 0.85 * def.size) / Math.max(d, 0.3));
        const x0 = Math.floor(sx2 - size / 2);
        const y0 = Math.floor(H / 2 - size / 2 + (def.flying ? -size * 0.15 : 0));
        const pix = 8;
        const cell = size / pix;
        const frames = ENEMY_SPRITES[e.type];
        let sprite: string[];
        if (e.state === "dead") sprite = frames.dead;
        else if (e.state === "patrol" || e.state === "chase") {
          sprite = Math.floor(e.t * 4) % 2 === 0 ? frames.idle : frames.walk;
        } else sprite = frames.idle;
        const wave = e.state === "dead" ? 0 : Math.sin(e.t * 3) * (size * 0.02);
        const flyBob = def.flying ? Math.sin(e.t * 2) * size * 0.08 : 0;
        const shade = Math.max(0.3, 1 - d / 12);
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
            ctx.fillRect(colX, Math.floor(y0 + py * cell + wave + flyBob), Math.ceil(cell) + 1, Math.ceil(cell) + 1);
          }
        }
        ctx.globalAlpha = 1;
        // HP bar
        if (e.hp < e.maxHp && d < 8) {
          const barW = size * 0.6;
          const barX = sx2 - barW / 2;
          const barY = y0 - 6;
          ctx.fillStyle = "rgba(0,0,0,0.7)";
          ctx.fillRect(barX, barY, barW, 4);
          ctx.fillStyle = e.hp / e.maxHp > 0.5 ? "#6ab04c" : e.hp / e.maxHp > 0.2 ? "#fbc531" : "#c0392b";
          ctx.fillRect(barX, barY, barW * (e.hp / e.maxHp), 4);
          if (def.isBoss) {
            ctx.fillStyle = "#c0392b";
            ctx.font = "bold 10px ui-monospace";
            ctx.textAlign = "center";
            ctx.fillText("CYBERDEMON", sx2, barY - 4);
            ctx.textAlign = "start";
          }
        }
      }

      // Blood
      for (const b of s.blood) {
        const dx2 = b.x - s.px;
        const dy2 = b.y - s.py;
        const d = Math.hypot(dx2, dy2);
        if (d > 8) continue;
        const angle = Math.atan2(dy2, dx2) - s.pa;
        let aa = angle;
        while (aa > Math.PI) aa -= Math.PI * 2;
        while (aa < -Math.PI) aa += Math.PI * 2;
        if (Math.abs(aa) > FOV) continue;
        const sx2 = W / 2 + (aa / (FOV / 2)) * (W / 2);
        const size = Math.min(H * 0.3, (b.size * H) / Math.max(d, 0.3));
        const colX = Math.floor(sx2);
        if (colX < 0 || colX >= W || zbuf[colX] < d) continue;
        const yc = H / 2 + size * 1.2 + bobY;
        ctx.fillStyle = `rgba(${Math.floor(140 * b.t)}, ${Math.floor(20 * b.t)}, ${Math.floor(20 * b.t)}, ${Math.min(1, b.t)})`;
        ctx.beginPath();
        ctx.ellipse(sx2, yc, size, size * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // Weapon
      drawWeapon(ctx, s);

      // Crosshair
      ctx.strokeStyle = "rgba(251,197,49,0.85)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(W / 2 - 6, H / 2);
      ctx.lineTo(W / 2 - 2, H / 2);
      ctx.moveTo(W / 2 + 2, H / 2);
      ctx.lineTo(W / 2 + 6, H / 2);
      ctx.moveTo(W / 2, H / 2 - 6);
      ctx.lineTo(W / 2, H / 2 - 2);
      ctx.moveTo(W / 2, H / 2 + 2);
      ctx.lineTo(W / 2, H / 2 + 6);
      ctx.stroke();

      // Damage vignette
      if (s.flash > 0.05) {
        const grad = ctx.createRadialGradient(W / 2, H / 2, W / 4, W / 2, H / 2, W / 1.4);
        grad.addColorStop(0, `rgba(192,57,43,0)`);
        grad.addColorStop(1, `rgba(192,57,43,${s.flash * 0.6})`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
      }

      // Top-left mission panel
      const m = lvl.mission;
      const objW = 220;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(4, 4, objW, 36);
      ctx.fillStyle = "#fbc531";
      ctx.font = "bold 10px ui-monospace";
      ctx.fillText(`◆ MISSION L${levelIdx + 1}`, 8, 16);
      ctx.fillStyle = "#f4f1de";
      ctx.font = "9px ui-monospace";
      ctx.fillText(truncate(m.brief, 36), 8, 28);
      // Mission progress
      if (m.type === "kill_all") {
        const left = s.enemies.filter((e) => e.state !== "dead").length;
        ctx.fillStyle = left === 0 ? "#6ab04c" : "#e1a95f";
        ctx.fillText(`${s.enemies.length - left}/${s.enemies.length} demons`, 8, 38);
      } else if (m.type === "kill_boss") {
        const boss = s.enemies.find((e) => ENEMY_DEFS[e.type].isBoss);
        if (boss) {
          ctx.fillStyle = "#c0392b";
          ctx.fillText(`Boss HP: ${Math.max(0, Math.ceil(boss.hp))}/${boss.maxHp}`, 8, 38);
        }
      } else if (m.type.startsWith("find_key")) {
        const k = m.type === "find_key_red" ? s.keysHeld.red : m.type === "find_key_yellow" ? s.keysHeld.yellow : s.keysHeld.blue;
        ctx.fillStyle = k ? "#6ab04c" : "#c0392b";
        ctx.fillText(k ? "KEY ACQUIRED ✓ Find exit" : "Key not found yet", 8, 38);
      }

      // Top-right keys / difficulty pill
      const dCur = DIFFICULTIES.find((dd) => dd.id === diffId) ?? DIFFICULTIES[2];
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(W - 80, 4, 76, 16);
      ctx.fillStyle = dCur.color;
      ctx.font = "bold 9px ui-monospace";
      ctx.fillText(dCur.short, W - 76, 15);
      // Keys held
      const kY = 22;
      ["red", "yellow", "blue"].forEach((k, i) => {
        const has = (s.keysHeld as Record<string, boolean>)[k];
        ctx.fillStyle = has ? (k === "red" ? "#c0392b" : k === "yellow" ? "#fbc531" : "#5fc4e1") : "rgba(80,80,80,0.4)";
        ctx.fillRect(W - 76 + i * 22, kY, 18, 12);
        ctx.fillStyle = has ? "white" : "rgba(255,255,255,0.4)";
        ctx.font = "bold 9px ui-monospace";
        ctx.textAlign = "center";
        ctx.fillText(k[0].toUpperCase(), W - 67 + i * 22, kY + 9);
        ctx.textAlign = "start";
      });

      // Mini-map (top-right when M held)
      if (showMap || s.keys.has("tab")) {
        drawMinimap(ctx, s, lvl);
      } else {
        // Tiny mini-map always
        drawMinimap(ctx, s, lvl, true);
      }

      // Bottom HUD
      ctx.fillStyle = "rgba(0,0,0,0.85)";
      ctx.fillRect(0, H - 28, W, 28);
      // HP
      ctx.fillStyle = s.hp < 30 ? "#c0392b" : s.hp < 60 ? "#e1a95f" : "#6ab04c";
      ctx.font = "bold 11px ui-monospace";
      ctx.fillText(`HP ${Math.ceil(s.hp)}`, 8, H - 12);
      // AR
      ctx.fillStyle = "#5fc4e1";
      ctx.fillText(`AR ${Math.ceil(s.armor)}`, 60, H - 12);
      // current weapon
      const w = WEAPONS[s.currentWeapon];
      ctx.fillStyle = "#fbc531";
      ctx.fillText(`${w.short}`, 110, H - 12);
      ctx.fillStyle = "#aaa";
      ctx.font = "9px ui-monospace";
      if (w.ammoType === "none") {
        ctx.fillText("∞", 150, H - 12);
      } else {
        ctx.fillText(`${s.ammo[w.ammoType]}/${capacityFor(w.ammoType)}`, 150, H - 12);
      }
      // Score
      ctx.fillStyle = "#f4f1de";
      ctx.font = "bold 11px ui-monospace";
      ctx.fillText(`SC ${s.score}`, 210, H - 12);
      // Kills
      ctx.fillStyle = "#c0392b";
      ctx.fillText(`K ${s.enemiesKilled}/${s.enemies.length}`, 280, H - 12);
      // High
      ctx.fillStyle = "#888";
      ctx.fillText(`HI ${highScore}`, 340, H - 12);
      // Level name
      ctx.fillStyle = "#888";
      ctx.font = "9px ui-monospace";
      ctx.fillText(`L${levelIdx + 1} ${lvl.name}`, 400, H - 12);

      // Weapon strip
      let wx = 8;
      for (const wid of WEAPON_ORDER) {
        const owned = s.weaponsOwned[wid];
        const isCur = wid === s.currentWeapon;
        ctx.fillStyle = isCur ? "rgba(251,197,49,0.9)" : owned ? "rgba(80,80,80,0.7)" : "rgba(30,30,30,0.5)";
        ctx.fillRect(wx, H - 26, 16, 8);
        ctx.fillStyle = isCur ? "#000" : owned ? "#aaa" : "#444";
        ctx.font = "bold 7px ui-monospace";
        ctx.textAlign = "center";
        ctx.fillText(String(WEAPON_ORDER.indexOf(wid) + 1), wx + 8, H - 19);
        ctx.textAlign = "start";
        wx += 18;
      }

      ctx.restore();
    }

    function capacityFor(t: Exclude<AmmoType, "none">): number {
      return t === "bullet" ? 200 : t === "shell" ? 50 : t === "cell" ? 300 : 50;
    }

    function truncate(t: string, n: number): string {
      return t.length > n ? t.slice(0, n - 1) + "…" : t;
    }

    function drawMinimap(ctx: CanvasRenderingContext2D, s: typeof stateRef.current, lvl: LevelSpec, mini = false) {
      const cell = mini ? 4 : 12;
      const margin = 8;
      const map = lvl.map;
      const mw = map[0].length * cell;
      const mh = map.length * cell;
      const ox = W - mw - margin;
      const oy = margin + (mini ? 40 : 0);
      ctx.fillStyle = "rgba(0,0,0,0.75)";
      ctx.fillRect(ox - 2, oy - 2, mw + 4, mh + 4);
      for (let y = 0; y < map.length; y++) {
        for (let x = 0; x < map[0].length; x++) {
          const t = map[y][x];
          if (t === 0) { ctx.fillStyle = "rgba(255,255,255,0.06)"; }
          else if (t === 3) { ctx.fillStyle = "#6ab04c"; }
          else if (t === 9) { ctx.fillStyle = "#ff6610"; }
          else if (t === 6) { ctx.fillStyle = "#c0392b"; }
          else if (t === 7) { ctx.fillStyle = "#fbc531"; }
          else if (t === 8) { ctx.fillStyle = "#5090ff"; }
          else { ctx.fillStyle = "rgba(200,200,200,0.6)"; }
          ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell);
        }
      }
      // Enemies
      for (const e of s.enemies) {
        if (e.state === "dead") continue;
        ctx.fillStyle = ENEMY_DEFS[e.type].isBoss ? "#ff0066" : "#c0392b";
        ctx.fillRect(ox + e.x * cell - 1, oy + e.y * cell - 1, mini ? 2 : 4, mini ? 2 : 4);
      }
      // Pickups
      for (const p of s.pickups) {
        if (p.taken) continue;
        ctx.fillStyle = PICKUP_VIS[p.type].fill;
        ctx.fillRect(ox + p.x * cell - 1, oy + p.y * cell - 1, mini ? 2 : 3, mini ? 2 : 3);
      }
      // Player
      ctx.fillStyle = "#fbc531";
      const pxm = ox + s.px * cell;
      const pym = oy + s.py * cell;
      ctx.fillRect(pxm - 1, pym - 1, mini ? 2 : 4, mini ? 2 : 4);
      // Facing line
      ctx.strokeStyle = "#fbc531";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pxm, pym);
      ctx.lineTo(pxm + Math.cos(s.pa) * cell * 2, pym + Math.sin(s.pa) * cell * 2);
      ctx.stroke();
    }

    function drawWeapon(ctx: CanvasRenderingContext2D, s: typeof stateRef.current) {
      const w = WEAPONS[s.currentWeapon];
      const recoil = s.muzzle * 10;
      const sway = Math.sin(s.walkPhase) * 3;
      const bob = Math.abs(Math.sin(s.walkPhase * 2)) * 4;
      const cx = W / 2 + sway;
      const cy = H - 90 + bob + recoil;

      ctx.fillStyle = "#0a0a14";
      // Per-weapon silhouette
      if (w.id === "fist") {
        // Just a fist sprite at right
        ctx.fillStyle = "#d4a76a";
        ctx.fillRect(cx + 30, cy + 30, 50, 50);
        ctx.fillStyle = "#a0784a";
        ctx.fillRect(cx + 30, cy + 30, 50, 8);
      } else if (w.id === "pistol") {
        ctx.fillStyle = "#2a2a36";
        ctx.fillRect(cx - 12, cy + 30, 24, 36);
        ctx.fillStyle = "#3a3a4a";
        ctx.fillRect(cx - 8, cy + 10, 16, 24);
        ctx.fillStyle = "#0a0a14";
        ctx.fillRect(cx - 4, cy + 4, 8, 10);
      } else if (w.id === "shotgun") {
        ctx.fillStyle = "#4a3a2a";
        ctx.fillRect(cx - 30, cy + 30, 80, 16);
        ctx.fillStyle = "#1a1a26";
        ctx.fillRect(cx - 40, cy + 18, 90, 14);
        ctx.fillRect(cx - 40, cy + 6, 90, 10);
        ctx.fillStyle = "#3a3a4a";
        ctx.fillRect(cx + 30, cy + 46, 30, 30);
      } else if (w.id === "chaingun") {
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = i % 2 === 0 ? "#2a2a36" : "#3a3a4a";
          ctx.fillRect(cx - 25 + i * 10, cy + 6, 8, 60);
        }
        ctx.fillStyle = "#1a1a26";
        ctx.fillRect(cx - 30, cy + 60, 70, 30);
      } else if (w.id === "plasma") {
        ctx.fillStyle = "#1a3a5a";
        ctx.fillRect(cx - 28, cy + 16, 70, 50);
        ctx.fillStyle = "#5fc4e1";
        ctx.fillRect(cx - 8, cy + 10, 16, 22);
        ctx.fillStyle = "#aef0ff";
        ctx.fillRect(cx - 4, cy + 6, 8, 12);
      } else if (w.id === "rocket") {
        ctx.fillStyle = "#3a2a1a";
        ctx.fillRect(cx - 36, cy + 20, 90, 40);
        ctx.fillStyle = "#aa4020";
        ctx.fillRect(cx + 14, cy + 24, 36, 12);
      } else if (w.id === "bfg") {
        ctx.fillStyle = "#1a3a1a";
        ctx.fillRect(cx - 40, cy + 14, 90, 60);
        ctx.fillStyle = "#3cff8a";
        ctx.fillRect(cx - 12, cy + 4, 24, 24);
        if (s.muzzle > 0.1) {
          ctx.fillStyle = `rgba(60,255,140,${s.muzzle * 0.7})`;
          ctx.beginPath();
          ctx.arc(cx, cy + 12, 22, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // Muzzle flash
      if (s.muzzle > 0.05 && w.id !== "fist" && w.id !== "bfg") {
        const m = s.muzzle;
        ctx.fillStyle = `rgba(255,200,40,${m * 0.85})`;
        ctx.fillRect(cx - 8, cy - 4, 18, 18);
        ctx.fillStyle = `rgba(255,140,30,${m * 0.5})`;
        ctx.fillRect(cx - 14, cy - 12, 30, 30);
        ctx.fillStyle = `rgba(255,200,40,${m * 0.08})`;
        ctx.fillRect(0, 0, W, H);
      }
    }

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, showLevelScreen, levelIdx, highScore, tick, showMap, diffId]);

  const lvl = levelRef.current;
  const dCur = DIFFICULTIES.find((d) => d.id === diffId) ?? DIFFICULTIES[2];

  return (
    <div ref={wrapRef} className="p-3 space-y-2 text-xs" style={{ position: "relative" }}>
      <div className="flex items-center justify-between">
        <div className="font-pixel text-sm tracking-wider" style={{ color: "var(--danger)" }}>
          ★ DEL DOOM 3D — L{levelIdx + 1}/10 · {lvl.name} · <span style={{ color: dCur.color }}>{dCur.short}</span>
        </div>
        <div className="flex gap-1">
          <button onClick={() => setShowMap((v) => !v)} className="pill pill-muted" style={{ cursor: "pointer", fontSize: 10 }}>
            <Icons.Map size={9} /> {showMap ? "MAP ON" : "MAP"}
          </button>
          <button onClick={() => setShowLevelScreen("diff")} className="pill pill-muted" style={{ cursor: "pointer", fontSize: 10 }}>
            <Icons.Sliders size={9} /> DIFF
          </button>
          <button onClick={() => setPaused((p) => !p)} className="pill pill-muted" style={{ cursor: "pointer", fontSize: 10 }}>
            {paused ? "▶" : "▌▌"} {paused ? "RESUME" : "PAUSE"}
          </button>
          <button onClick={() => reset(0)} className="pill pill-warn" style={{ cursor: "pointer", fontSize: 10 }}>
            <Icons.RotateCcw size={9} /> RESTART
          </button>
        </div>
      </div>

      <div style={{ position: "relative", display: "block", margin: "0 auto", maxWidth: 640, width: "100%" }}>
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

        {/* Floating hint banner */}
        {hint && !showLevelScreen && (
          <div style={{
            position: "absolute",
            left: 12, right: 12, bottom: 60,
            background: "rgba(0,0,0,0.85)",
            border: "1px solid rgba(251,197,49,0.6)",
            color: "#fbc531",
            padding: "8px 12px",
            fontFamily: "ui-monospace, monospace",
            fontSize: 11,
            textAlign: "center",
            borderRadius: 4,
            pointerEvents: "none",
          }}>
            <Icons.Info size={11} style={{ display: "inline", marginRight: 6, verticalAlign: -1 }} />
            {hint}
          </div>
        )}

        {showLevelScreen && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center"
            style={{ background: "rgba(0,0,0,0.92)", color: "var(--fg)", padding: 16, overflowY: "auto" }}
          >
            {showLevelScreen === "diff" && (
              <>
                <div className="font-pixel text-2xl mb-2" style={{ color: "var(--danger)" }}>★ DEL DOOM ★</div>
                <div className="font-mono text-[10px] mb-3" style={{ color: "var(--muted)" }}>SELECT DIFFICULTY</div>
                <div className="grid grid-cols-1 gap-2 w-full max-w-md">
                  {DIFFICULTIES.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => selectDifficulty(d.id)}
                      className="card-pixel"
                      style={{
                        padding: 8,
                        cursor: "pointer",
                        borderColor: d.id === diffId ? d.color : "var(--surface-2)",
                        background: d.id === diffId ? `${d.color}22` : "var(--surface)",
                        textAlign: "left",
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-pixel" style={{ color: d.color, fontSize: 11 }}>{d.name}</span>
                        <span className="pill" style={{ background: d.color, color: "#000", fontSize: 9 }}>{d.short}</span>
                      </div>
                      <div className="font-mono mt-1" style={{ fontSize: 9, color: "var(--muted)" }}>{d.description}</div>
                    </button>
                  ))}
                </div>
              </>
            )}
            {showLevelScreen === "brief" && (
              <>
                <div className="font-pixel text-2xl mb-1" style={{ color: "var(--accent)" }}>LEVEL {levelIdx + 1}</div>
                <div className="font-pixel text-sm mb-3" style={{ color: "var(--fg)" }}>{lvl.name}</div>
                <div className="card-pixel mb-3" style={{ padding: 10, maxWidth: 440, width: "100%" }}>
                  <div className="font-pixel text-[10px] mb-1" style={{ color: "var(--accent)" }}>◆ OBJECTIVE</div>
                  <div className="font-mono text-[11px] mb-2" style={{ color: "var(--fg)" }}>{lvl.mission.brief}</div>
                  <div className="font-pixel text-[10px] mb-1" style={{ color: "var(--success)" }}>◇ HINT</div>
                  <div className="font-mono text-[10px]" style={{ color: "var(--muted)" }}>{lvl.mission.hint}</div>
                </div>
                <div className="font-mono text-[9px] text-center mb-3 max-w-md leading-relaxed" style={{ color: "var(--muted)" }}>
                  WASD move · MOUSE look · CLICK shoot · 1-7 weapons · TAB cycle · WHEEL switch<br />
                  SHIFT run · M map · P pause · R restart · ESC release mouse
                </div>
                <button onClick={startLevel} className="btn-pixel success">▶ DEPLOY</button>
              </>
            )}
            {showLevelScreen === "complete" && (
              <>
                <div className="font-pixel text-2xl mb-2" style={{ color: "var(--success)" }}>LEVEL CLEARED</div>
                <div className="text-[11px] font-mono mb-2 text-center" style={{ color: "var(--fg)" }}>
                  +200 bonus · score {stateRef.current.score}
                </div>
                <div className="text-[10px] font-mono mb-3 text-center" style={{ color: "var(--muted)" }}>
                  Kills: {stateRef.current.enemiesKilled} · Time: {Math.round((Date.now() - stateRef.current.levelStartTime) / 1000)}s
                </div>
                <div className="card-pixel mb-3" style={{ padding: 10, maxWidth: 440, width: "100%" }}>
                  <div className="font-pixel text-[10px] mb-1" style={{ color: "var(--accent)" }}>NEXT — {lvl.name}</div>
                  <div className="font-mono text-[11px]" style={{ color: "var(--fg)" }}>{lvl.mission.brief}</div>
                </div>
                <button onClick={startLevel} className="btn-pixel success">▶ ENTER L{levelIdx + 1}</button>
              </>
            )}
            {showLevelScreen === "gameover" && (
              <>
                <div className="font-pixel text-3xl mb-2" style={{ color: "var(--danger)" }}>YOU DIED</div>
                <div className="text-[11px] font-mono mb-3 text-center" style={{ color: "var(--fg)" }}>
                  final: {stateRef.current.score} · high: {highScore} · reached L{levelIdx + 1} on {dCur.short}
                </div>
                <div className="text-[10px] font-mono mb-3 text-center max-w-sm" style={{ color: "var(--muted)" }}>
                  Tip: switch weapons (1-7), don't fight cyberdemons with a pistol, and watch for lava tiles (orange).
                </div>
                <div className="flex gap-2">
                  <button onClick={() => reset(0)} className="btn-pixel danger">▶ NEW GAME</button>
                  <button onClick={() => reset(levelIdx)} className="btn-pixel">RETRY L{levelIdx + 1}</button>
                  <button onClick={() => setShowLevelScreen("diff")} className="btn-pixel">CHANGE DIFF</button>
                </div>
              </>
            )}
            {showLevelScreen === "victory" && (
              <>
                <div className="font-pixel text-3xl mb-2" style={{ color: "var(--success)" }}>★ VICTORY ★</div>
                <div className="text-[11px] font-mono mb-2 text-center" style={{ color: "var(--fg)" }}>
                  ALL 10 LEVELS CLEARED on <span style={{ color: dCur.color }}>{dCur.short}</span>
                </div>
                <div className="text-[10px] font-mono mb-3 text-center" style={{ color: "var(--muted)" }}>
                  final {stateRef.current.score} · high {highScore} · kills {stateRef.current.enemiesKilled}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => reset(0)} className="btn-pixel success">▶ NEW GAME+</button>
                  <button onClick={() => setShowLevelScreen("diff")} className="btn-pixel">↑ HIGHER DIFF</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="text-[10px] font-mono text-[color:var(--muted)] text-center leading-relaxed">
        click canvas to lock mouse · <strong>1-7</strong> weapons · <strong>TAB</strong> cycle · <strong>WHEEL</strong> switch · <strong>M</strong> map · <strong>SHIFT</strong> run · <strong>P</strong> pause · <strong>R</strong> restart
      </div>
    </div>
  );
}
