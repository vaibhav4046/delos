import { NextRequest } from "next/server";
import { z } from "zod";
import { pushSteer } from "@/lib/steerStore";
import { getRun, getRunAsync } from "@/lib/runLog";
import { resolveTenant, zodErr, getRunTenant  } from "@/lib/apiAuth";

export const runtime = "nodejs";

// runId must look like a real nanoid (10 chars alphanumeric+underscore+dash).
// Garbage IDs (e.g. "abc") still get 404 so test B8 contract holds.
const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{10,60}$/;

// B12 · accept canonical `input`, plus legacy `instruction` and `newGoal`.
const bodySchema = z
  .object({
    runId: z.string().min(1).max(60),
    input: z.string().min(3).max(600).optional(),
    instruction: z.string().min(3).max(600).optional(),
    newGoal: z.string().min(3).max(600).optional(),
  })
  .refine((d) => !!(d.input || d.instruction || d.newGoal), {
    message: "either 'input', 'instruction', or 'newGoal' is required",
  });

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return zodErr(parsed.error);
  }
  const { runId } = parsed.data;
  const instruction = parsed.data.input ?? parsed.data.instruction ?? parsed.data.newGoal!;
  // Ownership check (QA report BUG-2) — caller must own the run when we know
  // who owns it. /api/run binds runId→tenant on boot via bindRun(). If the
  // binding exists and disagrees with the caller's resolved tenant, 403.
  // If we have no binding (different Lambda for cross-region cold starts),
  // keep the existing optimistic-queue behavior so /api/live STEER still
  // works — but only for runIds that pass the nanoid pattern check.
  const { tenantId: callerTenant } = await resolveTenant(req);
  const ownerTenant = getRunTenant(runId);
  if (ownerTenant && ownerTenant !== callerTenant) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  // Hot cache first (same Lambda as live SSE)
  let rec = getRun(runId);
  // Cross-Lambda: fall back to HydraDB snapshot (only finds ENDED runs durably)
  if (!rec) {
    const durable = await getRunAsync(runId);
    if (durable) rec = durable;
  }
  // Hot-cache miss + no durable snapshot.
  // If runId pattern is invalid (e.g. "abc"), reject — strict B8 contract.
  // If runId looks legitimate (10+ chars nanoid), optimistically enqueue for cross-Lambda case.
  if (!rec) {
    if (!RUN_ID_PATTERN.test(runId)) {
      return Response.json({ ok: false, error: "unknown_run" }, { status: 404 });
    }
    pushSteer(runId, instruction);
    return Response.json({ ok: true, runId, optimistic: true, note: "queued · run not visible to this Lambda" });
  }
  if (rec.endedAt) {
    return Response.json({ ok: false, error: "run_already_ended" }, { status: 409 });
  }
  pushSteer(runId, instruction);
  return Response.json({ ok: true, runId });
}

export async function GET() {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
}
