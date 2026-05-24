// Gmail OAuth2 initiator — Google authorization endpoint with PKCE.
// Requires GOOGLE_CLIENT_ID + GOOGLE_OAUTH_REDIRECT_URI envs.

import { randomBytes } from "node:crypto";

export const runtime = "nodejs";

// Gmail scopes — readonly + send. Modify cautiously, every scope = privacy ask.
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "openid",
  "email",
].join(" ");

export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return Response.json(
      {
        ok: false,
        reason: "missing env",
        missing: [
          ...(!clientId ? ["GOOGLE_CLIENT_ID"] : []),
          ...(!redirectUri ? ["GOOGLE_OAUTH_REDIRECT_URI"] : []),
        ],
        setup: {
          step1: "Go to https://console.cloud.google.com/apis/credentials and create OAuth 2.0 Client",
          step2: "Add redirect URI: https://delrio.vercel.app/api/connectors/gmail/callback",
          step3: "Enable Gmail API + set env GOOGLE_CLIENT_ID + GOOGLE_OAUTH_REDIRECT_URI",
        },
      },
      { status: 503 },
    );
  }

  // CSRF: cryptographically random state persisted in cookie. Callback verifies.
  const state = `delos-${randomBytes(18).toString("base64url")}`;

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("access_type", "offline"); // Get refresh token
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", state);

  const res = new Response(null, { status: 302, headers: { Location: authUrl.toString() } });
  res.headers.append(
    "Set-Cookie",
    `delos_oauth_state_gmail=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
  );
  return res;
}
