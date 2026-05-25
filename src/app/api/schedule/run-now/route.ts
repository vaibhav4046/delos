// Fire a scheduled action immediately. Used by the UI's "Run now" button
// and by voice intents like "run my morning briefing now".
import { NextRequest } from "next/server";
import { getAction, recordFire, defaultDispatcher } from "@/lib/scheduler";
import { resolveTenant } from "@/lib/apiAuth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const rawBody = await req.json().catch(() => ({}));
  const id = typeof (rawBody as Record<string, unknown>).id === "string" ? (rawBody as Record<string, string>).id : "";
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  const action = getAction(id);
  if (!action) return Response.json({ error: "not_found" }, { status: 404 });
  const { tenantId } = await resolveTenant(req);
  if (action.tenantId !== tenantId) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const baseUrl = req.nextUrl.origin;
  try {
    const result = await defaultDispatcher(action, baseUrl);
    recordFire(action.id, result.ok, result.note);
    return Response.json({ ok: true, fired: action.id, result });
  } catch (e) {
    const note = e instanceof Error ? e.message : String(e);
    recordFire(action.id, false, note);
    return Response.json({ ok: false, error: note }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
}
