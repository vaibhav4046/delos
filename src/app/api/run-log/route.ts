import { NextRequest } from "next/server";
import { getRun, listRuns } from "@/lib/runLog";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const runId = req.nextUrl.searchParams.get("runId");
  if (runId) {
    const rec = getRun(runId);
    if (!rec) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    return Response.json({ ok: true, run: rec });
  }
  // List recent
  const limit = Math.max(1, Math.min(200, Number(req.nextUrl.searchParams.get("limit") ?? "50")));
  const runs = listRuns(limit).map((r) => ({
    runId: r.runId,
    tenantId: r.tenantId.slice(0, 6) + "…",
    goal: r.goal.slice(0, 80),
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    drift: r.drift,
    replans: r.replans,
    success: r.success,
    eventCount: r.events.length,
    answer: r.answer ? r.answer.slice(0, 200) : undefined,
  }));
  return Response.json({ ok: true, runs });
}
