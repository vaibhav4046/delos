// B10 · canonical `write` endpoint with write-guard wired in.
// Mirrors /api/memory/pin semantics but exposes a generic "write any text"
// surface that the regression script targets. Rejected texts return 400
// with the matched pattern reason so callers can debug.
import { NextRequest } from "next/server";
import { z } from "zod";
import { safeAddMemory, ensureTenant, getLocalFallback } from "@/lib/hydra";
import { zodErr, resolveTenant } from "@/lib/apiAuth";
import { sanitizeMemoryText, assertSafeTags, sanitizeTags } from "@/lib/sanitize";
import { guardMemoryWrite } from "@/lib/memory/writeGuard";

// M05 · cheap cosine over tokenized text for dedup. Returns existing memory
// id when similarity ≥ 0.95, otherwise null.
function findDuplicate(tenantId: string, text: string): string | null {
  const tokenize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length >= 2);
  const target = new Set(tokenize(text));
  if (target.size === 0) return null;
  const existing = getLocalFallback(tenantId);
  for (const m of existing) {
    if (m.text === text) return m.id;
    const other = new Set(tokenize(m.text));
    let overlap = 0;
    for (const t of target) if (other.has(t)) overlap++;
    const union = target.size + other.size - overlap;
    const jaccard = union > 0 ? overlap / union : 0;
    if (jaccard >= 0.92) return m.id;
  }
  return null;
}

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
  // M05 · dedupe · skip the write when an existing memory is ≥92% Jaccard similar.
  // Returns the existing id so the client knows the write was acknowledged.
  const dupId = findDuplicate(tenantId, safeText);
  if (dupId) {
    return Response.json({ ok: true, tenantId, deduped: true, existingId: dupId });
  }
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
