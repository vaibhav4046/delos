// BYOK · return key-bag status for the caller's tenant. Never returns the
// plaintext key — only { hasKey, lastVerified, roles } per provider.

import { NextRequest } from "next/server";
import { resolveTenant } from "@/lib/apiAuth";
import { statusForTenant } from "@/lib/keyBag";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { tenantId, source } = await resolveTenant(req);
  const status = await statusForTenant(tenantId);
  return Response.json({ ok: true, tenantId, scope: source, providers: status });
}
