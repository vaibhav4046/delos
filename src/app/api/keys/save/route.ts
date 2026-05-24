// BYOK · save a free-tier LLM provider key into the tenant's encrypted key
// bag. Caller never sends tenantId — server resolves it from the session.
// Response always `{ ok, hasKey: true }`; key plaintext never echoed back.

import { NextRequest } from "next/server";
import { z } from "zod";
import { resolveTenant, zodErr } from "@/lib/apiAuth";
import { saveKey, PROVIDERS, ROLES, type ProviderId, type RoleId } from "@/lib/keyBag";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";

const Req = z.object({
  provider: z.enum(PROVIDERS as [ProviderId, ...ProviderId[]]),
  key: z.string().min(8).max(256),
  roles: z.array(z.enum(ROLES as [RoleId, ...RoleId[]])).min(1).max(5),
});

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const lim = rateLimit(`keysave:ip:${ip}`, 10, 60_000);
  if (!lim.ok) {
    return Response.json({ ok: false, error: "rate limited" }, { status: 429, headers: lim.headers });
  }
  const parsed = Req.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return zodErr(parsed.error);
  const { tenantId } = await resolveTenant(req);
  await saveKey(tenantId, parsed.data.provider, parsed.data.key, parsed.data.roles);
  return Response.json({ ok: true, hasKey: true, provider: parsed.data.provider });
}
