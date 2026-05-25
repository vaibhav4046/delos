import { safeAddMemory, ensureTenant } from "@/lib/hydra";
import { NextRequest } from "next/server";
import { z } from "zod";

import { zodErr, resolveTenant } from "@/lib/apiAuth";
import { sanitizeMemoryText, assertSafeTags, sanitizeTags } from "@/lib/sanitize";
import { guardMemoryWrite } from "@/lib/memory/writeGuard";
export const runtime = "nodejs";

// tenantId removed from request body (QA BUG-1) — server resolves it from
// session cookie or per-IP anon scope. Same goes for /seed, /import,
// /export, /memory.
const Req = z.object({
  text: z.string().min(3).max(2000),
  tags: z.array(z.string()).default([]),
});

export async function POST(req: NextRequest) {
  const parsed = Req.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return zodErr(parsed.error);
  const { text, tags } = parsed.data;
  // B10 · write-guard. Reject preamble/run-summary/REDACTED pollution
  // before it reaches HydraDB. Returns 400 with the matched pattern name.
  const guard = guardMemoryWrite(text);
  if (!guard.ok) {
    return Response.json(
      { error: "memory_write_rejected", reason: guard.reason },
      { status: 400 },
    );
  }
  // BUG-9 · hard-reject reserved tag names so callers learn the contract.
  try { assertSafeTags(tags); } catch (r) { if (r instanceof Response) return r; throw r; }
  const { tenantId } = await resolveTenant(req);
  const safeText = sanitizeMemoryText(text);
  const safeTags = sanitizeTags([...tags, "pinned"]);
  await ensureTenant(tenantId);
  await safeAddMemory({
    tenantId,
    text: safeText,
    metadata: {
      tags: safeTags,
      pinned: true,
      pinnedAt: Date.now(),
    },
  });
  return Response.json({ ok: true, pinned: true });
}
