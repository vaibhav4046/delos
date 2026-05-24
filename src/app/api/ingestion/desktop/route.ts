// Desktop ingestion digest receiver. Persists privacy-preserving metadata only.
// File CONTENT never crosses the network — picker stays local.

import { z } from "zod";
import { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { safeAddMemory } from "@/lib/hydra";

import { zodErr } from "@/lib/apiAuth";
export const runtime = "nodejs";

const fileSchema = z.object({
  path: z.string().max(500),
  name: z.string().max(200),
  size: z.number().int().nonnegative(),
  kind: z.enum(["file", "directory"]),
  modifiedAt: z.number().int().nonnegative(),
});

const bodySchema = z.object({
  root: z.string().min(1).max(120),
  count: z.number().int().nonnegative(),
  digest: z.array(fileSchema).max(200),
  tenantId: z.string().min(1).max(120).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return zodErr(parsed.error);
  }
  const { root, count, digest, tenantId } = parsed.data;
  const tid = tenantId || env.DELRIO_TENANT_ID;

  // Persist digest summary (paths + sizes) in HydraDB for cross-device recall + agent context.
  const fileLines = digest
    .slice(0, 100)
    .map((f) => `${f.kind === "directory" ? "[D]" : "[F]"} ${f.path} (${f.size}B)`)
    .join("\n");
  await safeAddMemory({
    tenantId: tid,
    text: `DESKTOP_INDEX root=${root} files=${count} indexed_at=${Date.now()}\n${fileLines}`,
    metadata: {
      kind: "desktop-index",
      root,
      fileCount: count,
      tags: ["desktop-index", "ingestion"],
    },
  });

  return Response.json({ ok: true, indexed: count, tenant: tid });
}

export async function GET(req: NextRequest) {
  // Lightweight status probe — returns latest indexed digest count for tenant.
  const url = new URL(req.url);
  const tenantId = url.searchParams.get("tenantId") || env.DELRIO_TENANT_ID;
  return Response.json({ ok: true, tenant: tenantId, hint: "POST to ingest a digest. Picker runs client-side." });
}
