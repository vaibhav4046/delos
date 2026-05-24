// Virtual filesystem aggregator.
// Reads per-user desktop digest + connector credentials from HydraDB and returns
// a unified file listing. File CONTENT is never persisted by DelOS — we only
// surface metadata + the SOURCE path so the client knows where to read from.

import { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { getServerSession } from "@/lib/session";
import { safeRecall } from "@/lib/hydra";

export const runtime = "nodejs";

type VirtualEntry = {
  source: "desktop" | "notion" | "gmail" | "drive" | "github";
  path: string;
  name: string;
  size?: number;
  kind: "file" | "directory" | "page" | "thread";
  mime?: string;
  modifiedAt?: number;
  // Where to read on demand. Client follows this when user opens a file.
  // For desktop, the client re-uses its FileSystemHandle. For cloud, this is the source URL.
  readHandle?: string;
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const queryTenant = url.searchParams.get("tenantId");
  const session = await getServerSession();
  const tenantId = session?.tenantId || queryTenant || env.DELRIO_TENANT_ID;

  const out: VirtualEntry[] = [];

  // 1. Desktop index — parsed from DESKTOP_INDEX text anchor.
  const desk = await safeRecall({ tenantId, query: "DESKTOP_INDEX root", topK: 3 });
  for (const h of desk) {
    const root = h.text.match(/root=(\S+)/)?.[1];
    const lines = h.text.split("\n").slice(1, 80);
    for (const line of lines) {
      const m = line.match(/^\[(D|F)\]\s+(.+?)\s+\((\d+)B\)$/);
      if (!m) continue;
      out.push({
        source: "desktop",
        path: m[2],
        name: m[2].split("/").pop() || m[2],
        size: Number(m[3]),
        kind: m[1] === "D" ? "directory" : "file",
        readHandle: `desktop://${root ?? ""}${m[2]}`,
      });
    }
  }

  // 2. Connector credentials — surface a "root folder" entry per connected source so the
  //    UI can show e.g. "Notion · workspace=Acme" with one click drill-down.
  const creds = await safeRecall({ tenantId, query: "connector-credential", topK: 10 });
  for (const c of creds) {
    if (c.text.includes("NOTION_CREDENTIAL")) {
      const ws = c.text.match(/workspace=(\S+)/)?.[1];
      out.push({
        source: "notion",
        path: `/notion/${ws ?? "default"}`,
        name: ws ? `Notion · ${ws}` : "Notion",
        kind: "directory",
        readHandle: "https://api.notion.com/v1/search",
      });
    } else if (c.text.includes("GMAIL_CREDENTIAL")) {
      out.push({
        source: "gmail",
        path: "/gmail/inbox",
        name: "Gmail inbox",
        kind: "directory",
        readHandle: "https://gmail.googleapis.com/gmail/v1/users/me/messages",
      });
    } else if (c.text.includes("MS_CREDENTIAL")) {
      out.push({
        source: "drive",
        path: "/onedrive/root",
        name: "OneDrive root",
        kind: "directory",
        readHandle: "https://graph.microsoft.com/v1.0/me/drive/root/children",
      });
    }
  }

  return Response.json({
    ok: true,
    tenant: tenantId,
    count: out.length,
    entries: out.slice(0, 500),
    note: "DelOS does not persist file content. Each readHandle points at the source — desktop:// is read locally via FileSystemHandle, https:// is fetched on demand with the user's OAuth token.",
  });
}
