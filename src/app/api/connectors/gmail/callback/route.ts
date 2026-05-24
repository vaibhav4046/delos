// Gmail OAuth2 callback — exchanges auth code for tokens, persists refresh token.

import { env } from "@/lib/env";
import { safeAddMemory } from "@/lib/hydra";
import { deriveTenant } from "@/lib/session";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";

function signSession(payload: { sub: string; iat: number; exp: number }): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", process.env.AUTH_SECRET ?? "delos-dev-secret")
    .update(body)
    .digest("base64url")
    .slice(0, 32);
  return `${body}.${sig}`;
}

function decodeJwtPayload(jwt: string): { email?: string } | null {
  try {
    const parts = jwt.split(".");
    if (parts.length < 2) return null;
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errParam = url.searchParams.get("error");

  if (errParam) {
    return Response.redirect(`${url.origin}/os?connector_error=gmail_${encodeURIComponent(errParam)}`, 302);
  }
  if (!code || !state || !state.startsWith("delos-")) {
    return Response.json({ ok: false, error: "missing or invalid state/code" }, { status: 400 });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    return Response.json({ ok: false, error: "server missing OAuth credentials" }, { status: 503 });
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
    return Response.redirect(
      `${url.origin}/os?connector_error=gmail_${encodeURIComponent(`token_exchange_${tokenRes.status}`)}`,
      302,
    );
  }

  const tokens = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
    id_token?: string;
  };

  // Sign-in only flow uses state suffix `-signin` and online-access scopes — no
  // refresh_token is granted. We still need the id_token to derive the email.
  const stateRaw = url.searchParams.get("state") ?? "";
  const isSignInOnly = stateRaw.endsWith("-signin");

  if (!isSignInOnly && !tokens.refresh_token) {
    return Response.redirect(`${url.origin}/os?connector_error=gmail_no_refresh_token`, 302);
  }

  // Pull email from id_token claims so we can mint a DelOS session.
  const claims = tokens.id_token ? decodeJwtPayload(tokens.id_token) : null;
  const email = claims?.email;
  const tenant = email ? deriveTenant(email) : env.DELRIO_TENANT_ID;

  // Only persist Gmail credential when we actually got a refresh_token (Gmail data flow).
  if (tokens.refresh_token) {
    // SECURITY: encrypt refresh_token before persisting; only redacted form in text.
    const { encryptSecret, redactToken } = await import("@/lib/secrets");
    const tokenCipher = encryptSecret(tokens.refresh_token);
    await safeAddMemory({
      tenantId: tenant,
      text: `GMAIL_CREDENTIAL refresh_token=${redactToken(tokens.refresh_token)} scope="${tokens.scope ?? ""}" email=${email ?? "?"}`,
      metadata: {
        connector: "gmail",
        tags: ["connector-credential", "gmail"],
        scope: tokens.scope,
        email,
        tokenCipher,
      },
    });
  }

  // Mint DelOS session cookie when Gmail OAuth confirms an email — unifies Gmail OAuth + sign-in.
  if (email) {
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + 30 * 24 * 3600;
    const session = signSession({ sub: email, iat, exp });
    const res = new Response(null, { status: 302, headers: { Location: `${url.origin}/os?connector_success=gmail&welcome=${encodeURIComponent(email)}` } });
    res.headers.append(
      "Set-Cookie",
      `delos_session=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 3600}`,
    );
    return res;
  }

  return Response.redirect(`${url.origin}/os?connector_success=gmail`, 302);
}
