import { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const maxDuration = 30;

const STT_LIMIT_PER_MIN = 20;
const STT_WINDOW_MS = 60_000;
// Groq Whisper accepts up to 25 MB. Cap at 20 MB so a few seconds of slack
// keeps a single big upload from draining the quota.
const STT_MAX_BYTES = 20 * 1024 * 1024;

// POST: multipart/form-data with field "file" (audio blob). Forwards to Groq Whisper.
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const lim = rateLimit(`stt:ip:${ip}`, STT_LIMIT_PER_MIN, STT_WINDOW_MS);
  if (!lim.ok) {
    return Response.json(
      { error: "Too many STT requests. Try again shortly." },
      { status: 429, headers: lim.headers },
    );
  }
  const form = await req.formData().catch(() => null);
  if (!form) return Response.json({ error: "expected multipart/form-data" }, { status: 400 });
  const file = form.get("file");
  if (!file || !(file instanceof Blob)) return Response.json({ error: "missing file" }, { status: 400 });
  if (file.size > STT_MAX_BYTES) {
    return Response.json({ error: "audio file too large (max 20 MB)" }, { status: 413 });
  }

  const lang = (form.get("language") as string | null) ?? undefined;
  const prompt = (form.get("prompt") as string | null) ?? undefined;
  const model = (form.get("model") as string | null) ?? "whisper-large-v3-turbo";

  const upstream = new FormData();
  upstream.set("file", file, (file as File).name ?? "audio.webm");
  upstream.set("model", model);
  upstream.set("response_format", "json");
  upstream.set("temperature", "0");
  if (lang) upstream.set("language", lang);
  if (prompt) upstream.set("prompt", prompt);

  try {
    const t0 = Date.now();
    const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
      body: upstream,
    });
    const ms = Date.now() - t0;
    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      return Response.json({ error: `groq ${r.status}: ${errText.slice(0, 240)}` }, { status: 502 });
    }
    const j = (await r.json()) as { text?: string };
    return Response.json({ text: j.text ?? "", ms, model });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
