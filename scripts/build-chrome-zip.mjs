// Rebuild public/delrio-chrome.zip from chrome-ext/. Run with `node scripts/build-chrome-zip.mjs`.
// Used by /extension download link + Vercel post-build (when wired in).
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "chrome-ext");
const OUT = join(ROOT, "public", "delrio-chrome.zip");

async function walk(dir) {
  const out = [];
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    const st = await stat(p);
    if (st.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

const zip = new JSZip();
const files = await walk(SRC);
for (const f of files) {
  // Skip macOS junk
  if (f.endsWith(".DS_Store")) continue;
  const rel = relative(SRC, f).replace(/\\/g, "/");
  zip.file(rel, await readFile(f));
}
const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
await writeFile(OUT, buf);
console.log(`✓ wrote ${OUT} (${buf.length} bytes, ${files.length} files)`);
