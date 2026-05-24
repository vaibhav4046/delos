// Returns the signed-in user (or null) plus their per-user tenantId.
// Client uses this on /os boot to auto-set tenantId in localStorage so HydraDB scoping just works.

import { getServerSession } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  const session = await getServerSession();
  if (!session) {
    return Response.json({ ok: true, signedIn: false });
  }
  return Response.json({
    ok: true,
    signedIn: true,
    email: session.email,
    tenantId: session.tenantId,
    expiresAt: session.exp * 1000,
  });
}
