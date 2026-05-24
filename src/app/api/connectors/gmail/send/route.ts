// Send a Gmail message. Irreversible. Requires approved=true in body so
// the UI ApprovalGate must confirm before dispatch. Voice agent should
// always create-draft first, then ask the user to say "send" to flip
// approved=true on a follow-up call.

import { NextRequest } from "next/server";
import { z } from "zod";
import { resolveTenant, zodErr } from "@/lib/apiAuth";
import { gmailSend } from "@/lib/connectors/gmail";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";

const Req = z.object({
  to: z.string().email().max(200),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(20_000),
  cc: z.string().email().optional(),
  approved: z.literal(true, { message: "approved:true required — confirm via ApprovalGate first" }),
});

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const lim = rateLimit(`gmail-send:ip:${ip}`, 5, 60_000);
  if (!lim.ok) return Response.json({ ok: false, error: "rate limited" }, { status: 429, headers: lim.headers });
  const parsed = Req.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return zodErr(parsed.error);
  const { tenantId, source } = await resolveTenant(req);
  if (source !== "session") {
    return Response.json({ ok: false, error: "unauthenticated", hint: "sign in via Google OAuth first" }, { status: 401 });
  }
  try {
    const sent = await gmailSend(tenantId, parsed.data);
    return Response.json({ ok: true, messageId: sent.messageId, threadId: sent.threadId });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 503 });
  }
}
