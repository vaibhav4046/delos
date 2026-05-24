import { safeRecall, getLocalFallback } from "@/lib/hydra";
import { env } from "@/lib/env";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const tenantId = new URL(req.url).searchParams.get("tenantId") || env.DELRIO_TENANT_ID;
  // Pull broad query to grab as many memories as possible
  const hits = await safeRecall({ tenantId, query: "run research app os memory", topK: 200 }).catch(() => []);
  const local = getLocalFallback().filter((m) => m.text.length > 0);
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
