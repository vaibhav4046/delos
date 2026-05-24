"use client";
import { useEffect, useState } from "react";

const STORE_KEY = "delos.wallpaper.v2";

// SVG patterns encoded as data URLs — keep file-size small.
const STAR_FIELD = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200' viewBox='0 0 200 200'><rect width='200' height='200' fill='%230f0f1b'/><g fill='%23f4f1de'><circle cx='20' cy='30' r='1'/><circle cx='70' cy='80' r='1.4'/><circle cx='130' cy='20' r='0.8'/><circle cx='180' cy='110' r='1.2'/><circle cx='50' cy='160' r='1'/><circle cx='110' cy='190' r='0.9'/><circle cx='160' cy='60' r='1.1'/><circle cx='10' cy='110' r='0.6'/><circle cx='90' cy='130' r='0.7'/></g></svg>") repeat`;

const BRICK = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='64' height='32' viewBox='0 0 64 32'><rect width='64' height='32' fill='%23fbc531'/><rect width='32' height='16' x='0' y='0' fill='none' stroke='%23b8902a' stroke-width='2'/><rect width='32' height='16' x='32' y='0' fill='none' stroke='%23b8902a' stroke-width='2'/><rect width='32' height='16' x='16' y='16' fill='none' stroke='%23b8902a' stroke-width='2'/><rect width='32' height='16' x='-16' y='16' fill='none' stroke='%23b8902a' stroke-width='2'/><rect width='32' height='16' x='48' y='16' fill='none' stroke='%23b8902a' stroke-width='2'/></svg>") repeat`;

const PIPE_GRID = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'><rect width='40' height='40' fill='%230a2418'/><circle cx='20' cy='20' r='8' fill='none' stroke='%232ecc71' stroke-width='2'/></svg>") repeat`;

const COIN_RAIN = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'><rect width='80' height='80' fill='%231b1b2e'/><circle cx='20' cy='20' r='4' fill='%23fbc531' opacity='0.6'/><circle cx='60' cy='50' r='3' fill='%23fbc531' opacity='0.4'/><circle cx='30' cy='65' r='3' fill='%23fbc531' opacity='0.5'/></svg>") repeat`;

const CHECKER = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'><rect width='16' height='16' x='0' y='0' fill='%231b1b2e'/><rect width='16' height='16' x='16' y='16' fill='%231b1b2e'/><rect width='16' height='16' x='16' y='0' fill='%23232342'/><rect width='16' height='16' x='0' y='16' fill='%23232342'/></svg>") repeat`;

const SYNTHWAVE_GRID = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'><defs><linearGradient id='sky' x1='0' y1='0' x2='0' y2='1'><stop offset='0%25' stop-color='%231a0d2e'/><stop offset='60%25' stop-color='%23ff00ff' stop-opacity='0.3'/><stop offset='100%25' stop-color='%2300ffff' stop-opacity='0.4'/></linearGradient></defs><rect width='400' height='400' fill='url(%23sky)'/><g stroke='%23ff00ff' stroke-width='1' fill='none' opacity='0.5'><line x1='0' y1='250' x2='400' y2='250'/><line x1='0' y1='280' x2='400' y2='280'/><line x1='0' y1='320' x2='400' y2='320'/><line x1='0' y1='370' x2='400' y2='370'/><line x1='200' y1='240' x2='-100' y2='400'/><line x1='200' y1='240' x2='100' y2='400'/><line x1='200' y1='240' x2='200' y2='400'/><line x1='200' y1='240' x2='300' y2='400'/><line x1='200' y1='240' x2='500' y2='400'/></g><circle cx='200' cy='180' r='60' fill='%23ff00ff' opacity='0.6'/></svg>") center/cover`;

const MATRIX_RAIN = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200' viewBox='0 0 200 200'><rect width='200' height='200' fill='%23000000'/><g fill='%2300ff41' font-family='monospace' font-size='14'><text x='10' y='20'>0</text><text x='10' y='50' opacity='0.7'>1</text><text x='10' y='80' opacity='0.4'>1</text><text x='40' y='30'>1</text><text x='40' y='60' opacity='0.7'>0</text><text x='40' y='90' opacity='0.5'>1</text><text x='70' y='50'>1</text><text x='70' y='80' opacity='0.7'>0</text><text x='100' y='40'>0</text><text x='100' y='70' opacity='0.7'>1</text><text x='100' y='100' opacity='0.4'>1</text><text x='130' y='25'>1</text><text x='130' y='55' opacity='0.7'>0</text><text x='160' y='45'>0</text><text x='160' y='75' opacity='0.6'>1</text><text x='190' y='35'>1</text></g></svg>") repeat`;

const HYDRA_GLYPH = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'><rect width='400' height='400' fill='%230f0f1b'/><g transform='translate(200,200)' fill='none' stroke='%23fbc531' stroke-width='2' opacity='0.6'><circle r='80'/><circle r='120' stroke-dasharray='4 4'/><circle r='160' stroke-dasharray='2 6'/><path d='M0,-80 L40,-40 L0,0 L-40,-40 Z' fill='%23fbc531' opacity='0.3'/><path d='M0,80 L40,40 L0,0 L-40,40 Z' fill='%23fbc531' opacity='0.3'/></g></svg>") center/cover`;

const AGENTS_POSTER = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'><defs><radialGradient id='vig' cx='0.5' cy='0.5'><stop offset='0%25' stop-color='%231b1b2e'/><stop offset='100%25' stop-color='%230a0a14'/></radialGradient></defs><rect width='400' height='400' fill='url(%23vig)'/><g fill='%23fbc531'><circle cx='100' cy='100' r='6'/><circle cx='300' cy='100' r='6'/><circle cx='200' cy='200' r='10'/><circle cx='100' cy='300' r='6'/><circle cx='300' cy='300' r='6'/></g><g stroke='%23fbc531' stroke-width='1' opacity='0.4'><line x1='100' y1='100' x2='200' y2='200'/><line x1='300' y1='100' x2='200' y2='200'/><line x1='200' y1='200' x2='100' y2='300'/><line x1='200' y1='200' x2='300' y2='300'/></g><text x='200' y='370' font-family='monospace' font-size='18' fill='%23fbc531' text-anchor='middle'>AGENTS · UNDER · PRESSURE</text></svg>") center/cover`;

const TERMINAL_CRT = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'><rect width='400' height='400' fill='%23000000'/><g stroke='%2333ff33' stroke-width='0.5' opacity='0.15'><line x1='0' y1='0' x2='400' y2='0'/><line x1='0' y1='4' x2='400' y2='4'/><line x1='0' y1='8' x2='400' y2='8'/><line x1='0' y1='12' x2='400' y2='12'/></g><g fill='%2333ff33' font-family='monospace' font-size='10' opacity='0.6'><text x='10' y='30'>$ delos run --goal=research</text><text x='10' y='50'>0.06s BOOT run k7nP4mq</text><text x='10' y='70'>0.32s RECALL 3 hits</text><text x='10' y='90'>0.65s PLAN kimi-k2</text><text x='10' y='110' opacity='0.4'>1.21s STEP web_search</text></g></svg>") center/cover`;

const VAPOR_HORIZON = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'><defs><linearGradient id='vapor' x1='0' y1='0' x2='0' y2='1'><stop offset='0%25' stop-color='%23ff71ce'/><stop offset='40%25' stop-color='%23b967ff'/><stop offset='70%25' stop-color='%2301cdfe'/><stop offset='100%25' stop-color='%2305ffa1'/></linearGradient></defs><rect width='400' height='400' fill='url(%23vapor)'/><circle cx='200' cy='200' r='80' fill='%23ffffff' opacity='0.2'/></svg>") center/cover`;

const WINXP_BLISS = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'><defs><linearGradient id='sky' x1='0' y1='0' x2='0' y2='1'><stop offset='0%25' stop-color='%2387ceeb'/><stop offset='100%25' stop-color='%23b0e0e6'/></linearGradient><linearGradient id='hill' x1='0' y1='0' x2='0' y2='1'><stop offset='0%25' stop-color='%237cb342'/><stop offset='100%25' stop-color='%23558b2f'/></linearGradient></defs><rect width='400' height='280' fill='url(%23sky)'/><ellipse cx='80' cy='100' rx='40' ry='15' fill='%23ffffff' opacity='0.7'/><ellipse cx='280' cy='130' rx='50' ry='18' fill='%23ffffff' opacity='0.6'/><path d='M0,280 Q150,200 400,260 L400,400 L0,400 Z' fill='url(%23hill)'/></svg>") center/cover`;

const MAC_AQUA = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'><defs><linearGradient id='aqua' x1='0' y1='0' x2='0' y2='1'><stop offset='0%25' stop-color='%23cbe8ff'/><stop offset='50%25' stop-color='%237ab0e0'/><stop offset='100%25' stop-color='%232070d8'/></linearGradient></defs><rect width='400' height='400' fill='url(%23aqua)'/><g opacity='0.3'><line x1='0' y1='50' x2='400' y2='50' stroke='%23ffffff' stroke-width='2'/><line x1='0' y1='90' x2='400' y2='90' stroke='%23ffffff' stroke-width='1'/><line x1='0' y1='150' x2='400' y2='150' stroke='%23ffffff' stroke-width='2'/></g></svg>") center/cover`;

export const WALLPAPERS: Array<{ id: string; label: string; css: string; animated?: boolean; pairsWith?: "dark" | "light" }> = [
  { id: "midnight", label: "Midnight", css: "linear-gradient(135deg, #0f0f1b 0%, #1b1b2e 100%)", pairsWith: "dark" },
  { id: "warpzone", label: "Warp Zone", css: "linear-gradient(135deg, #0a1a3f 0%, #1b1b2e 50%, #3a0d2a 100%)", pairsWith: "dark" },
  { id: "starfield", label: "Starfield", css: STAR_FIELD, pairsWith: "dark" },
  { id: "pipe", label: "Pipe World", css: PIPE_GRID, pairsWith: "dark" },
  { id: "bowser", label: "Bowser Castle", css: "linear-gradient(135deg, #2a0d0d 0%, #1b1b2e 100%)", pairsWith: "dark" },
  { id: "coinrush", label: "Coin Rush", css: COIN_RAIN, pairsWith: "dark" },
  { id: "aurora", label: "Aurora", css: "linear-gradient(135deg, #0f1b3f 0%, #1e3a5f 30%, #2e5e3e 65%, #3f5f1e 100%)", animated: true, pairsWith: "dark" },
  { id: "sunset", label: "Sunset", css: "linear-gradient(180deg, #1b1b2e 0%, #5a2a4a 50%, #c87d20 100%)", pairsWith: "dark" },
  { id: "ocean", label: "Ocean", css: "linear-gradient(180deg, #0a1a3f 0%, #154a6b 50%, #2a7a8a 100%)", animated: true, pairsWith: "dark" },
  { id: "lava", label: "Lava", css: "linear-gradient(135deg, #2a0d0d 0%, #6b1a1a 50%, #a82a1f 100%)", animated: true, pairsWith: "dark" },
  { id: "mint", label: "Mint Cream", css: "linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%)", pairsWith: "light" },
  { id: "paper", label: "Paper", css: "linear-gradient(180deg, #f4f1de 0%, #e6e3d0 100%)", pairsWith: "light" },
  { id: "lavender", label: "Lavender", css: "linear-gradient(135deg, #f0e8ff 0%, #d4baff 100%)", pairsWith: "light" },
  { id: "checker", label: "Checkerboard", css: CHECKER, pairsWith: "dark" },
  { id: "brick", label: "Brick Wall", css: BRICK, pairsWith: "dark" },
  { id: "synthwave-grid", label: "Synthwave Grid", css: SYNTHWAVE_GRID, pairsWith: "dark" },
  { id: "matrix-rain", label: "Matrix Rain", css: MATRIX_RAIN, pairsWith: "dark" },
  { id: "hydra-glyph", label: "HYDRA Glyph", css: HYDRA_GLYPH, pairsWith: "dark" },
  { id: "agents-poster", label: "Agents Poster", css: AGENTS_POSTER, pairsWith: "dark" },
  { id: "terminal-crt", label: "CRT Terminal", css: TERMINAL_CRT, pairsWith: "dark" },
  { id: "vapor-horizon", label: "Vapor Horizon", css: VAPOR_HORIZON, pairsWith: "light" },
  { id: "winxp-bliss", label: "Windows XP Bliss", css: WINXP_BLISS, pairsWith: "light" },
  { id: "mac-aqua", label: "Mac OS X Aqua", css: MAC_AQUA, pairsWith: "light" },
];

export function getWallpaper(): string {
  if (typeof window === "undefined") return WALLPAPERS[0].id;
  try {
    return localStorage.getItem(STORE_KEY) ?? WALLPAPERS[0].id;
  } catch {
    return WALLPAPERS[0].id;
  }
}

export function setWallpaper(id: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORE_KEY, id);
    window.dispatchEvent(new CustomEvent("delos-wallpaper-changed", { detail: { id } }));
  } catch {}
}

export function useWallpaper(): [string, (id: string) => void] {
  const [id, setId] = useState<string>(WALLPAPERS[0].id);
  useEffect(() => {
    setId(getWallpaper());
    function onChange(e: Event) {
      const d = (e as CustomEvent).detail as { id: string };
      setId(d.id);
    }
    window.addEventListener("delos-wallpaper-changed", onChange as EventListener);
    return () => window.removeEventListener("delos-wallpaper-changed", onChange as EventListener);
  }, []);
  return [id, (next) => { setWallpaper(next); setId(next); }];
}
