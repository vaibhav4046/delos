import { safeAddMemory, ensureTenant } from "@/lib/hydra";
import { z } from "zod";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { NextRequest } from "next/server";

import { resolveTenant, zodErr } from "@/lib/apiAuth";
export const runtime = "nodejs";
export const maxDuration = 30;

const Entry = z.object({
  text: z.string().min(1).max(8000),
  tags: z.array(z.string().max(80)).max(20).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const Req = z.object({
  tenantId: z.string().max(120).optional(),
  entries: z.array(Entry).max(200).optional(),
  // OR full-export shape
  hydradb: z.array(z.object({ text: z.string().max(8000) }).passthrough()).max(200).optional(),
  local: z.array(z.object({ text: z.string().max(8000), tags: z.array(z.string().max(80)).max(20).optional() }).passthrough()).max(200).optional(),
});

const IMPORT_LIMIT_PER_MIN = 4;
const IMPORT_WINDOW_MS = 60_000;

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const lim = rateLimit(`memimport:ip:${ip}`, IMPORT_LIMIT_PER_MIN, IMPORT_WINDOW_MS);
  if (!lim.ok) {
    return Response.json(
      { ok: false, error: "Too many import requests. Try again shortly." },
      { status: 429, headers: lim.headers },
    );
  }
  const body = await req.json().catch(() => ({}));
  const parsed = Req.safeParse(body);
  if (!parsed.success) return zodErr(parsed.error);
  // Lock writes to the caller's *resolved* tenant (session → reserved-test →
  // per-IP anon). resolveTenant defaults intent:"write", so an unauth caller
  // passing someone else's tenantId in the body is IGNORED — closes the BOLA
  // import vector where an anon POST could inject memories into a victim tenant.
  const { tenantId } = await resolveTenant(req, { bodyTenantId: parsed.data.tenantId, intent: "write" });
  const { entries, hydradb, local } = parsed.data;
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
