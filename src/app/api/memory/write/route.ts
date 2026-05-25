// B10 · canonical `write` endpoint with write-guard wired in.
// Mirrors /api/memory/pin semantics but exposes a generic "write any text"
// surface that the regression script targets. Rejected texts return 400
// with the matched pattern reason so callers can debug.
import { NextRequest } from "next/server";
import { z } from "zod";
import { safeAddMemory, ensureTenant } from "@/lib/hydra";
import { zodErr, resolveTenant } from "@/lib/apiAuth";
import { sanitizeMemoryText, assertSafeTags, sanitizeTags } from "@/lib/sanitize";
import { guardMemoryWrite } from "@/lib/memory/writeGuard";

export const runtime = "nodejs";

const Req = z.object({
  text: z.string().min(1).max(2000),
  tags: z.array(z.string()).default([]),
  tenantId: z.string().min(1).max(120).optional(),
});

export async function POST(req: NextRequest) {
  const rawBody = await req.json().catch(() => ({}));
  const parsed = Req.safeParse(rawBody);
  if (!parsed.success) return zodErr(parsed.error);
  const { text, tags } = parsed.data;
  // B10 · write-guard front-and-center. Returns 400 + reason.
  const guard = guardMemoryWrite(text);
  if (!guard.ok) {
    return Response.json(
      { error: "memory_write_rejected", reason: guard.reason },
      { status: 400 },
    );
  }
  try { assertSafeTags(tags); } catch (r) { if (r instanceof Response) return r; throw r; }
  let bodyTenantId: string | undefined;
  if (typeof rawBody === "object" && rawBody && typeof (rawBody as Record<string, unknown>).tenantId === "string") {
    bodyTenantId = (rawBody as Record<string, unknown>).tenantId as string;
  }
  const { tenantId } = await resolveTenant(req, { bodyTenantId });
  await ensureTenant(tenantId);
  const safeText = sanitizeMemoryText(text);
  const safeTags = sanitizeTags(tags);
  await safeAddMemory({
    tenantId,
    text: safeText,
    metadata: { tags: safeTags, source: "memory-write" },
  });
  return Response.json({ ok: true, tenantId });
}

export async function GET() {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
}
