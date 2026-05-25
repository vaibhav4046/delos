#!/usr/bin/env node
// Guard: fail CI if anything imports the Perplexity CDN (frontend-cdn.perplexity).
// Pure Node · no shell tricks · Windows-safe (no `|| true` Unix idiom).
import { readdir, readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const ROOTS = ["src", "public"];
const NEEDLE = "frontend-cdn.perplexity";
const TEXT_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".html", ".htm", ".css", ".md", ".svg", ".txt",
]);
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build"]);

async function walk(dir, hits) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      await walk(p, hits);
    } else if (e.isFile()) {
      const ext = extname(e.name).toLowerCase();
      if (!TEXT_EXT.has(ext)) continue;
      try {
        const s = await stat(p);
        if (s.size > 2_000_000) continue;
        const text = await readFile(p, "utf8");
        if (text.includes(NEEDLE)) hits.push(p);
      } catch { /* unreadable file · skip */ }
    }
  }
}

const hits = [];
for (const root of ROOTS) await walk(root, hits);
if (hits.length) {
  console.error("Perplexity CDN reference found in:");
  for (const h of hits) console.error("  " + h);
  process.exit(1);
}
console.log("clean");
