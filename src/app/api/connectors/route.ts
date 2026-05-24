// Connectors hub — honest probe of which ingestion backends are configured.
// No mocks. Each connector reports available:true ONLY if its required env vars are set.

export const runtime = "nodejs";

type Connector = {
  id: string;
  name: string;
  category: "knowledge" | "communication" | "storage" | "calendar" | "social" | "code" | "database";
  available: boolean;
  reason?: string;
  requires: string[];
  scopes?: string[];
  setupUrl?: string;
  docsUrl?: string;
  // If set, clicking "Connect" launches OAuth flow at this DelOS path.
  oauthInit?: string;
};

function present(...keys: string[]): { ok: boolean; missing: string[] } {
  const missing = keys.filter((k) => !process.env[k]);
  return { ok: missing.length === 0, missing };
}

// A connector is also "live" if any one of these alternate variable groups is fully set.
// Used so an OAuth-configured source counts as live even when the legacy direct-token env is absent.
function presentAny(groups: string[][]): { ok: boolean; missing: string[] } {
  for (const g of groups) {
    const p = present(...g);
    if (p.ok) return p;
  }
  // Return the smallest missing group so the UI can show what to set.
  return present(...groups[0]);
}

export async function GET() {
  const connectors: Connector[] = [
    {
      id: "notion",
      name: "Notion",
      category: "knowledge",
      ...probe(
        "notion",
        // Live if either legacy integration token OR OAuth client creds are set.
        presentAny([
          ["NOTION_INTEGRATION_TOKEN"],
          ["NOTION_OAUTH_CLIENT_ID", "NOTION_OAUTH_CLIENT_SECRET"],
        ]),
      ),
      requires: ["NOTION_INTEGRATION_TOKEN or NOTION_OAUTH_CLIENT_ID+SECRET"],
      scopes: ["read_content", "update_content", "read_user"],
      setupUrl: "https://www.notion.so/profile/integrations/new",
      docsUrl: "https://developers.notion.com/docs/create-a-notion-integration",
      oauthInit: "/api/connectors/notion/auth",
    },
    {
      id: "gmail",
      name: "Gmail",
      category: "communication",
      ...probe("gmail", present("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET")),
      requires: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"],
      scopes: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"],
      setupUrl: "https://console.cloud.google.com/apis/credentials",
      docsUrl: "https://developers.google.com/gmail/api/quickstart/js",
      oauthInit: "/api/connectors/gmail/auth",
    },
    {
      id: "gdrive",
      name: "Google Drive",
      category: "storage",
      ...probe("gdrive", present("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET")),
      requires: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"],
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
      setupUrl: "https://console.cloud.google.com/apis/credentials",
      docsUrl: "https://developers.google.com/drive/api/quickstart/js",
    },
    {
      id: "gcal",
      name: "Google Calendar",
      category: "calendar",
      ...probe("gcal", present("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET")),
      requires: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"],
      scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
      setupUrl: "https://console.cloud.google.com/apis/credentials",
      docsUrl: "https://developers.google.com/calendar/api/quickstart/js",
    },
    {
      id: "slack",
      name: "Slack",
      category: "communication",
      ...probe("slack", present("SLACK_BOT_TOKEN")),
      requires: ["SLACK_BOT_TOKEN"],
      scopes: ["chat:write", "channels:read", "channels:history"],
      setupUrl: "https://api.slack.com/apps?new_app=1",
      docsUrl: "https://api.slack.com/quickstart",
    },
    {
      id: "github",
      name: "GitHub",
      category: "code",
      ...probe("github", present("GITHUB_TOKEN")),
      requires: ["GITHUB_TOKEN"],
      scopes: ["repo", "read:user"],
      setupUrl: "https://github.com/settings/tokens/new",
      docsUrl: "https://docs.github.com/en/rest",
    },
    {
      id: "linear",
      name: "Linear",
      category: "knowledge",
      ...probe("linear", present("LINEAR_API_KEY")),
      requires: ["LINEAR_API_KEY"],
      setupUrl: "https://linear.app/settings/api",
      docsUrl: "https://developers.linear.app/docs/graphql/working-with-the-graphql-api",
    },
    {
      id: "supabase",
      name: "Supabase",
      category: "database",
      ...probe("supabase", present("SUPABASE_URL", "SUPABASE_ANON_KEY")),
      requires: ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
      setupUrl: "https://supabase.com/dashboard/new",
      docsUrl: "https://supabase.com/docs/guides/getting-started",
    },
    {
      id: "x",
      name: "X (Twitter)",
      category: "social",
      ...probe("x", present("X_BEARER_TOKEN")),
      requires: ["X_BEARER_TOKEN"],
      setupUrl: "https://developer.twitter.com/en/portal/dashboard",
      docsUrl: "https://developer.twitter.com/en/docs/twitter-api",
    },
    {
      id: "hydradb",
      name: "HydraDB",
      category: "database",
      ...probe("hydradb", present("HYDRA_DB_API_KEY")),
      requires: ["HYDRA_DB_API_KEY"],
      docsUrl: "https://hydradb.com",
    },
    {
      id: "elevenlabs",
      name: "ElevenLabs (voice)",
      category: "communication",
      ...probe("elevenlabs", present("ELEVENLABS_API_KEY")),
      requires: ["ELEVENLABS_API_KEY"],
      docsUrl: "https://elevenlabs.io/docs",
    },
  ];

  const summary = {
    total: connectors.length,
    connected: connectors.filter((c) => c.available).length,
    available_by_category: connectors.reduce(
      (acc, c) => {
        if (c.available) acc[c.category] = (acc[c.category] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    ),
  };

  return Response.json({ ok: true, connectors, summary, at: Date.now() });
}

function probe(name: string, p: { ok: boolean; missing: string[] }): Pick<Connector, "available" | "reason"> {
  if (p.ok) return { available: true };
  return { available: false, reason: `missing env: ${p.missing.join(", ")}` };
}
