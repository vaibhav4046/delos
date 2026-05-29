import { NextRequest } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { rateLimit, clientIp } from "@/lib/rateLimit";

import { zodErr } from "@/lib/apiAuth";
export const runtime = "nodejs";
export const maxDuration = 30;

const TTS_LIMIT_PER_MIN = 30;
const TTS_WINDOW_MS = 60_000;

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
  const ip = clientIp(req);
  const lim = rateLimit(`tts:ip:${ip}`, TTS_LIMIT_PER_MIN, TTS_WINDOW_MS);
  if (!lim.ok) {
    return Response.json(
      { error: "Too many TTS requests. Try again shortly." },
      { status: 429, headers: lim.headers },
    );
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return zodErr(parsed.error);
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
      // Don't ride the full 30s maxDuration on an upstream hang; the client
      // falls back to browser SpeechSynthesis on any non-200.
      signal: AbortSignal.timeout(12_000),
    });
    if (!r.ok) {
      // Don't reflect the raw provider body back to the client (noisy, can echo
      // upstream detail) — a generic code is enough to trigger the TTS fallback.
      return Response.json({ error: "tts_provider_error", status: r.status }, { status: 502 });
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
    // AbortSignal.timeout → TimeoutError; surface as 504 so the client knows to
    // fall back rather than retry. Everything else is a generic upstream fail.
    const timedOut = e instanceof Error && e.name === "TimeoutError";
    return Response.json(
      { error: timedOut ? "tts_timeout" : "tts_request_failed" },
      { status: timedOut ? 504 : 500 },
    );
  }
}
