// Route guard. Protects /os behind sign-in (or anonymous `delos_guest` cookie).
// Public users hitting /os without either get redirected to /auth/signin with a `next` param.
// Magic-link verify + OAuth callbacks set delos_session — those flow through unchanged.

import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const url = new URL(req.url);
  if (!url.pathname.startsWith("/os")) return NextResponse.next();

  const hasSession = !!req.cookies.get("delos_session")?.value;
  const hasGuest = !!req.cookies.get("delos_guest")?.value;
  // `?guest=1` opts you into guest mode (sets cookie below) so the welcome flow can offer a guest path.
  const wantsGuest = url.searchParams.get("guest") === "1";

  if (hasSession || hasGuest) return NextResponse.next();

  if (wantsGuest) {
    const res = NextResponse.next();
    res.cookies.set("delos_guest", "1", {
      path: "/",
      sameSite: "lax",
      secure: true,
      httpOnly: false, // readable by client for UX hints
      maxAge: 7 * 24 * 3600,
    });
    return res;
  }

  const signIn = new URL("/auth/signin", url.origin);
  signIn.searchParams.set("next", url.pathname);
  return NextResponse.redirect(signIn);
}

export const config = {
  matcher: ["/os", "/os/:path*"],
};
