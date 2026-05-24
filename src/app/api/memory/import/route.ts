import { safeAddMemory, ensureTenant } from "@/lib/hydra";
import { env } from "@/lib/env";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 30;

const Entry = z.object({
  text: z.string().min(1),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const Req = z.object({
  tenantId: z.string().default(env.DELRIO_TENANT_ID),
  entries: z.array(Entry).max(500).optional(),
  // OR full-export shape
  hydradb: z.array(z.object({ text: z.string() }).passthrough()).optional(),
  local: z.array(z.object({ text: z.string(), tags: z.array(z.string()).optional() }).passthrough()).optional(),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = Req.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: parsed.error.message }, { status: 400 });
  const { tenantId, entries, hydradb, local } = parsed.data;
  await ensureTenant(tenantId);

  const all: Array<{ text: string; tags?: string[]; metadata?: Record<string, unknown> }> = [];
  if (entries) all.push(...entries);
  if (hydradb) all.push(...hydradb.map((h) => ({ text: h.text, tags: ["imported", "hydra"] })));
  if (local) all.push(...local.map((l) => ({ text: l.text, tags: [...(l.tags ?? []), "imported"] })));

  let written = 0;
  for (const e of all.slice(0, 200)) {
    try {
      await safeAddMemory({
        tenantId,
        text: e.text,
        metadata: { ...(e.metadata ?? {}), tags: [...(e.tags ?? []), "imported"], importedAt: Date.now() },
      });
      written += 1;
    } catch {}
  }

  return Response.json({ ok: true, imported: written, total: all.length });
}
