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
// Track the largest window any caller has ever used. The old code pruned with
// only the *current* caller's window, so a sweep triggered by a short-window
// caller (e.g. 60s) would evict timestamps still live for a long-window caller
// (e.g. a 1h limit) sharing the same map — silently resetting their counts and
// breaking the longer limit. Pruning with the max window seen is always safe:
// it only drops entries older than EVERY active window.
let maxWindowSeen = 0;

function prune(now: number) {
  if (now - lastPrune < PRUNE_INTERVAL_MS) return;
  lastPrune = now;
  for (const [k, arr] of buckets) {
    const fresh = arr.filter((t) => now - t < maxWindowSeen);
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
  if (windowMs > maxWindowSeen) maxWindowSeen = windowMs;
  prune(now);
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
 * Best-effort client IP extraction.
 *
 * SECURITY: prefer the platform-set `x-real-ip` over `x-forwarded-for`. On
 * Vercel (and most single-proxy edges) `x-real-ip` is overwritten by the
 * platform with the real socket IP and cannot be spoofed by the client. The
 * first `x-forwarded-for` entry, by contrast, is whatever the *client* sent —
 * an attacker can rotate a fake `x-forwarded-for: <random>` on every request
 * to land in a fresh bucket and bypass the per-IP limit entirely. We therefore
 * only fall back to XFF when `x-real-ip` is absent (e.g. local dev).
 *
 * Falls back to a deterministic "unknown" bucket so anonymous traffic still
 * gets collectively rate-limited rather than being unbounded.
 */
export function clientIp(req: Request): string {
  // Platform-set, client-UNSPOOFABLE headers first, in order of trust. On any
  // real edge (Vercel sets x-real-ip + x-vercel-forwarded-for; Cloudflare sets
  // cf-connecting-ip) one of these is always present and overwritten with the
  // true socket IP, so an attacker cannot rotate them to dodge the per-IP limit.
  for (const h of ["x-real-ip", "cf-connecting-ip", "x-vercel-forwarded-for"]) {
    const v = req.headers.get(h);
    const first = v?.split(",")[0]?.trim();
    if (first) return first;
  }
  // Dev / no-edge fallback ONLY: the client-supplied x-forwarded-for is
  // spoofable (rotate it → fresh bucket → bypass). Because a real deployment
  // always provides a platform header above, this branch never runs in prod —
  // which is what keeps the XFF-rotation limiter bypass from being exploitable.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return "unknown";
}
