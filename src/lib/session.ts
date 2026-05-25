// DelOS session reader. Verifies the signed `delos_session` cookie and
// derives a per-user tenantId so every HydraDB write scopes to that user only.

import { createHash, createHmac } from "node:crypto";
import { cookies } from "next/headers";

export type Session = {
  email: string;
  iat: number;
  exp: number;
  tenantId: string;
};

// Resolve the signing secret lazily so a missing AUTH_SECRET doesn't crash
// the Next.js build's collect-page-data pass (which evaluates modules under
// NODE_ENV=production without the runtime env vars). At first verify call
// in production, we still refuse to sign or verify without a real secret —
// just without taking the whole deploy down at build time.
// Exported so every auth/crypto module derives keys from one source. Without
// this, six different modules each had their own `process.env.AUTH_SECRET ??
// "delos-dev-secret"` fallback — meaning a missing AUTH_SECRET in production
// would silently sign sessions / encrypt connector tokens with a known string.
// Brutal-QA flagged it as a session-forgery + connector-token-decrypt vector.
export function getSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET is required in production");
  }
  return "delos-dev-secret";
}

function hmacShort(body: string): string {
  return createHmac("sha256", getSecret()).update(body).digest("base64url").slice(0, 32);
}

// Stable per-user tenantId derived from email. 12 char base32, prefixed `u_`.
export function deriveTenant(email: string): string {
  const h = createHash("sha256").update(email.toLowerCase().trim() + getSecret()).digest("hex");
  return `u_${h.slice(0, 12)}`;
}

// Parse and verify a session token (body.sig). Returns null on any failure.
export function verifySession(raw: string): Session | null {
  if (!raw || !raw.includes(".")) return null;
  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;
  if (hmacShort(body) !== sig) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      sub?: string;
      iat?: number;
      exp?: number;
    };
    if (!payload.sub || !payload.exp) return null;
    if (Math.floor(Date.now() / 1000) > payload.exp) return null;
    return {
      email: payload.sub,
      iat: payload.iat ?? 0,
      exp: payload.exp,
      tenantId: deriveTenant(payload.sub),
    };
  } catch {
    return null;
  }
}

// Read session from incoming Next.js request cookies. Server-side only.
export async function getServerSession(): Promise<Session | null> {
  try {
    const store = await cookies();
    const raw = store.get("delos_session")?.value;
    if (!raw) return null;
    return verifySession(raw);
  } catch {
    return null;
  }
}
