// BYOK · drop the caller's key for a given provider.

import { NextRequest } from "next/server";
import { resolveTenant } from "@/lib/apiAuth";
import { deleteKey, PROVIDERS, type ProviderId } from "@/lib/keyBag";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider: pRaw } = await ctx.params;
  const provider = pRaw as ProviderId;
  if (!PROVIDERS.includes(provider)) {
    return Response.json({ ok: false, reason: "unknown_provider" }, { status: 400 });
  }
  const { tenantId } = await resolveTenant(req);
  deleteKey(tenantId, provider);
  return Response.json({ ok: true, deleted: provider });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  return POST(req, ctx);
}
