// Server-side IP geolocation proxy. Client → /api/geo → ipapi.co.
// Avoids the third-party-CORS / mixed-content / CSP-allowlist headaches that
// hit DesktopWidgets when it called ipapi.co directly. Used by the Weather
// widget as the no-permission fallback when navigator.geolocation is denied
// or unavailable.
//
// Returns: { lat: number; lon: number; city?: string; region?: string; country?: string }
// On any failure → 502 with { error }.

import { NextRequest } from "next/server";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GEO_LIMIT_PER_MIN = 30;
const GEO_WINDOW_MS = 60_000;

export async function GET(req: NextRequest) {
  const ip = clientIp(req);
  const lim = rateLimit(`geo:ip:${ip}`, GEO_LIMIT_PER_MIN, GEO_WINDOW_MS);
  if (!lim.ok) {
    return Response.json({ error: "rate limited" }, { status: 429, headers: lim.headers });
  }

  // Vercel injects client IP on the x-forwarded-for header. Use it so the
  // upstream lookup matches the actual visitor, not our edge node.
  // ipapi.co accepts an explicit IP path: /<ip>/json/ — falls back to caller
  // if we don't supply one.
  const path = ip && ip !== "127.0.0.1" && ip !== "::1" ? `/${ip}/json/` : "/json/";

  try {
    const r = await fetch(`https://ipapi.co${path}`, {
      headers: { "User-Agent": "DelOS/1.0 (delos weather widget)" },
      cache: "no-store",
    });
    if (!r.ok) {
      return Response.json({ error: `upstream ${r.status}` }, { status: 502 });
    }
    const j = (await r.json()) as {
      latitude?: number;
      longitude?: number;
      city?: string;
      region?: string;
      country_name?: string;
      error?: boolean;
      reason?: string;
    };
    if (j.error || j.latitude == null || j.longitude == null) {
      return Response.json({ error: j.reason || "no coords" }, { status: 502 });
    }
    return Response.json({
      lat: j.latitude,
      lon: j.longitude,
      city: j.city,
      region: j.region,
      country: j.country_name,
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
