import { NextRequest } from "next/server";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 30;

// POST: multipart/form-data with field "file" (audio blob). Forwards to Groq Whisper.
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  if (!form) return Response.json({ error: "expected multipart/form-data" }, { status: 400 });
  const file = form.get("file");
  if (!file || !(file instanceof Blob)) return Response.json({ error: "missing file" }, { status: 400 });

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
