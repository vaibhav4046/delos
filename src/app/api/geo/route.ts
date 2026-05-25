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

  // ─── Edge-header geo (most accurate IP-based source) ────────────────────
  // Vercel + Cloudflare both forward city/country/lat/lon from the edge POP
  // that terminated the TLS connection — typically within 1-5km of the
  // actual visitor and updated daily. Skip ipapi.co if these are present.
  // Header names below cover all the production CDNs we proxy through.
  const h = req.headers;
  const vCity = h.get("x-vercel-ip-city");
  const vCountry = h.get("x-vercel-ip-country");
  const vRegion = h.get("x-vercel-ip-country-region");
  const vLat = h.get("x-vercel-ip-latitude");
  const vLon = h.get("x-vercel-ip-longitude");
  const vTz = h.get("x-vercel-ip-timezone");
  if (vLat && vLon) {
    const lat = Number(vLat);
    const lon = Number(vLon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      // Vercel returns city URL-encoded sometimes (e.g. "New%20York").
      let cityOut = vCity ? decodeURIComponent(vCity) : "";
      // Drop placeholder values Vercel emits for unknown IPs.
      if (cityOut === "(null)" || cityOut === "Unknown") cityOut = "";
      return Response.json({
        lat,
        lon,
        city: cityOut,
        region: vRegion || "",
        country: vCountry || "",
        timezone: vTz || "",
        source: "edge",
      });
    }
  }
  // Cloudflare fallback (when fronted by CF).
  const cfCity = h.get("cf-ipcity");
  const cfLat = h.get("cf-iplatitude");
  const cfLon = h.get("cf-iplongitude");
  if (cfLat && cfLon) {
    const lat = Number(cfLat);
    const lon = Number(cfLon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return Response.json({
        lat,
        lon,
        city: cfCity ? decodeURIComponent(cfCity) : "",
        region: h.get("cf-region") || "",
        country: h.get("cf-ipcountry") || "",
        timezone: h.get("cf-timezone") || "",
        source: "cloudflare",
      });
    }
  }

  // ─── ipapi.co fallback ─────────────────────────────────────────────────
  // No edge geo headers → fall through to the external IP-API service.
  // Vercel injects client IP on the x-forwarded-for header. Use it so the
  // upstream lookup matches the actual visitor, not our edge node.
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
      timezone?: string;
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
      timezone: j.timezone,
      source: "ipapi",
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
