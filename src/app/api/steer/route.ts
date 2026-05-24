import { NextRequest } from "next/server";
import { z } from "zod";
import { pushSteer } from "@/lib/steerStore";
import { getRun, getRunAsync } from "@/lib/runLog";

export const runtime = "nodejs";

// runId must look like a real nanoid (10 chars alphanumeric+underscore+dash).
// Garbage IDs (e.g. "abc") still get 404 so test B8 contract holds.
const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{10,60}$/;

// Accept both `instruction` (canonical) and `newGoal` (alias for external integrations).
const bodySchema = z
  .object({
    runId: z.string().min(1).max(60),
    instruction: z.string().min(3).max(600).optional(),
    newGoal: z.string().min(3).max(600).optional(),
  })
  .refine((d) => !!(d.instruction || d.newGoal), {
    message: "either 'instruction' or 'newGoal' is required",
  });

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  const { runId } = parsed.data;
  const instruction = parsed.data.instruction ?? parsed.data.newGoal!;
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
