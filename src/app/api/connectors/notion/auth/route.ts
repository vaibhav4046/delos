// Notion OAuth2 initiator — redirects user to Notion authorization endpoint.
// Requires NOTION_OAUTH_CLIENT_ID + NOTION_OAUTH_REDIRECT_URI envs.
// Without them, returns 503 with setup instructions (honest probe).

import { env } from "@/lib/env";

export const runtime = "nodejs";

export async function GET() {
  const clientId = process.env.NOTION_OAUTH_CLIENT_ID;
  const redirectUri = process.env.NOTION_OAUTH_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return Response.json(
      {
        ok: false,
        reason: "missing env",
        missing: [
          ...(!clientId ? ["NOTION_OAUTH_CLIENT_ID"] : []),
          ...(!redirectUri ? ["NOTION_OAUTH_REDIRECT_URI"] : []),
        ],
        setup: {
          step1: "Go to https://www.notion.so/profile/integrations and create a Public integration",
          step2: "Add redirect URI: https://delrio.vercel.app/api/connectors/notion/callback",
          step3: "Set env NOTION_OAUTH_CLIENT_ID + NOTION_OAUTH_REDIRECT_URI in Vercel",
        },
      },
      { status: 503 },
    );
  }

  // Anti-CSRF state token — bind to tenant. In prod, persist in HydraDB or signed cookie.
  const state = `delos-${env.DELRIO_TENANT_ID}-${Math.random().toString(36).slice(2, 14)}`;

  const authUrl = new URL("https://api.notion.com/v1/oauth/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("owner", "user");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);

  return Response.redirect(authUrl.toString(), 302);
}
