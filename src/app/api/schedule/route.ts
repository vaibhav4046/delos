// Schedule CRUD endpoint · used by the in-OS Schedule app + voice agent.
//
// GET    /api/schedule              · list actions for tenant
// POST   /api/schedule              · create action
// DELETE /api/schedule?id=...       · remove action
// POST   /api/schedule/toggle       · enable/disable (separate route)
// POST   /api/schedule/run-now      · fire one action immediately (separate route)
import { NextRequest } from "next/server";
import { z } from "zod";
import { addAction, listActions, removeAction, type ScheduledActionKind } from "@/lib/scheduler";
import { resolveTenant, zodErr } from "@/lib/apiAuth";

export const runtime = "nodejs";

const KINDS: [ScheduledActionKind, ...ScheduledActionKind[]] = [
  "draft_email",
  "read_email",
  "notion_page",
  "notify",
  "run_mission",
  "cohort",
];

const CreateReq = z.object({
  kind: z.enum(KINDS),
  label: z.string().min(1).max(120),
  payload: z.record(z.string(), z.unknown()).default({}),
  runAt: z.number().int().optional(),
  everyMs: z.number().int().min(10_000).optional(),
});

export async function GET(req: NextRequest) {
  const { tenantId } = await resolveTenant(req);
  return Response.json({ ok: true, tenantId, actions: listActions(tenantId) });
}

export async function POST(req: NextRequest) {
  const rawBody = await req.json().catch(() => ({}));
  const parsed = CreateReq.safeParse(rawBody);
  if (!parsed.success) return zodErr(parsed.error);
  let bodyTenantId: string | undefined;
  if (rawBody && typeof rawBody === "object" && typeof (rawBody as Record<string, unknown>).tenantId === "string") {
    bodyTenantId = (rawBody as Record<string, unknown>).tenantId as string;
  }
  const { tenantId } = await resolveTenant(req, { bodyTenantId });
  const action = addAction({ ...parsed.data, tenantId });
  return Response.json({ ok: true, action });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  const removed = removeAction(id);
  if (!removed) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ ok: true, id });
}
