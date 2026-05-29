import { NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";

// Magic-link route for hackathon judges.
// Tokens defined via DELRIO_JUDGE_TOKENS env var as comma-separated values.
// M4 · NO hardcoded fallback in production. The old in-source defaults
// ("hydra2026,…") were public, short, and non-rotating, so anyone reading the
// repo could mint a full /os guest session. In prod, an unset/blank env means
// there are NO valid judge tokens (every request 403s) until a real, random
// (≥32-char) secret is configured. Dev keeps a throwaway token for local demos.
function getValidTokens(): Set<string> {
  const raw = (process.env.DELRIO_JUDGE_TOKENS ?? "").trim();
  if (!raw) {
    if (process.env.NODE_ENV === "production") return new Set();
    return new Set(["dev-judge-token"]);
  }
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  // M4 · per-IP throttle. Judge tokens are bearer secrets; rate-limiting makes
  // brute-forcing the token space against this endpoint uneconomic.
  const rl = rateLimit(`judges:ip:${clientIp(req)}`, 10, 60_000);
  if (!rl.ok) {
    return new Response("Too many requests", { status: 429, headers: rl.headers });
  }
  const token = url.searchParams.get("token") ?? "";
  const tokens = getValidTokens();
  if (!token || !tokens.has(token)) {
    return new Response(
      `<!doctype html><html><head><title>DelOS · Judges</title><meta name="viewport" content="width=device-width,initial-scale=1"/><style>body{font-family:system-ui;background:#0f0f1b;color:#f4f1de;padding:40px;max-width:560px;margin:0 auto}h1{color:#fbc531}code{background:#1b1b2e;padding:2px 6px}</style></head><body><h1>★ Judges-only</h1><p>This is the DelOS hackathon judges' magic-link entry. Provide a valid token in the <code>?token=…</code> query string.</p><p><a href="/" style="color:#fbc531">← back to /</a></p></body></html>`,
      { status: 403, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  const res = NextResponse.redirect(new URL("/os?tour=1&judge=1", url));
  // The `/os` middleware gate only honors `delos_session` / `delos_guest`.
  // Without this the judge magic-link would bounce straight to /auth/signin,
  // breaking the entire judges' entry path. Grant the same trust tier as the
  // existing anonymous guest bypass so the redirect actually lands on /os.
  res.cookies.set("delos_guest", "1", {
    path: "/",
    sameSite: "lax",
    secure: true,
    httpOnly: false,
    maxAge: 86400,
  });
  // 24h judge session
  res.cookies.set("delrio_role", "judge", {
    httpOnly: false,
    sameSite: "lax",
    maxAge: 86400,
    path: "/",
  });
  res.cookies.set("delrio_tenant", `judge_${token.slice(0, 12)}`, {
    httpOnly: false,
    sameSite: "lax",
    maxAge: 86400,
    path: "/",
  });
  res.cookies.set("delrio_tour", "1", {
    httpOnly: false,
    sameSite: "lax",
    maxAge: 86400,
    path: "/",
  });
  return res;
}
