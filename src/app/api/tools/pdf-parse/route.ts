// PDF parsing endpoint — Del Assistant + voice + autonomous tool surface.
//
// Accepts either:
//   { url: "https://..." }       → server downloads + parses
//   { dataBase64: "..." }        → caller-supplied bytes (max 5 MB)
//
// Returns: { ok, url?, pages, bytes, chars, text, excerpt }
//
// Auth: open (read-only public PDFs). Rate-limited 20/min/IP. Returns
// honest 503 with `{ reason }` when no text could be extracted (image-
// only PDF), so the LLM downstream gets a structured error instead of
// hallucinated content.

import { NextRequest } from "next/server";
import { z } from "zod";
import { zodErr } from "@/lib/apiAuth";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { parsePdfFromUrl, parsePdfBuffer } from "@/lib/pdfParse";

export const runtime = "nodejs";
export const maxDuration = 30;

const Req = z
  .object({
    url: z.string().url().optional(),
    dataBase64: z.string().max(8 * 1024 * 1024).optional(),
    maxChars: z.number().int().min(100).max(40_000).default(8000),
  })
  .refine((d) => !!(d.url || d.dataBase64), { message: "either 'url' or 'dataBase64' required" });

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const lim = rateLimit(`pdfparse:ip:${ip}`, 20, 60_000);
  if (!lim.ok) {
    return Response.json({ ok: false, error: "rate limited" }, { status: 429, headers: lim.headers });
  }
  const parsed = Req.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return zodErr(parsed.error);
  const { url, dataBase64, maxChars } = parsed.data;
  try {
    let result: { text: string; pages: number; bytes: number; url?: string };
    if (url) {
      result = await parsePdfFromUrl(url);
    } else {
      const buf = Buffer.from(dataBase64!, "base64");
      const r = parsePdfBuffer(buf);
      result = { ...r };
    }
    if (!result.text || result.text.length < 8) {
      return Response.json(
        { ok: false, reason: "no_text_extracted", pages: result.pages, bytes: result.bytes, hint: "Image-only PDFs need OCR — not supported in this build." },
        { status: 503 },
      );
    }
    const text = result.text.slice(0, maxChars);
    const excerpt = text.slice(0, 320);
    return Response.json({
      ok: true,
      url: result.url,
      pages: result.pages,
      bytes: result.bytes,
      chars: text.length,
      text,
      excerpt,
      truncated: result.text.length > maxChars,
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: (e as Error).message },
      { status: 400 },
    );
  }
}
