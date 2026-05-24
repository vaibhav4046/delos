// Magic-link verify · sets signed session cookie, redirects to /os.

import { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { safeRecall, safeAddMemory } from "@/lib/hydra";
import { createHash, createHmac, randomBytes } from "node:crypto";

export const runtime = "nodejs";

function hashToken(t: string): string {
  return createHash("sha256").update(t + (process.env.AUTH_SECRET ?? "delos-dev-secret")).digest("hex").slice(0, 32);
}

function signSession(payload: { sub: string; iat: number; exp: number }): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", process.env.AUTH_SECRET ?? "delos-dev-secret")
    .update(body)
    .digest("base64url")
    .slice(0, 32);
  return `${body}.${sig}`;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const email = url.searchParams.get("email");
  if (!token || !email) {
    return Response.json({ ok: false, error: "missing token or email" }, { status: 400 });
  }
  const tokenHash = hashToken(token);

  // Look up issued tokens for this email via HydraDB.
  const hits = await safeRecall({
    tenantId: env.DELRIO_TENANT_ID,
    query: `AUTH_MAGIC email=${email} hash=${tokenHash}`,
    topK: 5,
  });
  const match = hits.find((h) => h.text.includes(`hash=${tokenHash}`) && h.text.includes(`email=${email}`));
  if (!match) {
    return Response.redirect(`${url.origin}/auth?error=invalid_token`, 302);
  }
  const expiresMatch = match.text.match(/expires=(\d+)/);
  const expiresAt = expiresMatch ? Number(expiresMatch[1]) : 0;
  if (Date.now() > expiresAt) {
    return Response.redirect(`${url.origin}/auth?error=expired_token`, 302);
  }

  // Mint 30-day session.
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 30 * 24 * 3600;
  const session = signSession({ sub: email, iat, exp });

  // Mark token consumed in HydraDB so it cannot be reused.
  await safeAddMemory({
    tenantId: env.DELRIO_TENANT_ID,
    text: `AUTH_CONSUMED hash=${tokenHash} email=${email} at=${Date.now()}`,
    metadata: { kind: "auth-consumed", email, tokenHash },
  });

  // First-time verify → also write USER_RECORD so the magic route can later
  // distinguish sign-in (existing) from sign-up (new). Idempotent: if recall
  // already finds one, the duplicate is harmless (HydraDB dedupes on text).
  // Email is normalized to lowercase so case variants don't fork the record.
  const emailLower = email.toLowerCase();
  await safeAddMemory({
    tenantId: env.DELRIO_TENANT_ID,
    text: `USER_RECORD email=${emailLower} firstSeen=${Date.now()} provider=magic`,
    metadata: { kind: "user-record", email: emailLower, provider: "magic" },
  });

  const sid = randomBytes(12).toString("base64url");
  void sid; // reserved for future per-session log keying

  const res = new Response(null, { status: 302, headers: { Location: `${url.origin}/os?welcome=${encodeURIComponent(email)}` } });
  res.headers.append(
    "Set-Cookie",
    `delos_session=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 3600}`,
  );
  return res;
}
