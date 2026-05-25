// F12 · /api/schedule/list · canonical list endpoint (mirrors GET /api/schedule
// for callers that prefer a /list suffix). Returns JSON.
import { NextRequest } from "next/server";
import { listActions } from "@/lib/scheduler";
import { resolveTenant } from "@/lib/apiAuth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { tenantId } = await resolveTenant(req);
  return Response.json({ ok: true, tenantId, schedules: listActions(tenantId) });
}

export async function POST() {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
}
