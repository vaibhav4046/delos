// F14 · accept either { id } (named action) OR { kind, payload } (ad-hoc).
// Ad-hoc lets the regression script + voice agent fire one-off actions
// without first creating + listing a row.
import { NextRequest } from "next/server";
import { z } from "zod";
import { getAction, recordFire, defaultDispatcher, type ScheduledAction, type ScheduledActionKind } from "@/lib/scheduler";
import { resolveTenant } from "@/lib/apiAuth";

export const runtime = "nodejs";

const ByIdReq = z.object({ id: z.string().min(1) });
const AdhocReq = z.object({
  kind: z.enum(["draft_email", "read_email", "notion_page", "notify", "run_mission", "cohort"] as [ScheduledActionKind, ...ScheduledActionKind[]]),
  payload: z.record(z.string(), z.unknown()).default({}),
  label: z.string().max(120).optional(),
});

export async function POST(req: NextRequest) {
  const rawBody = await req.json().catch(() => ({}));
  const byId = ByIdReq.safeParse(rawBody);
  const adhoc = AdhocReq.safeParse(rawBody);
  if (!byId.success && !adhoc.success) {
    return Response.json(
      { error: "id_or_kind_required", hint: "POST { id } or { kind, payload }" },
      { status: 400 },
    );
  }
  const { tenantId } = await resolveTenant(req);
  let action: ScheduledAction;
  if (byId.success) {
    const found = getAction(byId.data.id);
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });
    if (found.tenantId !== tenantId) return Response.json({ error: "forbidden" }, { status: 403 });
    action = found;
  } else {
    // Ad-hoc · construct a transient action that defaultDispatcher can run
    action = {
      id: `adhoc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tenantId,
      kind: adhoc.data!.kind,
      label: adhoc.data!.label ?? `adhoc · ${adhoc.data!.kind}`,
      payload: adhoc.data!.payload,
      createdAt: Date.now(),
      nextRunAt: Date.now(),
      enabled: true,
      history: [],
    };
  }
  const baseUrl = req.nextUrl.origin;
  try {
    const result = await defaultDispatcher(action, baseUrl);
    if (byId.success) recordFire(action.id, result.ok, result.note);
    return Response.json({ ok: true, fired: action.id, kind: action.kind, result });
  } catch (e) {
    const note = e instanceof Error ? e.message : String(e);
    if (byId.success) recordFire(action.id, false, note);
    return Response.json({ ok: false, error: note }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
}
