// Google OAuth2 sign-in callback (non-sensitive scopes).
// Exchanges code → id_token, derives email, mints DelOS session cookie.
// Different from /api/connectors/gmail/callback which expects refresh_token
// for ongoing Gmail data access.

import { env } from "@/lib/env";
import { deriveTenant, getSecret } from "@/lib/session";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";

export const runtime = "nodejs";

function signSession(payload: { sub: string; iat: number; exp: number }): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", getSecret())
    .update(body)
    .digest("base64url")
    .slice(0, 32);
  return `${body}.${sig}`;
}

function decodeJwtPayload(jwt: string): { email?: string; name?: string; picture?: string } | null {
  try {
    const parts = jwt.split(".");
    if (parts.length < 2) return null;
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const errParam = url.searchParams.get("error");
  const returnedState = url.searchParams.get("state") ?? "";

  if (errParam) {
    return Response.redirect(`${url.origin}/auth/signin?error=google_${encodeURIComponent(errParam)}`, 302);
  }
  if (!code) {
    return Response.json({ ok: false, error: "missing code" }, { status: 400 });
  }

  // CSRF: the start route set a cookie-bound state; reject if it doesn't match.
  const expectedState = req.cookies.get("delos_oauth_state_google")?.value ?? "";
  if (!expectedState || expectedState !== returnedState) {
    return Response.redirect(`${url.origin}/auth/signin?error=google_state_mismatch`, 302);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    return Response.json({ ok: false, error: "server missing Google OAuth credentials" }, { status: 503 });
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });

  if (!tokenRes.ok) {
    return Response.redirect(`${url.origin}/auth/signin?error=google_token_${tokenRes.status}`, 302);
  }

  const tokens = (await tokenRes.json()) as { id_token?: string; access_token?: string };
  const claims = tokens.id_token ? decodeJwtPayload(tokens.id_token) : null;
  const email = claims?.email;

  if (!email) {
    return Response.redirect(`${url.origin}/auth/signin?error=google_no_email`, 302);
  }

  // Mint 30-day DelOS session bound to the user's email-derived tenantId.
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 30 * 24 * 3600;
  const session = signSession({ sub: email, iat, exp });

  const res = new Response(null, {
    status: 302,
    headers: { Location: `${url.origin}/os?welcome=${encodeURIComponent(email)}` },
  });
  res.headers.append(
    "Set-Cookie",
    `delos_session=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 3600}`,
  );
  // Burn the one-shot state cookie so it can't be replayed.
  res.headers.append(
    "Set-Cookie",
    `delos_oauth_state_google=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  );
  void env;
  return res;
}
