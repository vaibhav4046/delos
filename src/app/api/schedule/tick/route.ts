// F02 · schedule tick endpoint. Client interval (ScheduleTicker) calls
// this every 45s. Server walks the schedule store, dispatches due actions,
// re-arms recurring ones, returns fired list.
import { NextRequest } from "next/server";
import { defaultDispatcher, recordFire, type ScheduledAction } from "@/lib/scheduler";
import { resolveTenant } from "@/lib/apiAuth";

export const runtime = "nodejs";

// Walk the in-memory store directly · the public scheduler.ts module
// exports listActions per-tenant but a trusted cron tick needs cross-tenant
// visibility.
function getAllSchedules(): ScheduledAction[] {
  const G = globalThis as unknown as { __delos_scheduled?: Map<string, ScheduledAction> };
  return G.__delos_scheduled ? [...G.__delos_scheduled.values()] : [];
}

// A valid CRON_SECRET unlocks cross-tenant ticking (the real scheduled-job
// path a platform cron would call). WITHOUT it we scope to the caller's own
// resolved tenant — so an anonymous request can no longer force-fire EVERY
// tenant's due actions (emails, missions, cohorts) on demand. That was a
// cross-tenant trigger-amplification / unmetered-egress bug: the in-OS
// ScheduleTicker only ever needs to fire the current user's own actions.
function hasCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const hdr = req.headers.get("authorization") || req.headers.get("x-cron-secret") || "";
  const bearer = hdr.startsWith("Bearer ") ? hdr.slice(7) : hdr;
  // Constant-ish comparison; secrets are short server-set values.
  return bearer.length > 0 && bearer === secret;
}

// Resolve which actions this caller is allowed to tick: all tenants for a
// trusted cron, otherwise just the caller's own resolved tenant.
async function selectScope(req: NextRequest): Promise<ScheduledAction[]> {
  const all = getAllSchedules();
  if (hasCronSecret(req)) return all;
  const { tenantId } = await resolveTenant(req);
  return all.filter((s) => s.tenantId === tenantId);
}

export async function POST(req: NextRequest) {
  const baseUrl = req.nextUrl.origin;
  const now = Date.now();
  const scope = await selectScope(req);
  const due = scope.filter((s) => s.enabled && s.nextRunAt <= now);
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
  // Both paths honor the same tenant scoping as POST.
  if (req.nextUrl.searchParams.get("dry") === "1") {
    const scope = await selectScope(req);
    const due = scope.filter((s) => s.enabled && s.nextRunAt <= Date.now());
    return Response.json({
      ok: true,
      dryRun: true,
      dueCount: due.length,
      due: due.map((d) => ({ id: d.id, kind: d.kind, nextRunAt: d.nextRunAt })),
    });
  }
  return POST(req);
}
