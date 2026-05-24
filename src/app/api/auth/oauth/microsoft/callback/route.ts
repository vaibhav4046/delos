// Microsoft OAuth2 callback. Exchanges code → access_token + id_token, derives email,
// mints DelOS session cookie, redirects to /os.

import { env } from "@/lib/env";
import { safeAddMemory } from "@/lib/hydra";
import { deriveTenant } from "@/lib/session";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";

export const runtime = "nodejs";

function signSession(payload: { sub: string; iat: number; exp: number }): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", process.env.AUTH_SECRET ?? "delos-dev-secret")
    .update(body)
    .digest("base64url")
    .slice(0, 32);
  return `${body}.${sig}`;
}

function decodeJwtPayload(jwt: string): { email?: string; preferred_username?: string; name?: string } | null {
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
  if (errParam) return Response.redirect(`${url.origin}/auth?error=ms_${encodeURIComponent(errParam)}`, 302);
  if (!code) return Response.json({ ok: false, error: "missing code" }, { status: 400 });

  const clientId = process.env.MS_CLIENT_ID;
  const clientSecret = process.env.MS_CLIENT_SECRET;
  const redirectUri = process.env.MS_OAUTH_REDIRECT_URI;
  const tenant = process.env.MS_TENANT_ID || "common";
  if (!clientId || !clientSecret || !redirectUri) {
    return Response.json({ ok: false, error: "server missing MS OAuth credentials" }, { status: 503 });
  }

  const tokenRes = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });

  if (!tokenRes.ok) {
    return Response.redirect(`${url.origin}/auth?error=ms_token_${tokenRes.status}`, 302);
  }
  const tokens = (await tokenRes.json()) as { access_token?: string; id_token?: string; refresh_token?: string };
  const claims = tokens.id_token ? decodeJwtPayload(tokens.id_token) : null;
  const email = claims?.email || claims?.preferred_username;
  if (!email) {
    return Response.redirect(`${url.origin}/auth?error=ms_no_email`, 302);
  }

  // Persist refresh token if granted, scoped to derived tenant.
  // SECURITY: encrypt refresh_token; redact in text.
  if (tokens.refresh_token) {
    const { encryptSecret, redactToken } = await import("@/lib/secrets");
    const tokenCipher = encryptSecret(tokens.refresh_token);
    await safeAddMemory({
      tenantId: deriveTenant(email),
      text: `MS_CREDENTIAL refresh_token=${redactToken(tokens.refresh_token)} email=${email}`,
      metadata: { connector: "microsoft", tags: ["connector-credential", "microsoft"], email, tokenCipher },
    });
  }

  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 30 * 24 * 3600;
  const session = signSession({ sub: email, iat, exp });
  const res = new Response(null, { status: 302, headers: { Location: `${url.origin}/os?welcome=${encodeURIComponent(email)}` } });
  res.headers.append(
    "Set-Cookie",
    `delos_session=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 3600}`,
  );
  void env; // referenced via deriveTenant
  return res;
}
