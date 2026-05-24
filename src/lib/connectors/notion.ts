// Notion action helpers. OAuth flow already in /api/connectors/notion/*.
// callback persists workspace access_token + bot_id in HydraDB tagged
// "connector-credential" / connector="notion". Token doesn't expire so
// no exchange step; we just decrypt + use directly.

import { safeRecall } from "@/lib/hydra";
import { decryptSecret } from "@/lib/secrets";

type Cred = {
  tokenCipher?: string;
  workspaceName?: string;
  botId?: string;
  workspaceId?: string;
};

export async function getNotionToken(tenantId: string): Promise<{ token: string; workspaceName?: string; workspaceId?: string } | null> {
  const hits = await safeRecall({ tenantId, query: "NOTION_CREDENTIAL connector notion", topK: 8 });
  for (const h of hits as Array<{ metadata?: Cred }>) {
    const meta = h.metadata;
    if (!meta?.tokenCipher) continue;
    try {
      const token = decryptSecret(meta.tokenCipher);
      if (!token) continue;
      return { token, workspaceName: meta.workspaceName, workspaceId: meta.workspaceId };
    } catch {}
  }
  return null;
}

export async function notionCreatePage(
  tenantId: string,
  args: { title: string; content: string; parentPageId?: string },
): Promise<{ pageId: string; url: string }> {
  const cred = await getNotionToken(tenantId);
  if (!cred) throw new Error("no_notion_credential — open Settings → Connectors → Notion to authorize");
  // If no parent given, search for the first workspace page the integration has access to.
  let parentId = args.parentPageId;
  if (!parentId) {
    const sr = await fetch("https://api.notion.com/v1/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${cred.token}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
      body: JSON.stringify({ filter: { property: "object", value: "page" }, page_size: 1 }),
    });
    if (sr.ok) {
      const sj = (await sr.json()) as { results?: Array<{ id?: string }> };
      parentId = sj.results?.[0]?.id;
    }
  }
  if (!parentId) throw new Error("notion has no accessible parent page — share at least one page with the DelOS integration");

  const body = {
    parent: { page_id: parentId },
    properties: { title: [{ type: "text", text: { content: args.title.slice(0, 200) } }] },
    children: args.content
      .split(/\n{2,}/)
      .slice(0, 50)
      .map((para) => ({
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: [{ type: "text", text: { content: para.slice(0, 2000) } }] },
      })),
  };
  const r = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: { Authorization: `Bearer ${cred.token}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`notion ${r.status} ${(await r.text()).slice(0, 120)}`);
  const j = (await r.json()) as { id?: string; url?: string };
  if (!j.id) throw new Error("notion response missing id");
  return { pageId: j.id, url: j.url ?? `https://notion.so/${j.id.replace(/-/g, "")}` };
}
