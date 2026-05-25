// Calendar events CRUD · used by CalendarApp + voice "schedule meeting" intent
//
// GET    /api/calendar/events?from=ms&to=ms   · list events in window
// POST   /api/calendar/events                  · create from { title, startAt|when, endAt?, notes?, attendees? }
// DELETE /api/calendar/events?id=...           · remove

import { NextRequest } from "next/server";
import { z } from "zod";
import { listEvents, createEvent, removeEvent, parseWhen } from "@/lib/calendarStore";
import { resolveTenant, zodErr } from "@/lib/apiAuth";

export const runtime = "nodejs";

const CreateReq = z.object({
  title: z.string().min(1).max(200),
  startAt: z.number().int().optional(),
  endAt: z.number().int().optional(),
  when: z.string().max(200).optional(), // free-text time fragment, e.g. "tomorrow at 4pm"
  notes: z.string().max(2000).optional(),
  attendees: z.array(z.string().max(120)).max(20).optional(),
  source: z.enum(["manual", "voice", "schedule"]).optional(),
});

export async function GET(req: NextRequest) {
  const { tenantId } = await resolveTenant(req);
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  const events = listEvents(tenantId, from ? Number(from) : undefined, to ? Number(to) : undefined);
  return Response.json({ ok: true, tenantId, events });
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
  const data = parsed.data;
  let startAt = data.startAt;
  let endAt = data.endAt;
  if (!startAt && data.when) {
    const parsedWhen = parseWhen(data.when);
    if (parsedWhen) {
      startAt = parsedWhen.startAt;
      endAt = parsedWhen.endAt;
    }
  }
  if (!startAt) startAt = Date.now() + 3_600_000; // default 1 hour from now
  if (!endAt) endAt = startAt + 1_800_000;
  const event = createEvent(tenantId, {
    title: data.title,
    startAt,
    endAt,
    notes: data.notes,
    attendees: data.attendees,
    source: data.source ?? "manual",
  });
  return Response.json({ ok: true, event });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  const { tenantId } = await resolveTenant(req);
  const removed = removeEvent(tenantId, id);
  if (!removed) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ ok: true, id });
}
