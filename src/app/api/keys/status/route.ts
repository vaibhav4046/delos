// BYOK · return key-bag status for the caller's tenant. Never returns the
// plaintext key — only { hasKey, lastVerified, roles } per provider.

import { NextRequest } from "next/server";
import { resolveTenant } from "@/lib/apiAuth";
import { statusForTenant } from "@/lib/keyBag";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  // intent:"read" — key-bag status is a read; the public demo tenant may
  // be queried so the UI can show which providers the demo has configured.
  const { tenantId, source } = await resolveTenant(req, { intent: "read" });
  const status = await statusForTenant(tenantId);
  return Response.json({ ok: true, tenantId, scope: source, providers: status });
}
