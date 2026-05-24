// Google OAuth2 sign-in initiator (non-sensitive scopes only).
// Uses ONLY openid + email + profile so Google does NOT show the
// "this app is not verified" warning. For Gmail data access (sensitive),
// use /api/connectors/gmail/auth instead — that path still requires verification.

import { randomBytes } from "node:crypto";

export const runtime = "nodejs";

const SCOPES = ["openid", "email", "profile"].join(" ");

export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  // Reuse the SAME redirect URI as the Gmail flow because that one is already registered
  // in Google Cloud Console as an authorized redirect. The shared Gmail callback below
  // detects the `-signin` state suffix and skips the refresh_token requirement.
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
      },
      { status: 503 },
    );
  }

  // Cryptographically random state, persisted in a short-lived cookie. The
  // callback must echo it back exactly — otherwise an attacker could feed a
  // victim a pre-prepared ?code= URL and have them sign in as the attacker.
  const nonce = randomBytes(24).toString("base64url");
  const state = `${nonce}-signin`;

  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPES);
  u.searchParams.set("access_type", "online"); // No refresh token needed for sign-in only
  u.searchParams.set("prompt", "select_account");
  u.searchParams.set("state", state);
  // include_granted_scopes lets users who already authorized Gmail keep that grant
  u.searchParams.set("include_granted_scopes", "true");

  const res = new Response(null, { status: 302, headers: { Location: u.toString() } });
  res.headers.append(
    "Set-Cookie",
    `delos_oauth_state_google=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
  );
  return res;
}
