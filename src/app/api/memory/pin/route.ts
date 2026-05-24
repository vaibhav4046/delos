import { safeAddMemory, ensureTenant } from "@/lib/hydra";
import { env } from "@/lib/env";
import { z } from "zod";

export const runtime = "nodejs";

const Req = z.object({
  text: z.string().min(3).max(2000),
  tenantId: z.string().default(env.DELRIO_TENANT_ID),
  tags: z.array(z.string()).default([]),
});

export async function POST(req: Request) {
  const parsed = Req.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ ok: false, error: parsed.error.message }, { status: 400 });
  const { text, tenantId, tags } = parsed.data;
  await ensureTenant(tenantId);
  await safeAddMemory({
    tenantId,
    text,
    metadata: {
      tags: [...tags, "pinned"],
      pinned: true,
      pinnedAt: Date.now(),
    },
  });
  return Response.json({ ok: true, pinned: true });
}
