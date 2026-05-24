import { getRunAsync } from "@/lib/runLog";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const tenantId = new URL(req.url).searchParams.get("tenantId") ?? undefined;
  const rec = await getRunAsync(runId, tenantId);
  if (!rec) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  return Response.json({ ok: true, runId, events: rec.events, run: rec });
}
