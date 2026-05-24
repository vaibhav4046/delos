import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Magic-link route for hackathon judges.
// Tokens defined via DELRIO_JUDGE_TOKENS env var as comma-separated values.
// Fallback: "hydra2026" (rotate after demo).

function getValidTokens(): Set<string> {
  const raw = process.env.DELRIO_JUDGE_TOKENS ?? "hydra2026,judge-demo,delrio-finalist";
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const tokens = getValidTokens();
  if (!token || !tokens.has(token)) {
    return new Response(
      `<!doctype html><html><head><title>DelOS · Judges</title><meta name="viewport" content="width=device-width,initial-scale=1"/><style>body{font-family:system-ui;background:#0f0f1b;color:#f4f1de;padding:40px;max-width:560px;margin:0 auto}h1{color:#fbc531}code{background:#1b1b2e;padding:2px 6px}</style></head><body><h1>★ Judges-only</h1><p>This is the DelOS hackathon judges' magic-link entry. Provide a valid token in the <code>?token=…</code> query string.</p><p><a href="/" style="color:#fbc531">← back to /</a></p></body></html>`,
      { status: 403, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  const res = NextResponse.redirect(new URL("/os?tour=1&judge=1", url));
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
