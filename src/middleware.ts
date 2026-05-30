// Route guard + security headers. Protects /os behind sign-in (or anonymous
// `delos_guest` cookie) and stamps OWASP-recommended security headers on
// every response: HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-
// Policy, Permissions-Policy, Cross-Origin headers. CSP is enforced on
// non-API routes only (Vercel SSE + Groq/Mistral/Gemini/Notion fetches
// would otherwise be blocked). 2026-05-25 brutal-QA finding · security
// audit flagged missing headers.

import { NextRequest, NextResponse } from "next/server";

function applySecurityHeaders(res: NextResponse, pathname: string): NextResponse {
  res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  // The codegen live-preview is framed by the DelCode IDE on the same origin —
  // DENY would block our own iframe. Allow SAMEORIGIN for that one route; every
  // other surface stays DENY (clickjacking protection). The route ships its own
  // permissive CSP with `frame-ancestors 'self'` to bound who can embed it.
  res.headers.set("X-Frame-Options", pathname === "/api/codegen-app/preview" ? "SAMEORIGIN" : "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(self), payment=()");
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  // API + image generation responses skip CSP because the LLM provider
  // fetches and SSE streams need full network reach.
  if (!pathname.startsWith("/api") && !pathname.includes("opengraph-image") && !pathname.includes("twitter-image")) {
    // `unsafe-eval` is only needed by Turbopack's dev HMR runtime. A production
    // Next 16 build never evals app code, so we drop it in prod to shrink the
    // XSS blast radius (an injected <script> can't `eval`/`new Function` a
    // payload). Dev keeps it so hot-reload works.
    const isDev = process.env.NODE_ENV !== "production";
    const scriptSrc = isDev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com"
      : "script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com";
    res.headers.set(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        // Inline style needed for dynamic theme colors + tailwind v4 runtime
        "style-src 'self' 'unsafe-inline'",
        // Next 16 + React 19 still emit inline script for hydration map
        scriptSrc,
        "img-src 'self' data: blob: https:",
        "font-src 'self' data: https://fonts.gstatic.com",
        // SSE streams + provider fetches go through /api · so leave network connect open
        "connect-src 'self' https: wss:",
        "media-src 'self' blob: https:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "frame-src 'self' https://www.youtube.com https://player.vimeo.com",
      ].join("; "),
    );
  }
  return res;
}

export function middleware(req: NextRequest) {
  const url = new URL(req.url);
  // For routes outside /os just stamp security headers and pass through.
  if (!url.pathname.startsWith("/os")) {
    return applySecurityHeaders(NextResponse.next(), url.pathname);
  }

  const hasSession = !!req.cookies.get("delos_session")?.value;
  const hasGuest = !!req.cookies.get("delos_guest")?.value;
  // `?guest=1` opts you into guest mode (sets cookie below) so the welcome flow can offer a guest path.
  const wantsGuest = url.searchParams.get("guest") === "1";

  if (hasSession || hasGuest) return applySecurityHeaders(NextResponse.next(), url.pathname);

  if (wantsGuest) {
    const res = NextResponse.next();
    res.cookies.set("delos_guest", "1", {
      path: "/",
      sameSite: "lax",
      secure: true,
      httpOnly: false, // readable by client for UX hints
      maxAge: 7 * 24 * 3600,
    });
    return applySecurityHeaders(res, url.pathname);
  }

  const signIn = new URL("/auth/signin", url.origin);
  signIn.searchParams.set("next", url.pathname);
  return applySecurityHeaders(NextResponse.redirect(signIn), url.pathname);
}

export const config = {
  // Cover everything so security headers stamp on every response. The
  // `/os` auth gate inside the function still only checks paths that
  // start with `/os`.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
