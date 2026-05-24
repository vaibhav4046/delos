import { NextRequest } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 30;

const bodySchema = z.object({
  text: z.string().min(1).max(4000),
  voiceId: z.string().min(1).max(64).optional(),
  modelId: z.string().min(1).max(64).optional(),
  stability: z.number().min(0).max(1).optional(),
  similarity: z.number().min(0).max(1).optional(),
  style: z.number().min(0).max(1).optional(),
  // BYOK — when client passes their own ElevenLabs key, use it instead of
  // server env. Lets users get premium voice with zero server-side config.
  // Stored only client-side; never persisted server-side.
  apiKey: z.string().min(10).max(120).optional(),
});

export async function GET() {
  // Probe endpoint — does this server have ElevenLabs configured?
  return Response.json({
    available: Boolean(env.ELEVENLABS_API_KEY),
    voiceId: env.ELEVENLABS_VOICE_ID,
    modelId: env.ELEVENLABS_MODEL_ID,
  });
}

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  const { text, voiceId, modelId, stability, similarity, style, apiKey } = parsed.data;

  // Prefer client-supplied (BYOK) key. Falls back to server env. 503 if neither.
  const useKey = apiKey || env.ELEVENLABS_API_KEY;
  if (!useKey) {
    return Response.json({ error: "no ElevenLabs key (server env missing + no BYOK in request) — client should fall back to browser TTS" }, { status: 503 });
  }

  const voice = voiceId ?? env.ELEVENLABS_VOICE_ID;
  const model = modelId ?? env.ELEVENLABS_MODEL_ID;

  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: {
        "xi-api-key": useKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: model,
        voice_settings: {
          stability: stability ?? 0.5,
          similarity_boost: similarity ?? 0.75,
          style: style ?? 0,
          use_speaker_boost: true,
        },
      }),
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      return Response.json({ error: `elevenlabs ${r.status}: ${errText.slice(0, 240)}` }, { status: 502 });
    }
    const buf = await r.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
