// Calendar events CRUD · used by CalendarApp + voice "schedule meeting" intent
//
// GET    /api/calendar/events?from=ms&to=ms   · list events in window
// POST   /api/calendar/events                  · create from { title, startAt|when, endAt?, notes?, attendees? }
// DELETE /api/calendar/events?id=...           · remove

import { NextRequest } from "next/server";
import { z } from "zod";
import { listEvents, createEvent, removeEvent } from "@/lib/calendarStore";
import { parseWhen, validateCalendarParse, isCoherentTimeText } from "@/lib/time/parseWhen";
import { parseWhenZeroDep } from "@/lib/time/parseWhenZeroDep";
import { resolveTenant, zodErr } from "@/lib/apiAuth";

// F12 · strip HTML/XSS from titles before persistence. Pair with React's
// default escaping (NEVER dangerouslySetInnerHTML the title).
function sanitizeTitle(s: string): string {
  return String(s).replace(/<[^>]+>/g, "").replace(/[<>]/g, "").trim().slice(0, 200);
}

export const runtime = "nodejs";

const CreateReq = z.object({
  title: z.string().min(1).max(200),
  startAt: z.number().int().optional(),
  endAt: z.number().int().optional(),
  when: z.string().max(200).optional(), // free-text time fragment, e.g. "tomorrow at 4pm"
  tz: z.string().max(60).optional(),
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
  const tz = data.tz ?? req.headers.get("x-tz") ?? "UTC";
  let startAt = data.startAt;
  let endAt = data.endAt;
  if (!startAt && data.when) {
    if (!isCoherentTimeText(data.when)) {
      return Response.json({ error: "unparseable_time", when: data.when }, { status: 400 });
    }
    // R5 · tz-correct zero-dep parser PRIMARY · fixes +1h BST bug.
    // Falls back to legacy regex parser if zero-dep returns null (weird edge cases).
    let parsedAt: Date | null = null;
    let durationMs = 1_800_000;
    let confidence = 0.5;
    try {
      const z = parseWhenZeroDep(data.when, { tz });
      if (z) {
        parsedAt = z.at;
        durationMs = z.durationMs;
        confidence = z.confidence;
      }
    } catch {
      // ignore · fall through to legacy
    }
    if (!parsedAt) {
      const legacy = parseWhen(data.when, { tz });
      const v = validateCalendarParse(legacy);
      if (!v.ok) return Response.json({ error: v.reason, when: data.when }, { status: 400 });
      parsedAt = v.at;
      durationMs = legacy?.durationMs ?? 1_800_000;
      confidence = legacy?.confidence ?? 0.5;
    }
    if (parsedAt.getTime() < Date.now() - 60_000) {
      return Response.json({ error: "past_time" }, { status: 400 });
    }
    if (confidence < 0.4) {
      return Response.json({ error: "low_confidence" }, { status: 400 });
    }
    startAt = parsedAt.getTime();
    endAt = startAt + durationMs;
  }
  if (!startAt) startAt = Date.now() + 3_600_000;
  if (!endAt) endAt = startAt + 1_800_000;
  // F10 · reject past even when caller passed startAt directly
  if (startAt < Date.now() - 60_000) {
    return Response.json({ error: "past_time" }, { status: 400 });
  }
  const event = createEvent(tenantId, {
    title: sanitizeTitle(data.title),
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
