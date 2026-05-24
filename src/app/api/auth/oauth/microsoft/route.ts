// Microsoft OAuth2 (Azure AD) sign-in initiator.
// Requires MS_CLIENT_ID + MS_OAUTH_REDIRECT_URI envs. Honest 503 with setup instructions otherwise.

import { randomBytes } from "node:crypto";

export const runtime = "nodejs";

const SCOPES = ["openid", "email", "profile", "offline_access", "User.Read"].join(" ");

export async function GET() {
  const clientId = process.env.MS_CLIENT_ID;
  const redirectUri = process.env.MS_OAUTH_REDIRECT_URI;
  const tenant = process.env.MS_TENANT_ID || "common"; // multi-tenant by default

  if (!clientId || !redirectUri) {
    return Response.json(
      {
        ok: false,
        reason: "missing env",
        missing: [
          ...(!clientId ? ["MS_CLIENT_ID"] : []),
          ...(!redirectUri ? ["MS_OAUTH_REDIRECT_URI"] : []),
        ],
        setup: {
          step1: "Register app at https://portal.azure.com → Azure Active Directory → App registrations",
          step2: "Add redirect URI: https://delrio.vercel.app/api/auth/oauth/microsoft/callback",
          step3: "Set env MS_CLIENT_ID + MS_OAUTH_REDIRECT_URI (and optionally MS_TENANT_ID)",
        },
      },
      { status: 503 },
    );
  }

  // CSRF: random state persisted in cookie; callback must echo it back.
  const state = randomBytes(24).toString("base64url");
  const u = new URL(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPES);
  u.searchParams.set("state", state);
  u.searchParams.set("response_mode", "query");

  const res = new Response(null, { status: 302, headers: { Location: u.toString() } });
  res.headers.append(
    "Set-Cookie",
    `delos_oauth_state_ms=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
  );
  return res;
}
