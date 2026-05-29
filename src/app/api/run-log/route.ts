import { NextRequest } from "next/server";
import { getRun, listRuns } from "@/lib/runLog";
import { resolveTenant, isShareableRunTenant } from "@/lib/apiAuth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  // M2 · resolve the caller server-side (session → reserved test scope →
  // per-IP anon). NEVER trust a client-supplied tenantId here.
  const { tenantId: caller } = await resolveTenant(req, { intent: "read" });

  // F14 · accept both `runId` (canonical) and `id` (regression script convention)
  const runId = req.nextUrl.searchParams.get("runId") ?? req.nextUrl.searchParams.get("id");
  if (runId) {
    const rec = getRun(runId);
    // Identical 404 for "unknown id" and "exists but not yours" so this can't
    // be used to probe which runIds exist across tenants. Shareable demo/seed/
    // judge runs stay readable (public permalink — the demo story).
    if (!rec || (rec.tenantId !== caller && !isShareableRunTenant(rec.tenantId))) {
      return Response.json({ ok: false, error: "not_found", id: runId }, { status: 404 });
    }
    return Response.json({ ok: true, run: rec, log: rec });
  }
  // List recent — ONLY the caller's own runs (+ shareable demo runs). This
  // closes the unauthenticated cross-tenant enumeration that leaked every
  // tenant's goals + answers. (No in-app caller passes a foreign tenant; the
  // public activity feed is /api/live, which masks tenant + shows goals only.)
  const limit = Math.max(1, Math.min(200, Number(req.nextUrl.searchParams.get("limit") ?? "50")));
  const runs = listRuns(200)
    .filter((r) => r.tenantId === caller || isShareableRunTenant(r.tenantId))
    .slice(0, limit)
    .map((r) => ({
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
