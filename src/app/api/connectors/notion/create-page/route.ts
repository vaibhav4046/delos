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
  if (source !== "session") {
    return Response.json({ ok: false, error: "unauthenticated", hint: "sign in first" }, { status: 401 });
  }
  try {
    const page = await notionCreatePage(tenantId, parsed.data);
    return Response.json({ ok: true, pageId: page.pageId, url: page.url });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 503 });
  }
}
