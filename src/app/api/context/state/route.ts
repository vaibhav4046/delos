import { NextRequest } from "next/server";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { resolveTenant } from "@/lib/apiAuth";
import { snapshotState, clearTenantContext } from "@/lib/swarmContext";

export const runtime = "nodejs";
export const maxDuration = 10;

// Live snapshot of the caller's swarm-context tree — frames, recursion depth,
// token totals, recent items. Powers the Context Inspector app.
export async function GET(req: NextRequest) {
  const ip = clientIp(req);
  const lim = rateLimit(`ctx-state:ip:${ip}`, 120, 60_000);
  if (!lim.ok) {
    return Response.json({ error: "Too many requests." }, { status: 429, headers: lim.headers });
  }
  // Read-only view of the caller's own context — resolved server-side.
  const { tenantId } = await resolveTenant(req, { intent: "read" });
  return Response.json(snapshotState(tenantId));
}

// DELETE clears the caller's own context tree (Inspector "reset"). Scoped to
// the resolved tenant, so one caller can never wipe another's context.
export async function DELETE(req: NextRequest) {
  const ip = clientIp(req);
  const lim = rateLimit(`ctx-state-del:ip:${ip}`, 20, 60_000);
  if (!lim.ok) {
    return Response.json({ error: "Too many requests." }, { status: 429, headers: lim.headers });
  }
  const { tenantId } = await resolveTenant(req, { intent: "write" });
  const cleared = clearTenantContext(tenantId);
  return Response.json({ cleared });
}
