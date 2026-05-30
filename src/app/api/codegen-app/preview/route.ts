// Live in-IDE preview server for codegen projects.
//
// Why a route instead of an <iframe srcDoc>: a srcDoc/blob iframe INHERITS the
// embedding page's Content-Security-Policy. DelOS ships a deliberately strict
// CSP (`script-src 'self' 'unsafe-inline'`, no CDN hosts, no `unsafe-eval` in
// prod), so the bundled preview's React/Babel/Tailwind CDN scripts were blocked
// and the iframe rendered blank. A real same-origin HTTP response carries its
// OWN CSP header (middleware skips CSP for /api), so navigating the iframe to
// this route lets the preview run under a scoped-permissive policy while the
// rest of the app stays locked down.
//
// Flow: client POSTs {files,name} → we bundle + stash under a random token
// (short TTL, bounded) → client points the iframe at GET ?token=… which returns
// the HTML with a permissive CSP. The bundle never touches disk and the token
// map self-evicts.
import { NextRequest } from "next/server";
import { bundleProjectToHtml, type PreviewFile } from "@/lib/previewBundle";

export const runtime = "nodejs";

type Entry = { html: string; at: number };
const G = globalThis as unknown as { __delosPreviewStore?: Map<string, Entry> };
G.__delosPreviewStore ??= new Map<string, Entry>();
const STORE = G.__delosPreviewStore;

const TTL_MS = 15 * 60_000;
const MAX_ENTRIES = 24;

function sweep() {
  const cutoff = Date.now() - TTL_MS;
  for (const [k, v] of STORE.entries()) if (v.at < cutoff) STORE.delete(k);
  // Hard cap · drop oldest first if we somehow overflow.
  if (STORE.size > MAX_ENTRIES) {
    const sorted = [...STORE.entries()].sort((a, b) => a[1].at - b[1].at);
    for (const [k] of sorted.slice(0, STORE.size - MAX_ENTRIES)) STORE.delete(k);
  }
}

// Permissive policy scoped to the preview document ONLY (the main app keeps its
// strict CSP). Allows the CDN React/Babel/Tailwind + eval that Babel-standalone
// needs, and same-origin framing so the DelCode iframe can host it.
const PREVIEW_CSP = [
  "default-src 'self' https: data: blob:",
  "script-src 'unsafe-inline' 'unsafe-eval' https: blob:",
  "style-src 'unsafe-inline' https:",
  "img-src * data: blob:",
  "font-src https: data:",
  "connect-src https: data:",
  "frame-ancestors 'self'",
].join("; ");

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { files?: PreviewFile[]; name?: string };
  if (!Array.isArray(body.files) || body.files.length === 0) {
    return Response.json({ ok: false, error: "files_required" }, { status: 400 });
  }
  // Bound the payload so a giant project can't blow up memory.
  const files = body.files
    .filter((f) => f && typeof f.path === "string" && typeof f.content === "string")
    .slice(0, 80)
    .map((f) => ({ path: f.path, content: String(f.content).slice(0, 200_000) }));
  if (files.length === 0) {
    return Response.json({ ok: false, error: "files_required" }, { status: 400 });
  }
  let html: string;
  try {
    html = bundleProjectToHtml(files, (body.name ?? "DelOS app").slice(0, 120));
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message.slice(0, 200) }, { status: 500 });
  }
  sweep();
  const token = crypto.randomUUID();
  STORE.set(token, { html, at: Date.now() });
  return Response.json({ ok: true, token });
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return new Response("missing token", { status: 400 });
  const entry = STORE.get(token);
  if (!entry) {
    return new Response(
      "<!doctype html><body style='font:14px ui-monospace;background:#0a0a0a;color:#fda4af;padding:24px'>Preview expired — click ▶ PREVIEW again.</body>",
      { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": PREVIEW_CSP } },
    );
  }
  return new Response(entry.html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": PREVIEW_CSP,
      "Cache-Control": "no-store",
    },
  });
}
