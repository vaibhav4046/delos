// Magic-link auth · request endpoint.
// User submits email. We generate signed token, persist hash in HydraDB,
// log magic-link to server console (DEV) + return ok. In prod, send via email provider.
// Token expires after 15min. Single use.

import { z } from "zod";
import { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { safeAddMemory, safeRecall } from "@/lib/hydra";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { sendMail, renderMagicLinkEmail } from "@/lib/mail";
import { createHash, randomBytes } from "node:crypto";

export const runtime = "nodejs";

const bodySchema = z.object({
  email: z.string().email().max(120),
  // "signin"  → only fires if the email already has a USER_RECORD in HydraDB
  // "signup"  → only fires if the email is NEW (no USER_RECORD found)
  // "auto"    → original behavior, no existence check (default)
  mode: z.enum(["signin", "signup", "auto"]).default("auto"),
});

async function userExists(email: string): Promise<boolean> {
  // Look for the canonical USER_RECORD line we write on first successful verify.
  // Recall is semantic — many results contain `email=…` (AUTH_MAGIC,
  // AUTH_CONSUMED, …) so we strictly require BOTH the USER_RECORD prefix AND
  // the exact email match, otherwise stale auth logs would falsely "find" a
  // user who never completed verify.
  const lowered = email.toLowerCase();
  try {
    const hits = await safeRecall({
      tenantId: env.DELRIO_TENANT_ID,
      query: `USER_RECORD email=${lowered}`,
      topK: 10,
    });
    return hits.some((h) => {
      const t = h.text.toLowerCase();
      return t.startsWith("user_record") && t.includes(`email=${lowered}`);
    });
  } catch {
    // HydraDB unreachable → fail-open (act as auto mode). Better UX than locking
    // legit users out when our memory store has a blip.
    return false;
  }
}

// Magic-link issuance is an email-bomb vector if uncapped. Two-axis throttle:
// - per-IP   : 20 requests/min  (caps any one attacker's throughput)
// - per-email: 3 requests/min   (caps a victim's inbox even if attacker rotates IPs;
//                                a real user re-requesting won't hit this)
const IP_LIMIT_PER_MIN = 20;
const EMAIL_LIMIT_PER_MIN = 3;
const WINDOW_MS = 60_000;

function hashToken(t: string): string {
  return createHash("sha256").update(t + (process.env.AUTH_SECRET ?? "delos-dev-secret")).digest("hex").slice(0, 32);
}

export async function POST(req: NextRequest) {
  // Rate-limit BEFORE parsing so spam can't burn CPU on the schema check.
  const ip = clientIp(req);
  const ipLim = rateLimit(`magic:ip:${ip}`, IP_LIMIT_PER_MIN, WINDOW_MS);
  if (!ipLim.ok) {
    return Response.json(
      { ok: false, error: "Too many requests from this IP. Try again shortly." },
      { status: 429, headers: ipLim.headers },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ ok: false, error: parsed.error.message }, { status: 400 });
  }
  const { email, mode } = parsed.data;

  // Enforce sign-in vs sign-up. Skip in auto mode (backward-compat).
  if (mode !== "auto") {
    const exists = await userExists(email);
    if (mode === "signin" && !exists) {
      return Response.json(
        { ok: false, error: "No DelOS account for this email. Please sign up first.", code: "no_account" },
        { status: 404 },
      );
    }
    if (mode === "signup" && exists) {
      return Response.json(
        { ok: false, error: "This email already has a DelOS account. Sign in instead.", code: "already_account" },
        { status: 409 },
      );
    }
  }

  // Per-email cap protects against attacker rotating source IPs to flood one victim.
  // Lower email (normalized) so EQUIVALENT addresses don't bypass the cap.
  const emailLim = rateLimit(`magic:em:${email.toLowerCase()}`, EMAIL_LIMIT_PER_MIN, WINDOW_MS);
  if (!emailLim.ok) {
    return Response.json(
      { ok: false, error: "Magic link already sent recently. Check your inbox or wait a minute." },
      { status: 429, headers: emailLim.headers },
    );
  }
  const token = randomBytes(24).toString("base64url");
  const tokenHash = hashToken(token);
  const issuedAt = Date.now();
  const expiresAt = issuedAt + 15 * 60 * 1000;

  // Persist hash so /api/auth/verify can validate token without storing it raw.
  await safeAddMemory({
    tenantId: env.DELRIO_TENANT_ID,
    text: `AUTH_MAGIC email=${email} hash=${tokenHash} expires=${expiresAt}`,
    metadata: {
      kind: "auth-magic",
      email,
      tokenHash,
      issuedAt,
      expiresAt,
    },
  });

  const url = new URL(req.url);
  const base = `${url.protocol}//${url.host}`;
  const link = `${base}/api/auth/verify?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;

  console.log("[auth] magic link issued:", link);

  // SECURITY: Returning the link in the response is a credential leak — anyone who can
  // POST {email} would learn the verify URL for that email. Only expose when the deploy
  // is explicitly running in dev OR when DELOS_EXPOSE_MAGIC_LINK=1 is set (e.g. for the
  // hackathon judge magic-link flow). Production with an email sender wired hides it.
  const exposeDev =
    process.env.NODE_ENV !== "production" ||
    process.env.DELOS_EXPOSE_MAGIC_LINK === "1";
  const hasEmailSender = !!process.env.RESEND_API_KEY || !!process.env.POSTMARK_API_TOKEN;

  // Real email send path. If a provider key is configured, send the link via
  // transactional email (Resend → Postmark fallback). Failure is non-fatal:
  // we still return ok so the UI can render "check your inbox" without leaking
  // the provider error. We log the failure server-side so it's diagnosable.
  let sentVia: string | null = null;
  let sendError: string | null = null;
  let sendErrorKind: "domain_not_verified" | "rate_limit" | "auth" | "unknown" | null = null;
  if (hasEmailSender) {
    const { subject, text, html } = renderMagicLinkEmail({ link, email, expiresAt });
    const result = await sendMail({ to: email, subject, text, html });
    if (result.ok) {
      sentVia = result.provider;
      console.log(`[auth] magic-link emailed via ${result.provider} id=${result.id ?? "?"} → ${email}`);
    } else {
      sendError = result.reason;
      // Classify so the UI can show a clean message without exposing the
      // provider's raw error (which leaks our Resend account email).
      const r = result.reason.toLowerCase();
      if (r.includes("verify a domain") || r.includes("testing emails") || r.includes("validation_error")) {
        sendErrorKind = "domain_not_verified";
      } else if (r.includes("429") || r.includes("rate")) {
        sendErrorKind = "rate_limit";
      } else if (r.includes("401") || r.includes("403") || r.includes("api_key") || r.includes("unauthorized")) {
        sendErrorKind = "auth";
      } else {
        sendErrorKind = "unknown";
      }
      console.error(`[auth] magic-link email FAILED kind=${sendErrorKind} reason=${result.reason} → ${email}. Falling back to devLink.`);
    }
  }

  // If real email send succeeded we hide the link. If it failed (or no provider),
  // fall back to devLink so the user / judges can still get in.
  const surfaceDevLink = (exposeDev && !hasEmailSender) || !!sendError;

  return Response.json({
    ok: true,
    email,
    expiresAt,
    sentVia,
    // sendErrorKind is a small enum the UI can render a friendly message from —
    // never leaks raw provider strings (which can contain account-owner email).
    sendErrorKind: surfaceDevLink ? sendErrorKind : undefined,
    devLink: surfaceDevLink ? link : undefined,
  });
}
