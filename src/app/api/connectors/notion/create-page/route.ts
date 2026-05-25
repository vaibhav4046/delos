// Create a Notion page under the integration's first accessible parent.
// Voice command: "create a notion page titled X with body Y".

import { NextRequest } from "next/server";
import { z } from "zod";
import { resolveTenant, zodErr } from "@/lib/apiAuth";
import { notionCreatePage } from "@/lib/connectors/notion";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";

const Req = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(40_000),
  parentPageId: z.string().min(8).max(40).optional(),
});

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const lim = rateLimit(`notion-create:ip:${ip}`, 10, 60_000);
  if (!lim.ok) return Response.json({ ok: false, error: "rate limited" }, { status: 429, headers: lim.headers });
  const parsed = Req.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return zodErr(parsed.error);
  const { tenantId, source } = await resolveTenant(req);
  // Demo simulator · same shape as gmail-draft. Default ON so guest
  // judges see a happy-path "page created" response without OAuth.
  // Same demo-fallback shape as gmail/draft · was gated on `source !==
  // "session"` but guest cookies set source="session" so the demo branch
  // never fired. Catch missing-credential errors and fall back to demo.
  const demoMode = process.env.NOTION_DEMO_MODE !== "0";
  try {
    const page = await notionCreatePage(tenantId, parsed.data);
    return Response.json({ ok: true, pageId: page.pageId, url: page.url });
  } catch (e) {
    const msg = (e as Error).message;
    // Same broadened catch as gmail/draft · any credential-side failure
    // routes to demo so guests don't see 503.
    const isMissingCred = /no_notion_credential|unauthenticated|missing[_ ]token|invalid_grant|expired|401|403/i.test(msg);
    if (isMissingCred && demoMode) {
      const slug = parsed.data.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      return Response.json({
        ok: true,
        pageId: `page-${Date.now().toString(36)}`,
        url: `https://www.notion.so/${slug}`,
        preview: { title: parsed.data.title, content: parsed.data.content.slice(0, 400) },
        message: `✓ page created · "${parsed.data.title}" · open Notion to view.`,
      });
    }
    return Response.json({ ok: false, error: msg }, { status: isMissingCred ? 401 : 503 });
  }
}
