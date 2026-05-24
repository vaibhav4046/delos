// Native PDF text extractor — no dependencies.
//
// We can't install pdfjs-dist or unpdf in this environment (npm cache
// corruption), so we do a pragmatic heuristic extraction from the PDF
// byte stream:
//   1. Decompress FlateDecode streams via Node zlib.
//   2. Scan for content-stream text operators:
//        (string)Tj          single show
//        [ (s1) (s2) ] TJ    array show
//        (string)'           show + newline
//        (string)"           show with spacing
//   3. Concatenate, normalize whitespace, return text.
//
// Caveats: scanned-image PDFs return nothing (need OCR). Compressed
// streams with non-Flate filters (LZW, JBIG2) are skipped. Adequate for
// the 90% case — judge demos, hackathon submissions, contracts, etc.

import zlib from "node:zlib";

const STREAM_OPEN = Buffer.from("stream\n");
const STREAM_OPEN_CR = Buffer.from("stream\r\n");
const STREAM_CLOSE = Buffer.from("endstream");

function inflateMaybe(buf: Buffer): Buffer {
  try {
    return zlib.inflateSync(buf);
  } catch {
    try {
      return zlib.inflateRawSync(buf);
    } catch {
      return buf;
    }
  }
}

function extractStreams(pdf: Buffer): Buffer[] {
  const out: Buffer[] = [];
  let i = 0;
  while (i < pdf.length) {
    let openIdx = pdf.indexOf(STREAM_OPEN, i);
    let openLen = STREAM_OPEN.length;
    const openCrIdx = pdf.indexOf(STREAM_OPEN_CR, i);
    if (openCrIdx >= 0 && (openIdx < 0 || openCrIdx < openIdx)) {
      openIdx = openCrIdx;
      openLen = STREAM_OPEN_CR.length;
    }
    if (openIdx < 0) break;
    const closeIdx = pdf.indexOf(STREAM_CLOSE, openIdx + openLen);
    if (closeIdx < 0) break;
    const raw = pdf.subarray(openIdx + openLen, closeIdx);
    out.push(inflateMaybe(raw));
    i = closeIdx + STREAM_CLOSE.length;
  }
  return out;
}

// Pull text from "(string)Tj" / "[(s1)(s2)]TJ" / "(string)'" / "(string)\""
function extractTextFromStream(stream: Buffer): string[] {
  const s = stream.toString("latin1"); // PDF strings are byte-oriented
  const out: string[] = [];
  // Match grouped TJ arrays: [...] TJ
  const tjRe = /\[\s*([^\]]+)\s*\]\s*TJ/g;
  let m: RegExpExecArray | null;
  while ((m = tjRe.exec(s)) !== null) {
    const arr = m[1];
    const tokens = arr.match(/\(([^)]*)\)/g);
    if (tokens) out.push(tokens.map((t) => unescapePdfStr(t.slice(1, -1))).join(""));
  }
  // Match individual (string)Tj / (string)' / (string)"
  const tjSingleRe = /\(((?:\\.|[^\\)])*)\)\s*(?:Tj|TJ|'|")/g;
  while ((m = tjSingleRe.exec(s)) !== null) {
    out.push(unescapePdfStr(m[1]));
  }
  return out;
}

function unescapePdfStr(s: string): string {
  return s
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\")
    .replace(/\\(\d{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

export function parsePdfBuffer(buf: ArrayBuffer | Buffer): { text: string; pages: number; bytes: number } {
  const pdf = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (pdf.length < 8 || pdf.subarray(0, 5).toString() !== "%PDF-") {
    throw new Error("not a PDF (missing %PDF- header)");
  }
  const streams = extractStreams(pdf);
  const pieces: string[] = [];
  for (const s of streams) {
    pieces.push(...extractTextFromStream(s));
  }
  // Best-effort page count by counting `/Type /Page ` declarations.
  const pageMatches = pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g);
  const pages = pageMatches?.length ?? 1;
  // Normalize whitespace.
  const text = pieces.join(" ").replace(/\s+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
  return { text, pages, bytes: pdf.length };
}

export async function parsePdfFromUrl(url: string, maxBytes = 5 * 1024 * 1024): Promise<{ text: string; pages: number; bytes: number; url: string }> {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`PDF fetch ${r.status}`);
  const ab = await r.arrayBuffer();
  if (ab.byteLength > maxBytes) {
    throw new Error(`PDF too large: ${ab.byteLength} > ${maxBytes}`);
  }
  const { text, pages, bytes } = parsePdfBuffer(ab);
  return { text, pages, bytes, url };
}
