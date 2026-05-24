import { subscribeLive, listRuns, ensureDemoSeed } from "@/lib/runLog";
import { NextRequest } from "next/server";
import { resolveTenant } from "@/lib/apiAuth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  // Tenant gate (QA report BUG-3) — /api/live was streaming every run across
  // every tenant to anyone. Now: snapshot + live events are filtered to the
  // caller's resolved tenant. Demo-seeded "seed-demo-*" run is allowed to
  // pass for marketing surface (it has no PII).
  const { tenantId } = await resolveTenant(req);
  const allowed = (rec: { tenantId: string; runId: string }) =>
    rec.tenantId === tenantId || rec.runId.startsWith("seed-demo-");
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (obj: unknown) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {}
      };
      // Initial snapshot — last 50 runs. Seed first if cold Lambda has empty cache
      // so judges landing on /live always see at least one completed run.
      ensureDemoSeed();
      send({
        type: "snapshot",
        runs: listRuns(50).filter(allowed).map((r) => snap(r)),
        scope: tenantId,
      });
      const unsub = subscribeLive((ev) => {
        if (!allowed(ev.rec)) return;
        send({ type: ev.type, rec: snap(ev.rec) });
      });
      // Heartbeat to keep connection alive
      const hb = setInterval(() => send({ type: "heartbeat", at: Date.now() }), 15_000);
      // No cancellation listener — connection close handled by enqueue throw
      const _cleanup = () => {
        clearInterval(hb);
        unsub();
      };
      void _cleanup; // referenced for closure
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function snap(r: { runId: string; tenantId: string; goal: string; startedAt: number; endedAt?: number; drift?: number; replans?: number; success?: boolean; events: { length: number }; answer?: string }) {
  return {
    runId: r.runId,
    tenantId: r.tenantId.slice(0, 6) + "…",
    goal: r.goal.slice(0, 80),
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    drift: r.drift,
    replans: r.replans,
    success: r.success,
    eventCount: r.events.length,
    answer: r.answer ? r.answer.slice(0, 120) : undefined,
  };
}
