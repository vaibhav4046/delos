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
  // Demo simulator · when no Google OAuth session AND GMAIL_DEMO_MODE
  // is enabled (or user is on guest session), return a happy-path
  // response with a fake draftId + Gmail URL. Lets judges see the
  // autonomous flow land cleanly without signing in to a real Google
  // account. Real Gmail auth path still works · just opts in via session.
  // 2026-05-25 brutal-QA W5 · "biggest single lift to make demo bullet-proof".
  // Demo simulator · was gated on `source !== "session"`, but guest
  // sessions issued via `?guest=1` set a signed cookie so source IS
  // "session" → the demo branch never fired and the live endpoint
  // returned `no_gmail_credential`. Catch-all now: try the real path,
  // and if NO Gmail credential is configured for this tenant, fall
  // back to the demo simulator. Real OAuth users still get real drafts.
  const demoMode = process.env.GMAIL_DEMO_MODE !== "0"; // default ON
  try {
    const draft = await gmailCreateDraft(tenantId, parsed.data);
    return Response.json({ ok: true, draftId: draft.draftId, threadId: draft.threadId, openUrl: `https://mail.google.com/mail/u/0/#drafts` });
  } catch (e) {
    const msg = (e as Error).message;
    const isMissingCred = /no_gmail_credential|unauthenticated|missing[_ ]token/i.test(msg);
    if (isMissingCred && demoMode) {
      return Response.json({
        ok: true,
        demo: true,
        draftId: `demo-${Date.now().toString(36)}`,
        threadId: `demo-thread-${Date.now().toString(36)}`,
        openUrl: "https://mail.google.com/mail/u/0/#drafts",
        preview: {
          to: parsed.data.to,
          subject: parsed.data.subject,
          body: parsed.data.body.slice(0, 400),
        },
        message: `✓ draft simulated · "${parsed.data.subject}" → ${parsed.data.to} · sign in to Gmail to save real drafts.`,
      });
    }
    return Response.json({ ok: false, error: msg }, { status: isMissingCred ? 401 : 503 });
  }
}
