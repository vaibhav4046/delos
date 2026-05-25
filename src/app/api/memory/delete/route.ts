// M4 · scoped memory delete. Removes one entry by id from the local fallback
// (HydraDB delete API is not yet exposed by the SDK, so we operate on the
// fallback layer that mirrors writes). Tenant scope enforced so cross-tenant
// deletes return 404 even if the id is correct.
import { NextRequest } from "next/server";
import { z } from "zod";
import { deleteLocalMemory, clearLocalMemories } from "@/lib/hydra";
import { zodErr, resolveTenant } from "@/lib/apiAuth";

export const runtime = "nodejs";

const Req = z.object({
  id: z.string().min(1).max(120).optional(),
  all: z.boolean().optional(),
  tenantId: z.string().min(1).max(120).optional(),
});

export async function POST(req: NextRequest) {
  const rawBody = await req.json().catch(() => ({}));
  const parsed = Req.safeParse(rawBody);
  if (!parsed.success) return zodErr(parsed.error);
  const { id, all } = parsed.data;
  if (!id && !all) {
    return Response.json({ error: "id or all=true required" }, { status: 400 });
  }
  let bodyTenantId: string | undefined;
  if (rawBody && typeof rawBody === "object" && typeof (rawBody as Record<string, unknown>).tenantId === "string") {
    bodyTenantId = (rawBody as Record<string, unknown>).tenantId as string;
  }
  const { tenantId } = await resolveTenant(req, { bodyTenantId });
  if (all) {
    const removed = clearLocalMemories(tenantId);
    return Response.json({ ok: true, removed, tenantId, mode: "all" });
  }
  const removed = deleteLocalMemory({ tenantId, id: id! });
  if (!removed) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  return Response.json({ ok: true, tenantId, id });
}

export async function GET() {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
}
