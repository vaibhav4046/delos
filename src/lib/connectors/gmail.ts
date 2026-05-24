// Gmail action helpers — call Google's REST API on behalf of a DelOS tenant.
//
// Flow:
//   1. Look up the encrypted refresh_token persisted at OAuth callback in
//      HydraDB (tag "connector-credential", connector="gmail").
//   2. Decrypt with src/lib/secrets.ts (AES-256-GCM keyed off DELRIO_SECRET).
//   3. Exchange for a short-lived access_token via Google OAuth2 token endpoint.
//   4. Hit gmail.googleapis.com with that access_token.
//
// Surface kept small + read-write-with-approval — list, draft, send. Send
// is gated through ApprovalGate at the API route level so voice agent
// can compose without auto-sending.

import { safeRecall } from "@/lib/hydra";
import { decryptSecret } from "@/lib/secrets";

type CredRecord = { tokenCipher?: string; email?: string; scope?: string };

export async function getRefreshToken(tenantId: string): Promise<{ refresh: string; email?: string; scope?: string } | null> {
  const hits = await safeRecall({ tenantId, query: "GMAIL_CREDENTIAL connector gmail", topK: 8 });
  for (const h of hits as Array<{ metadata?: CredRecord; text?: string }>) {
    const meta = h.metadata;
    if (!meta?.tokenCipher) continue;
    try {
      const refresh = decryptSecret(meta.tokenCipher);
      if (!refresh) continue;
      return { refresh, email: meta.email, scope: meta.scope };
    } catch {}
  }
  return null;
}

async function exchangeRefreshForAccess(refresh: string): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GOOGLE_CLIENT_ID/SECRET not configured");
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refresh,
    grant_type: "refresh_token",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!r.ok) throw new Error(`token exchange failed: ${r.status}`);
  const j = (await r.json()) as { access_token?: string };
  if (!j.access_token) throw new Error("no access_token in exchange response");
  return j.access_token;
}

export async function gmailAccessToken(tenantId: string): Promise<{ token: string; email?: string }> {
  const cred = await getRefreshToken(tenantId);
  if (!cred) throw new Error("no_gmail_credential — open Settings → Connectors → Gmail to authorize");
  const token = await exchangeRefreshForAccess(cred.refresh);
  return { token, email: cred.email };
}

// ── Read ────────────────────────────────────────────────────────────
export async function gmailList(tenantId: string, q = "", limit = 10): Promise<Array<{ id: string; from: string; subject: string; snippet: string; date: string }>> {
  const { token } = await gmailAccessToken(tenantId);
  const search = new URLSearchParams();
  search.set("maxResults", String(Math.min(limit, 25)));
  if (q) search.set("q", q);
  const idsResp = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${search.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!idsResp.ok) throw new Error(`gmail list ${idsResp.status}`);
  const idsJson = (await idsResp.json()) as { messages?: Array<{ id: string }> };
  const ids = (idsJson.messages ?? []).slice(0, limit);
  const out: Array<{ id: string; from: string; subject: string; snippet: string; date: string }> = [];
  for (const m of ids) {
    try {
      const detail = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!detail.ok) continue;
      const dj = (await detail.json()) as { snippet?: string; payload?: { headers?: Array<{ name: string; value: string }> } };
      const hdr = (n: string) => dj.payload?.headers?.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? "";
      out.push({
        id: m.id,
        from: hdr("From"),
        subject: hdr("Subject"),
        snippet: dj.snippet?.slice(0, 200) ?? "",
        date: hdr("Date"),
      });
    } catch {}
  }
  return out;
}

// ── Compose ────────────────────────────────────────────────────────
function buildRawMime({ to, subject, body, cc }: { to: string; subject: string; body: string; cc?: string }): string {
  const lines = [
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    ``,
    body,
  ].filter(Boolean) as string[];
  // RFC 4648 base64url with no padding stripping (Gmail accepts both).
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

export async function gmailCreateDraft(
  tenantId: string,
  args: { to: string; subject: string; body: string; cc?: string },
): Promise<{ draftId: string; messageId: string; threadId?: string }> {
  const { token } = await gmailAccessToken(tenantId);
  const raw = buildRawMime(args);
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { raw } }),
  });
  if (!r.ok) throw new Error(`draft ${r.status} ${(await r.text()).slice(0, 120)}`);
  const j = (await r.json()) as { id?: string; message?: { id?: string; threadId?: string } };
  if (!j.id) throw new Error("draft response missing id");
  return { draftId: j.id, messageId: j.message?.id ?? "", threadId: j.message?.threadId };
}

export async function gmailSend(
  tenantId: string,
  args: { to: string; subject: string; body: string; cc?: string },
): Promise<{ messageId: string; threadId?: string }> {
  const { token } = await gmailAccessToken(tenantId);
  const raw = buildRawMime(args);
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  if (!r.ok) throw new Error(`send ${r.status} ${(await r.text()).slice(0, 120)}`);
  const j = (await r.json()) as { id?: string; threadId?: string };
  if (!j.id) throw new Error("send response missing id");
  return { messageId: j.id, threadId: j.threadId };
}
