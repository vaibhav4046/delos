import { z } from "zod";

import { zodErr } from "@/lib/apiAuth";
export const runtime = "nodejs";
export const maxDuration = 15;

const Req = z.object({
  prompt: z.string().min(3).max(200),
  aspect: z.enum(["16:9", "21:9", "1:1"]).default("16:9"),
  tenantId: z.string().default("delrio_demo"),
});

// Deterministic hash → palette + composition seed
function hashPrompt(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function pickPalette(seed: number): { bg: string; fg: string; accent: string; accent2: string } {
  const palettes = [
    { bg: "#0f0f1b", fg: "#fbc531", accent: "#ff4757", accent2: "#7aa2f7" },
    { bg: "#1a0d2e", fg: "#ff00ff", accent: "#00ffff", accent2: "#ffeb3b" },
    { bg: "#2e3440", fg: "#88c0d0", accent: "#bf616a", accent2: "#a3be8c" },
    { bg: "#fdf6e3", fg: "#586e75", accent: "#b58900", accent2: "#dc322f" },
    { bg: "#1a1b26", fg: "#7aa2f7", accent: "#bb9af7", accent2: "#9ece6a" },
    { bg: "#0a0a14", fg: "#33ff33", accent: "#33ff33", accent2: "#1e8a1e" },
    { bg: "#1d3557", fg: "#f1faee", accent: "#e63946", accent2: "#a8dadc" },
    { bg: "#2d3436", fg: "#fdcb6e", accent: "#e17055", accent2: "#00cec9" },
  ];
  return palettes[seed % palettes.length];
}

function genSvg(prompt: string, aspect: "16:9" | "21:9" | "1:1"): string {
  const seed = hashPrompt(prompt);
  const { bg, fg, accent, accent2 } = pickPalette(seed);
  const [w, h] = aspect === "16:9" ? [1600, 900] : aspect === "21:9" ? [2100, 900] : [1200, 1200];
  const rand = (n: number) => ((seed * (n + 7) * 9301 + 49297) % 233280) / 233280;
  const shapes = [];

  // Background gradient
  shapes.push(`<defs><linearGradient id='g' x1='0' y1='0' x2='${rand(1).toFixed(2)}' y2='1'><stop offset='0%' stop-color='${bg}'/><stop offset='100%' stop-color='${accent}' stop-opacity='0.35'/></linearGradient></defs>`);
  shapes.push(`<rect width='${w}' height='${h}' fill='url(#g)'/>`);

  // Composition based on prompt keywords
  const lower = prompt.toLowerCase();
  const wantsMountain = /mount|peak|alps|range/.test(lower);
  const wantsSun = /sun|sunset|sunrise|dawn|dusk/.test(lower);
  const wantsCity = /city|skyline|tokyo|cyber|neon/.test(lower);
  const wantsStars = /star|space|galaxy|cosmos|night|moon/.test(lower);
  const wantsAbstract = /abstract|geometry|pattern|fractal/.test(lower);

  if (wantsStars || (!wantsMountain && !wantsCity && !wantsSun)) {
    for (let i = 0; i < 80; i++) {
      const cx = rand(i * 3 + 1) * w;
      const cy = rand(i * 3 + 2) * (h * 0.6);
      const r = rand(i * 3 + 3) * 2 + 0.5;
      shapes.push(`<circle cx='${cx.toFixed(0)}' cy='${cy.toFixed(0)}' r='${r.toFixed(1)}' fill='${fg}' opacity='${(rand(i + 10) * 0.7 + 0.2).toFixed(2)}'/>`);
    }
  }

  if (wantsSun) {
    const sx = w * 0.5;
    const sy = h * 0.5;
    shapes.push(`<circle cx='${sx}' cy='${sy}' r='${h * 0.18}' fill='${fg}' opacity='0.85'/>`);
    shapes.push(`<circle cx='${sx}' cy='${sy}' r='${h * 0.28}' fill='${fg}' opacity='0.25'/>`);
  }

  if (wantsMountain) {
    const mh = h * 0.4;
    const my = h * 0.7;
    let path = `M0,${h} `;
    for (let x = 0; x <= w; x += 80) {
      const peak = my - rand(x) * mh;
      path += `L${x},${peak.toFixed(0)} `;
    }
    path += `L${w},${h} Z`;
    shapes.push(`<path d='${path}' fill='${accent2}' opacity='0.85'/>`);
    let path2 = `M0,${h} `;
    for (let x = 0; x <= w; x += 60) {
      const peak = my + 40 - rand(x + 100) * (mh * 0.6);
      path2 += `L${x},${peak.toFixed(0)} `;
    }
    path2 += `L${w},${h} Z`;
    shapes.push(`<path d='${path2}' fill='${accent}' opacity='0.7'/>`);
  }

  if (wantsCity) {
    for (let i = 0; i < 16; i++) {
      const bx = (i * w) / 16 + rand(i) * 30;
      const bh = rand(i + 1) * h * 0.5 + 80;
      shapes.push(`<rect x='${bx.toFixed(0)}' y='${(h - bh).toFixed(0)}' width='${(w / 16 - 8).toFixed(0)}' height='${bh.toFixed(0)}' fill='${accent2}' opacity='0.8'/>`);
      // Window dots
      for (let r = 0; r < bh / 30; r++) {
        for (let c = 0; c < (w / 16 - 8) / 20; c++) {
          if (rand(i * 100 + r * 10 + c) > 0.5) {
            shapes.push(`<rect x='${(bx + 8 + c * 20).toFixed(0)}' y='${(h - bh + 8 + r * 30).toFixed(0)}' width='6' height='10' fill='${fg}' opacity='0.9'/>`);
          }
        }
      }
    }
  }

  if (wantsAbstract) {
    for (let i = 0; i < 20; i++) {
      const cx = rand(i) * w;
      const cy = rand(i + 1) * h;
      const r = rand(i + 2) * 80 + 20;
      shapes.push(`<circle cx='${cx.toFixed(0)}' cy='${cy.toFixed(0)}' r='${r.toFixed(0)}' fill='none' stroke='${i % 2 === 0 ? accent : accent2}' stroke-width='2' opacity='0.4'/>`);
    }
  }

  // Watermark
  shapes.push(`<text x='${w - 20}' y='${h - 20}' text-anchor='end' font-family='monospace' font-size='14' fill='${fg}' opacity='0.4'>delrio · ${prompt.slice(0, 32)}</text>`);

  return `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${shapes.join("")}</svg>`;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = Req.safeParse(body);
  if (!parsed.success) {
    return zodErr(parsed.error);
  }
  const { prompt, aspect } = parsed.data;
  const svg = genSvg(prompt, aspect);
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  return Response.json({
    ok: true,
    dataUrl,
    source: "procedural",
    aspect,
    bytes: svg.length,
    note: "Procedural SVG art seeded from prompt hash. Composition keyed by keywords: mountain/sun/city/stars/abstract.",
  });
}

export async function GET() {
  return Response.json({
    ok: true,
    description: "POST { prompt: string, aspect?: '16:9'|'21:9'|'1:1' } → procedural SVG wallpaper data URL.",
    examples: [
      "synthwave landscape with mountains and a setting sun",
      "abstract geometric pattern in nord colors",
      "cyberpunk city skyline at night",
      "starry galaxy with deep blue",
    ],
  });
}
