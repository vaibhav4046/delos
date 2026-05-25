// F13 · /api/notify · server endpoint the schedule dispatcher hits for
// kind:'notify'. Persists to a global in-memory queue + emits SSE-shaped
// notification so any open OS tab picks it up via the existing toast bridge.
import { NextRequest } from "next/server";
import { z } from "zod";
import { zodErr, resolveTenant } from "@/lib/apiAuth";

export const runtime = "nodejs";

const Req = z.object({
  title: z.string().min(1).max(140).optional(),
  message: z.string().min(1).max(2000).optional(),
  text: z.string().min(1).max(2000).optional(),
  tone: z.enum(["ok", "info", "warn", "bad", "system"]).optional(),
  tenantId: z.string().max(120).optional(),
});

const G = globalThis as unknown as {
  __delos_notifs_server?: Array<{ id: string; tenantId: string; title?: string; message: string; tone: string; at: number }>;
};
G.__delos_notifs_server ??= [];
const queue = G.__delos_notifs_server;

export async function POST(req: NextRequest) {
  const rawBody = await req.json().catch(() => ({}));
  const parsed = Req.safeParse(rawBody);
  if (!parsed.success) return zodErr(parsed.error);
  const data = parsed.data;
  let bodyTenantId: string | undefined;
  if (rawBody && typeof rawBody === "object" && typeof (rawBody as Record<string, unknown>).tenantId === "string") {
    bodyTenantId = (rawBody as Record<string, unknown>).tenantId as string;
  }
  const { tenantId } = await resolveTenant(req, { bodyTenantId });
  const message = data.message ?? data.text ?? "(no message)";
  const id = `nx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  queue.push({
    id,
    tenantId,
    title: data.title,
    message,
    tone: data.tone ?? "info",
    at: Date.now(),
  });
  // Cap to last 200 entries
  if (queue.length > 200) queue.splice(0, queue.length - 200);
  return Response.json({ ok: true, id, tenantId });
}

export async function GET(req: NextRequest) {
  const { tenantId } = await resolveTenant(req);
  const sinceParam = req.nextUrl.searchParams.get("since");
  const since = sinceParam ? Number(sinceParam) : 0;
  const items = queue.filter((n) => n.tenantId === tenantId && n.at > since);
  return Response.json({ ok: true, items });
}
