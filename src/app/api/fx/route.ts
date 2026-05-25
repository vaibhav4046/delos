// Server-side FX rates proxy. Browser-side Frankfurter fetches were silently
// failing on some networks (the screenshot showed all dashes), so we proxy
// + cache here. Falls back through a 3-provider chain so a single upstream
// outage doesn't blank the widget:
//   1. Frankfurter (ECB-derived, no key, generous quota)
//   2. open.er-api.com (free, no key, hourly cap)
//   3. exchangerate.host (free, no key, daily)
//
// 1h in-Lambda cache. Returns { base: "USD", rates: { EUR, GBP, INR, JPY, ... } }.

import { NextRequest } from "next/server";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT_PER_MIN = 30;
const WINDOW_MS = 60_000;

type CacheVal = { at: number; base: string; rates: Record<string, number>; source: string };
const CACHE = new Map<string, CacheVal>();
const TTL_MS = 60 * 60_000; // 1 hour

async function tryFrankfurter(base: string, syms: string[]): Promise<{ rates: Record<string, number>; source: string } | null> {
  try {
    const r = await fetch(
      `https://api.frankfurter.app/latest?from=${base}&to=${syms.join(",")}`,
      { cache: "no-store" },
    );
    if (!r.ok) return null;
    const j = (await r.json()) as { rates?: Record<string, number> };
    if (!j.rates || Object.keys(j.rates).length === 0) return null;
    return { rates: j.rates, source: "frankfurter" };
  } catch { return null; }
}

async function tryErApi(base: string): Promise<{ rates: Record<string, number>; source: string } | null> {
  try {
    const r = await fetch(`https://open.er-api.com/v6/latest/${base}`, { cache: "no-store" });
    if (!r.ok) return null;
    const j = (await r.json()) as { rates?: Record<string, number>; result?: string };
    if (j.result !== "success" || !j.rates) return null;
    return { rates: j.rates, source: "er-api" };
  } catch { return null; }
}

async function tryExchangeHost(base: string, syms: string[]): Promise<{ rates: Record<string, number>; source: string } | null> {
  try {
    const r = await fetch(
      `https://api.exchangerate.host/latest?base=${base}&symbols=${syms.join(",")}`,
      { cache: "no-store" },
    );
    if (!r.ok) return null;
    const j = (await r.json()) as { rates?: Record<string, number>; success?: boolean };
    if (!j.rates || Object.keys(j.rates).length === 0) return null;
    return { rates: j.rates, source: "exchangerate.host" };
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  const ip = clientIp(req);
  const lim = rateLimit(`fx:ip:${ip}`, LIMIT_PER_MIN, WINDOW_MS);
  if (!lim.ok) {
    return Response.json({ error: "rate limited" }, { status: 429, headers: lim.headers });
  }
  const u = new URL(req.url);
  const base = (u.searchParams.get("base") || "USD").toUpperCase().slice(0, 3);
  const rawSyms = (u.searchParams.get("symbols") || "EUR,GBP,INR,JPY,CAD,AUD,CNY,CHF").toUpperCase();
  const syms = rawSyms.split(",").map((s) => s.trim()).filter((s) => /^[A-Z]{3}$/.test(s)).slice(0, 12);

  const cacheKey = `${base}|${syms.join(",")}`;
  const hit = CACHE.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return Response.json({ base: hit.base, rates: hit.rates, source: hit.source, cached: true });
  }

  // Try the 3-provider chain in order — first non-null wins.
  const provider =
    (await tryFrankfurter(base, syms)) ||
    (await tryErApi(base)) ||
    (await tryExchangeHost(base, syms));
  if (!provider) {
    return Response.json({ error: "all FX providers failed" }, { status: 502 });
  }
  // Trim to requested symbols when provider returns the full set.
  const trimmed: Record<string, number> = {};
  for (const s of syms) {
    if (typeof provider.rates[s] === "number") trimmed[s] = provider.rates[s];
  }
  CACHE.set(cacheKey, { at: Date.now(), base, rates: trimmed, source: provider.source });
  return Response.json({ base, rates: trimmed, source: provider.source });
}
