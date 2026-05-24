// Create a Gmail DRAFT (never sends). Voice agent's safe default.
// User opens Gmail to review + send manually.
import { NextRequest } from "next/server";
import { z } from "zod";
import { resolveTenant, zodErr } from "@/lib/apiAuth";
import { gmailCreateDraft } from "@/lib/connectors/gmail";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";

const Req = z.object({
  to: z.string().email().max(200),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(20_000),
  cc: z.string().email().optional(),
});

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const lim = rateLimit(`gmail-draft:ip:${ip}`, 10, 60_000);
  if (!lim.ok) return Response.json({ ok: false, error: "rate limited" }, { status: 429, headers: lim.headers });
  const parsed = Req.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return zodErr(parsed.error);
  const { tenantId, source } = await resolveTenant(req);
  if (source !== "session") {
    return Response.json({ ok: false, error: "unauthenticated", hint: "sign in via Google OAuth first" }, { status: 401 });
  }
  try {
    const draft = await gmailCreateDraft(tenantId, parsed.data);
    return Response.json({ ok: true, draftId: draft.draftId, threadId: draft.threadId, openUrl: `https://mail.google.com/mail/u/0/#drafts` });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 503 });
  }
}
