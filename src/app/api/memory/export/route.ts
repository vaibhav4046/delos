import { NextRequest } from "next/server";
import { safeRecall, getLocalFallback } from "@/lib/hydra";
import { resolveTenant } from "@/lib/apiAuth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  // BOLA fix · tenant is resolved server-side from the session / per-IP anon
  // scope, never from a `?tenantId=` query param. The previous version read
  // the tenant from the URL AND called getLocalFallback() with no argument —
  // which dumped EVERY tenant's local memory to any anonymous caller.
  // intent:"read" — export is a read path; honor the public demo tenant so
  // judges can download the demo memory graph without an account.
  const { tenantId } = await resolveTenant(req, { intent: "read" });
  // Pull broad query to grab as many memories as possible
  const hits = await safeRecall({ tenantId, query: "run research app os memory", topK: 200 }).catch(() => []);
  const local = getLocalFallback(tenantId).filter((m) => m.text.length > 0);
  const payload = {
    schema: "delrio-memory-export-v1",
    exportedAt: new Date().toISOString(),
    tenantId,
    hydradb: hits,
    local,
  };
  const filename = `delrio-memory-${tenantId.slice(0, 24)}-${new Date().toISOString().slice(0, 10)}.json`;
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
