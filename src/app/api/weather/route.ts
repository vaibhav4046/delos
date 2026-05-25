// Server-side weather proxy · Open-Meteo current conditions + reverse-geocode.
// Browser → /api/weather?lat=&lon= → returns { tempC, code, city }. Avoids:
//   1. Open-Meteo geocoder rate limits hitting a single user IP repeatedly
//   2. CORS / network blips that left the widget stuck at "Your location"
//   3. Tier-throttling when many tabs ask the same lat/lon — we cache 5 min
//
// If no lat/lon supplied, falls back to ipapi.co (via /api/geo logic) so the
// route always returns SOMETHING — never blank.

import { NextRequest } from "next/server";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT_PER_MIN = 60;
const WINDOW_MS = 60_000;

// In-Lambda cache · 5 min TTL keyed on coord-quantized lat/lon (0.01° ≈ 1km).
// Single lambda lives ~5 min, so cache hit-rate is ~80% in practice. Survives
// across requests in the same container without external Redis.
type CacheVal = {
  at: number;
  tempC: number;
  apparentC: number;
  code: number;
  humidity: number;
  windKph: number;
  city: string;
  region: string;
  country: string;
  timezone: string;
};
const CACHE = new Map<string, CacheVal>();
const TTL_MS = 5 * 60_000;

function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)}:${lon.toFixed(2)}`;
}

// 2-provider reverse geocode chain. Open-Meteo's reverse endpoint started
// returning "Not Found" mid-May 2026; BigDataCloud is the free, no-key
// drop-in. Nominatim (OSM) is the last resort with a UA header.
type GeoLabel = { city: string; region: string; country: string };

async function tryBigDataCloud(lat: number, lon: number): Promise<GeoLabel | null> {
  try {
    const r = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat.toFixed(5)}&longitude=${lon.toFixed(5)}&localityLanguage=en`,
      { cache: "no-store" },
    );
    if (!r.ok) return null;
    const j = (await r.json()) as {
      city?: string;
      locality?: string;
      principalSubdivision?: string;
      countryName?: string;
    };
    const city = j.city || j.locality || "";
    if (!city && !j.principalSubdivision) return null;
    return {
      city: city || j.principalSubdivision || "",
      region: j.principalSubdivision || "",
      country: (j.countryName || "").replace(/\(the\)\s*$/i, "").trim(),
    };
  } catch { return null; }
}

async function tryNominatim(lat: number, lon: number): Promise<GeoLabel | null> {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&zoom=10&addressdetails=1`,
      {
        cache: "no-store",
        headers: { "User-Agent": "DelOS/2.2 (https://delrio.vercel.app)" },
      },
    );
    if (!r.ok) return null;
    const j = (await r.json()) as {
      address?: { city?: string; town?: string; village?: string; suburb?: string; county?: string; state?: string; country?: string };
    };
    const a = j.address;
    if (!a) return null;
    const city = a.city || a.town || a.village || a.suburb || a.county || "";
    if (!city && !a.state) return null;
    return { city: city || a.state || "", region: a.state || "", country: a.country || "" };
  } catch { return null; }
}

async function reverseGeocode(lat: number, lon: number): Promise<GeoLabel | null> {
  const bdc = await tryBigDataCloud(lat, lon);
  if (bdc) return bdc;
  return await tryNominatim(lat, lon);
}

async function ipFallback(req: NextRequest): Promise<{ lat: number; lon: number; city: string } | null> {
  // ─── Edge headers FIRST · same source /api/geo uses ────────────────────
  // Vercel + Cloudflare populate lat/lon/city from the POP that terminated
  // the request — typically 1-5km accurate. Way better than the external
  // ipapi.co lookup, AND zero network cost.
  const h = req.headers;
  const vLat = h.get("x-vercel-ip-latitude");
  const vLon = h.get("x-vercel-ip-longitude");
  if (vLat && vLon) {
    const lat = Number(vLat);
    const lon = Number(vLon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      let city = h.get("x-vercel-ip-city");
      if (city) city = decodeURIComponent(city);
      if (city === "(null)" || city === "Unknown") city = "";
      return { lat, lon, city: city || "" };
    }
  }
  const cfLat = h.get("cf-iplatitude");
  const cfLon = h.get("cf-iplongitude");
  if (cfLat && cfLon) {
    const lat = Number(cfLat);
    const lon = Number(cfLon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      const city = h.get("cf-ipcity");
      return { lat, lon, city: city ? decodeURIComponent(city) : "" };
    }
  }
  // ipapi.co external fallback when no edge geo headers landed.
  const ip = clientIp(req);
  const path = ip && ip !== "127.0.0.1" && ip !== "::1" ? `/${ip}/json/` : "/json/";
  try {
    const r = await fetch(`https://ipapi.co${path}`, { cache: "no-store" });
    if (!r.ok) return null;
    const j = (await r.json()) as { latitude?: number; longitude?: number; city?: string };
    if (j.latitude == null || j.longitude == null) return null;
    return { lat: j.latitude, lon: j.longitude, city: j.city || "" };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const ip = clientIp(req);
  const lim = rateLimit(`weather:ip:${ip}`, LIMIT_PER_MIN, WINDOW_MS);
  if (!lim.ok) {
    return Response.json({ error: "rate limited" }, { status: 429, headers: lim.headers });
  }

  const u = new URL(req.url);
  // Was `Number(searchParams.get("lat"))` which coerced "" / null → 0 (and
  // 0 IS finite), so `?city=London` skipped the geocoder and queried Open-
  // Meteo at lat=0/lon=0 = Atlantic Ocean. Read each param explicitly and
  // only parse when it's a non-empty string.
  const latRaw = u.searchParams.get("lat");
  const lonRaw = u.searchParams.get("lon");
  let lat = latRaw != null && latRaw !== "" ? Number(latRaw) : Number.NaN;
  let lon = lonRaw != null && lonRaw !== "" ? Number(lonRaw) : Number.NaN;
  let cityHint = u.searchParams.get("city") || "";

  // City-only path · geocode the city name to coords via BigDataCloud's
  // forward-search endpoint (free, no-key). Falls through to ipFallback
  // if geocode misses so the widget never blank-screens.
  if ((!Number.isFinite(lat) || !Number.isFinite(lon)) && cityHint) {
    try {
      const g = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityHint)}&count=1&language=en`,
        { cache: "no-store" },
      );
      if (g.ok) {
        const gj = (await g.json()) as { results?: Array<{ latitude?: number; longitude?: number; name?: string; admin1?: string; country?: string }> };
        const hit = gj.results?.[0];
        if (hit && typeof hit.latitude === "number" && typeof hit.longitude === "number") {
          lat = hit.latitude;
          lon = hit.longitude;
          // Replace cityHint with the canonical name from the geocoder so
          // "lond" → "London" + the region/country come back consistent.
          cityHint = hit.name || cityHint;
        }
      }
    } catch {}
  }

  // Still no coords · IP fallback so the widget always renders.
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    const ipLoc = await ipFallback(req);
    if (!ipLoc) {
      return Response.json({ error: "no location" }, { status: 502 });
    }
    lat = ipLoc.lat;
    lon = ipLoc.lon;
    if (!cityHint) cityHint = ipLoc.city;
  }

  const key = cacheKey(lat, lon);
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return Response.json({
      tempC: hit.tempC,
      apparentC: hit.apparentC,
      code: hit.code,
      humidity: hit.humidity,
      windKph: hit.windKph,
      city: hit.city,
      region: hit.region,
      country: hit.country,
      timezone: hit.timezone,
      lat,
      lon,
      cached: true,
    });
  }

  try {
    // Richer current-conditions payload · apparent temp, humidity, wind so
    // the widget can show "feels like" + conditions without a second call.
    // timezone=auto returns local time-aligned data for the actual lat/lon.
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m&wind_speed_unit=kmh&timezone=auto`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return Response.json({ error: `weather ${r.status}` }, { status: 502 });
    const j = (await r.json()) as {
      timezone?: string;
      current?: {
        temperature_2m?: number;
        apparent_temperature?: number;
        relative_humidity_2m?: number;
        weather_code?: number;
        wind_speed_10m?: number;
      };
    };
    const tempC = j.current?.temperature_2m;
    const code = j.current?.weather_code;
    if (typeof tempC !== "number" || typeof code !== "number") {
      return Response.json({ error: "weather payload missing" }, { status: 502 });
    }
    const apparentC = j.current?.apparent_temperature ?? tempC;
    const humidity = j.current?.relative_humidity_2m ?? 0;
    const windKph = j.current?.wind_speed_10m ?? 0;
    const tz = j.timezone || "";
    // Reverse-geocode only when client didn't supply a hint — saves an
    // RTT on the common (GPS-armed) path.
    const geo = cityHint
      ? { city: cityHint, region: "", country: "" }
      : ((await reverseGeocode(lat, lon)) ?? { city: "", region: "", country: "" });
    const city = geo.city || "Your location";
    // Only cache when we actually resolved a real city · placeholder
    // would poison subsequent requests for 5 min.
    if (geo.city) {
      CACHE.set(key, {
        at: Date.now(),
        tempC,
        apparentC,
        code,
        humidity,
        windKph,
        city,
        region: geo.region,
        country: geo.country,
        timezone: tz,
      });
    }
    return Response.json({
      tempC,
      apparentC,
      code,
      humidity,
      windKph,
      city,
      region: geo.region,
      country: geo.country,
      timezone: tz,
      lat,
      lon,
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
