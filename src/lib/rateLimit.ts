// Simple in-memory sliding-window rate limit.
// Keyed by arbitrary string (IP, email, IP+email composite, etc).
// In-memory only — survives within a single Vercel warm Lambda instance.
// For multi-instance prod we'd swap to Upstash / Redis; for hackathon-scale
// abuse vectors (email-bomb the magic-link endpoint) a single-instance
// limiter is enough to make the attack uneconomic.
//
// Usage:
//   const ip = clientIp(req);
//   const r = rateLimit(`magic:ip:${ip}`, 30, 60_000);
//   if (!r.ok) return Response.json({ ok: false, error: "rate limited" }, { status: 429, headers: r.headers });

type Bucket = number[]; // timestamps in ms

const buckets = new Map<string, Bucket>();

// Prune all buckets every minute to bound memory. Without this, a Lambda
// that ran for hours with many unique keys would leak.
const PRUNE_INTERVAL_MS = 60_000;
let lastPrune = Date.now();

function prune(now: number, maxWindow: number) {
  if (now - lastPrune < PRUNE_INTERVAL_MS) return;
  lastPrune = now;
  for (const [k, arr] of buckets) {
    const fresh = arr.filter((t) => now - t < maxWindow);
    if (fresh.length === 0) buckets.delete(k);
    else if (fresh.length !== arr.length) buckets.set(k, fresh);
  }
}

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
  headers: Record<string, string>;
};

/**
 * @param key  unique bucket id (e.g. `magic:ip:1.2.3.4`)
 * @param max  max requests per window
 * @param windowMs  window length in ms
 */
export function rateLimit(key: string, max: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  prune(now, windowMs);
  const arr = buckets.get(key) ?? [];
  // Drop expired entries first.
  const fresh = arr.filter((t) => now - t < windowMs);
  if (fresh.length >= max) {
    const oldest = fresh[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return {
      ok: false,
      remaining: 0,
      retryAfterSec,
      headers: {
        "Retry-After": String(retryAfterSec),
        "X-RateLimit-Limit": String(max),
        "X-RateLimit-Remaining": "0",
      },
    };
  }
  fresh.push(now);
  buckets.set(key, fresh);
  return {
    ok: true,
    remaining: max - fresh.length,
    retryAfterSec: 0,
    headers: {
      "X-RateLimit-Limit": String(max),
      "X-RateLimit-Remaining": String(max - fresh.length),
    },
  };
}

/**
 * Best-effort client IP extraction. Vercel forwards real IP via x-forwarded-for.
 * Falls back to a deterministic "unknown" bucket so anonymous traffic still gets
 * collectively rate-limited rather than being unbounded.
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    // First entry is the original client; rest are proxies.
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}
