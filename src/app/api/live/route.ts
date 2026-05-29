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

  // Resource-leak fix · the old code defined a `_cleanup` that was NEVER wired
  // to anything, so on client disconnect the 15s heartbeat interval kept firing
  // forever and the subscribeLive listener was never removed (listener array
  // grew unbounded, every run event fanned out to dead controllers). Now the
  // interval + subscription are torn down on stream cancel, request abort, OR
  // the first failed enqueue — whichever fires first, exactly once.
  let hb: ReturnType<typeof setInterval> | undefined;
  let unsub: (() => void) | undefined;
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (hb) clearInterval(hb);
    if (unsub) unsub();
  };

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          // Controller already closed (client gone) — stop the heartbeat +
          // unsubscribe so we don't leak past the disconnect.
          cleanup();
        }
      };
      // Initial snapshot — last 50 runs. Seed first if cold Lambda has empty cache
      // so judges landing on /live always see at least one completed run.
      ensureDemoSeed();
      send({
        type: "snapshot",
        runs: listRuns(50).filter(allowed).map((r) => snap(r)),
        scope: tenantId,
      });
      unsub = subscribeLive((ev) => {
        if (!allowed(ev.rec)) return;
        send({ type: ev.type, rec: snap(ev.rec) });
      });
      // Heartbeat to keep connection alive
      hb = setInterval(() => send({ type: "heartbeat", at: Date.now() }), 15_000);
    },
    cancel() {
      cleanup();
    },
  });
  // Belt-and-suspenders · if the request aborts before the stream's own cancel
  // fires (proxy drop, navigation), tear down here too. `cleanup` is idempotent.
  req.signal.addEventListener("abort", cleanup);
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
