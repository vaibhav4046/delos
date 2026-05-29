// Returns the signed-in user state. Email + tenantId are PII and only
// disclosed when the caller adds `?profile=full` AND has a valid session
// cookie that matches the same origin. Default response is minimal:
// `{ ok, signedIn }` so an anonymous probe never leaks identity.
// 2026-05-25 brutal-QA P0-02 · `/api/me` was echoing email to any caller.

import { getServerSession } from "@/lib/session";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return Response.json({ ok: true, signedIn: false });
  }
  // Default shape · no PII. Caller must explicitly request profile.
  const url = new URL(req.url);
  const wantsProfile = url.searchParams.get("profile") === "full";
  if (!wantsProfile) {
    return Response.json({ ok: true, signedIn: true });
  }
  // Same-origin gate · only echo PII when the request actually originated
  // from our own UI (Referer or Origin header matches host). Stops a
  // direct curl probe from pulling email even with the cookie.
  const host = req.headers.get("host") || "";
  const originHeader = req.headers.get("origin") || req.headers.get("referer") || "";
  // Exact host match · parse the Origin/Referer as a URL and compare its host
  // to ours. The old substring check (`origin.includes(host)`) was bypassable
  // with a domain that merely CONTAINS our host (e.g. http://evil-localhost.com
  // includes "localhost"). Exact equality also covers real dev, where host ===
  // the Origin host (localhost:3210).
  let sameOrigin = false;
  if (originHeader && host) {
    try {
      sameOrigin = new URL(originHeader).host === host;
    } catch {
      sameOrigin = false;
    }
  }
  if (!sameOrigin) {
    return Response.json({ ok: true, signedIn: true });
  }
  return Response.json({
    ok: true,
    signedIn: true,
    email: session.email,
    tenantId: session.tenantId,
    expiresAt: session.exp * 1000,
  });
}
