// Transactional email sender. Gmail SMTP first (works for ANY recipient,
// no domain needed), Resend second, Postmark fallback.
// Used by magic-link sign-in. Keep this lean — no marketing email helpers
// in here, just one-shot transactional sends with structured error reporting
// so the caller can decide whether to surface a failure to the user.
//
// Env:
//   GMAIL_USER          — your gmail address (e.g. you@gmail.com)
//   GMAIL_APP_PASSWORD  — 16-char Google App Password generated at
//                         https://myaccount.google.com/apppasswords
//                         500 emails/day free, sends to ANY recipient.
//   GMAIL_FROM          — display name, defaults to "DelOS <$GMAIL_USER>".
//   RESEND_API_KEY      — fallback. Sign up at https://resend.com (3K/mo free).
//   RESEND_FROM         — e.g. "DelOS <noreply@yourdomain.com>". Defaults to
//                         "DelOS <onboarding@resend.dev>" — only delivers to
//                         your verified Resend account email until you verify
//                         a real domain.
//   POSTMARK_API_TOKEN  — last fallback. Sign up at https://postmarkapp.com.
//   POSTMARK_FROM       — e.g. "noreply@yourdomain.com" (must be Postmark-verified).
//
// If no provider is configured, send() returns { ok: false, reason: "no_provider" }
// and the caller falls back to the dev-link surface (devLink in response body).

export type MailSendResult =
  | { ok: true; provider: "gmail" | "resend" | "postmark"; id?: string }
  | { ok: false; reason: string };

export type MailSendArgs = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  // Optional reply-to override; defaults to from address.
  replyTo?: string;
};

export async function sendMail(args: MailSendArgs): Promise<MailSendResult> {
  // Provider order: Gmail SMTP first (delivers to ANY recipient with no domain
  // setup), then Resend (cleaner brand but limited to verified-email or
  // verified-domain recipients), then Postmark.
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  if (gmailUser && gmailPass) {
    const result = await sendViaGmail(gmailUser, gmailPass, args);
    // If Gmail succeeds we're done. If it fails, log + try next provider so
    // a misconfigured Gmail doesn't silently block all outbound mail.
    if (result.ok) return result;
    console.warn(`[mail] gmail send failed (${result.reason}); falling through`);
  }
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    return sendViaResend(resendKey, args);
  }
  const postmarkToken = process.env.POSTMARK_API_TOKEN;
  if (postmarkToken) {
    return sendViaPostmark(postmarkToken, args);
  }
  return { ok: false, reason: "no_provider" };
}

async function sendViaGmail(user: string, pass: string, args: MailSendArgs): Promise<MailSendResult> {
  // Lazy-import nodemailer so the Edge runtime / cold-start cost only hits
  // requests that actually need SMTP. Nodemailer ships CommonJS so we use
  // `await import(...)`.
  try {
    const nm = await import("nodemailer");
    const from = process.env.GMAIL_FROM || `DelOS <${user}>`;
    // App-password auth over Gmail's submission relay. Port 465 = implicit TLS.
    // Slightly more compatible across hosts than 587 STARTTLS.
    const transporter = nm.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user, pass },
    });
    const info = await transporter.sendMail({
      from,
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
      ...(args.replyTo ? { replyTo: args.replyTo } : {}),
    });
    return { ok: true, provider: "gmail", id: info.messageId };
  } catch (e) {
    const msg = (e as Error).message || String(e);
    // Gmail returns "Username and Password not accepted" when the app password
    // is wrong or 2FA isn't enabled. Surface that cleanly so config errors
    // don't look like outages.
    if (/Username and Password not accepted/i.test(msg)) {
      return { ok: false, reason: `gmail_auth: app password rejected (regenerate at myaccount.google.com/apppasswords)` };
    }
    return { ok: false, reason: `gmail_err:${msg.slice(0, 200)}` };
  }
}

async function sendViaResend(apiKey: string, args: MailSendArgs): Promise<MailSendResult> {
  // Resend's "onboarding@resend.dev" works without domain verification but only
  // for sending TO the email that owns the Resend account. For production, set
  // RESEND_FROM to "Name <noreply@yourverifieddomain.com>".
  const from = process.env.RESEND_FROM || "DelOS <onboarding@resend.dev>";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [args.to],
        subject: args.subject,
        text: args.text,
        html: args.html,
        ...(args.replyTo ? { reply_to: args.replyTo } : {}),
      }),
    });
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 300);
      return { ok: false, reason: `resend_${r.status}:${detail}` };
    }
    const j = (await r.json()) as { id?: string };
    return { ok: true, provider: "resend", id: j.id };
  } catch (e) {
    return { ok: false, reason: `resend_err:${(e as Error).message.slice(0, 120)}` };
  }
}

async function sendViaPostmark(token: string, args: MailSendArgs): Promise<MailSendResult> {
  const from = process.env.POSTMARK_FROM || "noreply@example.com";
  try {
    const r = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "X-Postmark-Server-Token": token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        From: from,
        To: args.to,
        Subject: args.subject,
        TextBody: args.text,
        ...(args.html ? { HtmlBody: args.html } : {}),
        ...(args.replyTo ? { ReplyTo: args.replyTo } : {}),
        MessageStream: "outbound",
      }),
    });
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 300);
      return { ok: false, reason: `postmark_${r.status}:${detail}` };
    }
    const j = (await r.json()) as { MessageID?: string };
    return { ok: true, provider: "postmark", id: j.MessageID };
  } catch (e) {
    return { ok: false, reason: `postmark_err:${(e as Error).message.slice(0, 120)}` };
  }
}

// Render a brand-aligned magic-link email. Plain-text + HTML versions.
export function renderMagicLinkEmail(args: {
  link: string;
  email: string;
  expiresAt: number;
}): { subject: string; text: string; html: string } {
  const expiresMin = Math.max(1, Math.round((args.expiresAt - Date.now()) / 60_000));
  const subject = "Your DelOS sign-in link";
  const text = [
    "DelOS sign-in link",
    "",
    `Hi — someone (probably you) just requested a sign-in link for ${args.email}.`,
    "",
    "Open this link to sign in:",
    args.link,
    "",
    `This link expires in ${expiresMin} minutes and works once.`,
    "",
    "If you didn't request this, you can ignore this email — no one can sign in",
    "without clicking the link.",
    "",
    "— DelOS",
    "https://delrio.vercel.app",
  ].join("\n");

  const html = `<!doctype html>
<html><body style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;background:#0e1014;color:#e6e8ea;padding:24px;">
  <div style="max-width:520px;margin:0 auto;background:#15171c;border:1px solid #2a2e36;padding:32px;">
    <div style="font-size:11px;letter-spacing:2px;color:#f0c63a;margin-bottom:8px;">★ DELOS SIGN-IN</div>
    <h1 style="font-size:24px;color:#e6e8ea;margin:0 0 16px 0;font-weight:600;letter-spacing:1px;">Your sign-in link</h1>
    <p style="color:#a0a4ab;font-size:14px;line-height:1.6;margin:0 0 24px 0;">
      Someone (probably you) requested a sign-in link for
      <strong style="color:#e6e8ea;">${escapeHtml(args.email)}</strong>.
    </p>
    <a href="${escapeAttr(args.link)}" style="display:inline-block;background:#6ab04c;color:#0e1014;font-weight:700;text-decoration:none;padding:14px 22px;font-size:14px;letter-spacing:1.2px;border:2px solid #6ab04c;">
      ▶ SIGN IN TO DELOS
    </a>
    <p style="color:#a0a4ab;font-size:12px;line-height:1.6;margin:24px 0 0 0;">
      Or paste this URL in your browser:<br>
      <code style="color:#f0c63a;word-break:break-all;font-size:11px;">${escapeHtml(args.link)}</code>
    </p>
    <p style="color:#6c727a;font-size:11px;line-height:1.6;margin:24px 0 0 0;border-top:1px solid #2a2e36;padding-top:16px;">
      This link expires in <strong style="color:#a0a4ab;">${expiresMin} minutes</strong> and works once.
      Didn't request this? Ignore this email — no one can sign in without clicking the link.
    </p>
    <p style="color:#6c727a;font-size:10px;letter-spacing:1px;margin:16px 0 0 0;">
      — DELOS · <a href="https://delrio.vercel.app" style="color:#6c727a;">delrio.vercel.app</a>
    </p>
  </div>
</body></html>`;

  return { subject, text, html };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;");
}
