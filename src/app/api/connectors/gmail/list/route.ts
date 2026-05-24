// List the caller's Gmail inbox. Read-only.
import { NextRequest } from "next/server";
import { z } from "zod";
import { resolveTenant, zodErr } from "@/lib/apiAuth";
import { gmailList } from "@/lib/connectors/gmail";

export const runtime = "nodejs";

const Req = z.object({
  q: z.string().max(200).optional().default(""),
  limit: z.number().int().min(1).max(25).optional().default(10),
});

export async function POST(req: NextRequest) {
  const parsed = Req.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return zodErr(parsed.error);
  const { tenantId, source } = await resolveTenant(req);
  if (source !== "session") {
    return Response.json({ ok: false, error: "unauthenticated", hint: "sign in via Google OAuth first" }, { status: 401 });
  }
  try {
    const messages = await gmailList(tenantId, parsed.data.q, parsed.data.limit);
    return Response.json({ ok: true, count: messages.length, messages });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 503 });
  }
}
