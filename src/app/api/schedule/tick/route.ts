// F02 · schedule tick endpoint. Client interval (ScheduleTicker) calls
// this every 45s. Server walks the schedule store, dispatches due actions,
// re-arms recurring ones, returns fired list.
import { NextRequest } from "next/server";
import { defaultDispatcher, recordFire, type ScheduledAction } from "@/lib/scheduler";

export const runtime = "nodejs";

// Walk the in-memory store directly · the public scheduler.ts module
// exports listActions per-tenant but tick needs cross-tenant visibility.
function getAllSchedules(): ScheduledAction[] {
  const G = globalThis as unknown as { __delos_scheduled?: Map<string, ScheduledAction> };
  return G.__delos_scheduled ? [...G.__delos_scheduled.values()] : [];
}

export async function POST(req: NextRequest) {
  const baseUrl = req.nextUrl.origin;
  const now = Date.now();
  const due = getAllSchedules().filter((s) => s.enabled && s.nextRunAt <= now);
  const fired: Array<{ id: string; ok: boolean; note?: string; ms: number }> = [];
  for (const action of due) {
    const t0 = Date.now();
    try {
      const result = await defaultDispatcher(action, baseUrl);
      recordFire(action.id, result.ok, result.note);
      fired.push({ id: action.id, ok: result.ok, note: result.note, ms: Date.now() - t0 });
    } catch (e) {
      const note = e instanceof Error ? e.message : String(e);
      recordFire(action.id, false, note);
      fired.push({ id: action.id, ok: false, note, ms: Date.now() - t0 });
    }
  }
  return Response.json({ ok: true, fired, scanned: due.length, now });
}

export async function GET(req: NextRequest) {
  // GET fires the same tick · allows the user to manually trigger via
  // browser address bar for debugging. Use ?dry=1 to skip dispatch.
  if (req.nextUrl.searchParams.get("dry") === "1") {
    const due = getAllSchedules().filter((s) => s.enabled && s.nextRunAt <= Date.now());
    return Response.json({ ok: true, dryRun: true, dueCount: due.length, due: due.map((d) => ({ id: d.id, kind: d.kind, nextRunAt: d.nextRunAt })) });
  }
  return POST(req);
}
