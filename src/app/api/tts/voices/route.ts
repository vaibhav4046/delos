import { env } from "@/lib/env";

export const runtime = "nodejs";

export async function GET() {
  if (!env.ELEVENLABS_API_KEY) {
    return Response.json({ available: false, voices: [] });
  }
  try {
    const r = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": env.ELEVENLABS_API_KEY },
    });
    if (!r.ok) return Response.json({ available: true, voices: [], error: `elevenlabs ${r.status}` });
    const j = (await r.json()) as { voices?: Array<{ voice_id: string; name: string; labels?: Record<string, string>; preview_url?: string }> };
    return Response.json({
      available: true,
      voices: (j.voices ?? []).map((v) => ({ id: v.voice_id, name: v.name, labels: v.labels, preview: v.preview_url })),
    });
  } catch (e) {
    return Response.json({ available: true, voices: [], error: e instanceof Error ? e.message : String(e) });
  }
}
