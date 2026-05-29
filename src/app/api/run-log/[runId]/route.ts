import { NextRequest } from "next/server";
import { getRunAsync } from "@/lib/runLog";
import { resolveTenant, isShareableRunTenant } from "@/lib/apiAuth";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  // M2 · resolve tenant server-side; IGNORE any client-supplied ?tenantId=.
  // Pass the CALLER's own tenant into the durable recall so the HydraDB path
  // can't be steered to read another tenant's snapshot.
  const { tenantId: caller } = await resolveTenant(req, { intent: "read" });
  const rec = await getRunAsync(runId, caller);
  // 404 unless the caller owns it OR it's a shareable demo/seed/judge run.
  if (!rec || (rec.tenantId !== caller && !isShareableRunTenant(rec.tenantId))) {
    return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  return Response.json({ ok: true, runId, events: rec.events, run: rec });
}
