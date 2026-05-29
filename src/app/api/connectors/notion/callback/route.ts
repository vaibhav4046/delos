// Notion OAuth2 callback — exchanges auth code for access token.
// Stores token in HydraDB as a tenant-scoped credential record.
// On success, redirects user back to /os with toast confirmation.

import { safeAddMemory } from "@/lib/hydra";
import { NextRequest } from "next/server";
import { resolveTenant } from "@/lib/apiAuth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errParam = url.searchParams.get("error");

  if (errParam) {
    return Response.redirect(`${url.origin}/os?connector_error=notion_${encodeURIComponent(errParam)}`, 302);
  }
  if (!code || !state || !state.startsWith("delos-")) {
    return Response.json({ ok: false, error: "missing or invalid state/code" }, { status: 400 });
  }
  // CSRF: callback state must match the cookie set by the initiator.
  const expectedState = req.cookies.get("delos_oauth_state_notion")?.value ?? "";
  if (!expectedState || expectedState !== state) {
    return Response.redirect(`${url.origin}/os?connector_error=notion_state_mismatch`, 302);
  }

  const clientId = process.env.NOTION_OAUTH_CLIENT_ID;
  const clientSecret = process.env.NOTION_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.NOTION_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    return Response.json({ ok: false, error: "server missing OAuth credentials" }, { status: 503 });
  }

  // Exchange code for access token
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const tokenRes = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  });

  if (!tokenRes.ok) {
    return Response.redirect(
      `${url.origin}/os?connector_error=notion_${encodeURIComponent(`token_exchange_${tokenRes.status}`)}`,
      302,
    );
  }

  const tokens = (await tokenRes.json()) as {
    access_token?: string;
    workspace_id?: string;
    workspace_name?: string;
    bot_id?: string;
  };

  if (!tokens.access_token) {
    return Response.redirect(`${url.origin}/os?connector_error=notion_no_token`, 302);
  }

  // Persist to HydraDB. Tag with connector + tenantId for retrieval.
  // SECURITY: never put raw access_token in `text` — that's surfaced to recall
  // and included in LLM context. Encrypt and stash in metadata.
  const { encryptSecret, redactToken } = await import("@/lib/secrets");
  const tokenCipher = encryptSecret(tokens.access_token);
  // SECURITY: bind the OAuth token to the caller's resolved tenant (session →
  // per-IP anon), NEVER the shared `delrio_demo` seed tenant. Previously the
  // token landed in the shared tenant, letting any other guest resolving there
  // drive Notion actions with the victim's credential (cross-tenant reuse).
  const { tenantId } = await resolveTenant(req, { intent: "write" });
  await safeAddMemory({
    tenantId,
    text: `NOTION_CREDENTIAL workspace=${tokens.workspace_name ?? "unknown"} bot=${tokens.bot_id ?? "?"} token=${redactToken(tokens.access_token)}`,
    metadata: {
      connector: "notion",
      workspaceId: tokens.workspace_id,
      workspaceName: tokens.workspace_name,
      tags: ["connector-credential", "notion"],
      tokenCipher,
    },
  });

  const res = new Response(null, { status: 302, headers: { Location: `${url.origin}/os?connector_success=notion` } });
  res.headers.append(
    "Set-Cookie",
    `delos_oauth_state_notion=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  );
  return res;
}
