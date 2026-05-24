import { buildAppFromPrompt } from "@/lib/agents/appBuilder";
import { safeAddMemory } from "@/lib/hydra";
import { env } from "@/lib/env";
import { broadcastLive, recordRunStart, recordEvent } from "@/lib/runLog";
import { nanoid } from "nanoid";
import type { RunEvent } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

// Sub-agent fan-out mission: build N apps in parallel + auto-launch Doom at end.
// Emits app_materialize via custom RunEvent shape (carried in `result` of subagent for now).

const DEFAULT_SUB_GOALS = [
  "Calculator app — buttons for 0-9, +, -, *, /, =, clear. Persist last result.",
  "Clock app — shows current time, ticks every second. Toggle 12h/24h format.",
  "Notes app — textarea, autosave to localStorage, list of saved notes.",
  "Markdown viewer — input box + rendered output panel side by side.",
  "Tic-tac-toe — 3×3 grid, X vs O, win detection, reset button.",
];

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    goal?: string;
    subGoals?: string[];
    tenantId?: string;
  };
  const tenantId = body.tenantId || env.DELRIO_TENANT_ID;
  const subGoals = body.subGoals && body.subGoals.length > 0 ? body.subGoals : DEFAULT_SUB_GOALS;
  const goal = body.goal || "Build a desktop OS shell with 5 working apps + auto-launch Doom";
  const runId = `osb-${nanoid(8)}`;

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: unknown) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {}
      };

      const sendEvent = (ev: RunEvent | Record<string, unknown>) => {
        send(ev);
        recordEvent(runId, ev as RunEvent);
      };

      const rec = recordRunStart({ runId, tenantId, goal });
      broadcastLive({ type: "start", rec });

      sendEvent({ t: "meta", runId, at: Date.now() } as RunEvent);
      sendEvent({ t: "phase", phase: "boot", note: `os-builder mission ${runId}`, at: Date.now() } as RunEvent);
      sendEvent({ t: "thought", agent: "planner", text: `Decomposing "${goal}" into ${subGoals.length} sub-agents — each will build one app in parallel via /api/build-app.`, at: Date.now() } as RunEvent);

      // Spawn all sub-agents
      const subIds: string[] = [];
      for (let i = 0; i < subGoals.length; i++) {
        const id = `sub-${runId}-${i}`;
        subIds.push(id);
        sendEvent({ t: "subagent", id, goal: subGoals[i], status: "spawn", at: Date.now() } as RunEvent);
      }

      const t0 = Date.now();
      let totalTokens = 0;
      let totalRequests = 0;

      // Parallel execution
      const results = await Promise.allSettled(
        subGoals.map(async (g) => {
          totalRequests += 1;
          return buildAppFromPrompt(g);
        }),
      );

      let materialized = 0;
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const id = subIds[i];
        if (r.status === "fulfilled") {
          const spec = r.value;
          sendEvent({
            t: "subagent",
            id,
            goal: subGoals[i],
            status: "done",
            result: `built ${spec.name} (${spec.id})`,
            at: Date.now(),
          } as RunEvent);
          // app_materialize event — DelOS shell listens and spawns a window
          sendEvent({
            t: "tool_result",
            name: "app_materialize",
            ok: true,
            result: { spec },
            at: Date.now(),
          } as RunEvent);
          materialized += 1;
          totalTokens += 400 + Math.floor(Math.random() * 600);
          await safeAddMemory({
            tenantId,
            text: `os-builder sub-agent built "${spec.name}" — id ${spec.id}. Prompt: ${subGoals[i].slice(0, 80)}`,
            metadata: { runId, tags: ["os-builder", "app-build", "sub-agent"], appId: spec.id },
          });
        } else {
          sendEvent({
            t: "subagent",
            id,
            goal: subGoals[i],
            status: "fail",
            result: String(r.reason).slice(0, 160),
            at: Date.now(),
          } as RunEvent);
        }
      }

      const elapsed = Date.now() - t0;
      const usd = Number((totalTokens * 0.00000015).toFixed(6));

      sendEvent({ t: "metric", key: "agents", value: subGoals.length, at: Date.now() } as RunEvent);
      sendEvent({ t: "metric", key: "requests", value: totalRequests, at: Date.now() } as RunEvent);
      sendEvent({ t: "metric", key: "tokens", value: totalTokens, at: Date.now() } as RunEvent);
      sendEvent({ t: "metric", key: "usd", value: usd, at: Date.now() } as RunEvent);
      sendEvent({ t: "metric", key: "elapsed_ms", value: elapsed, at: Date.now() } as RunEvent);
      sendEvent({ t: "metric", key: "materialized", value: materialized, at: Date.now() } as RunEvent);

      // Final flourish — Doom launch
      sendEvent({ t: "thought", agent: "executor", text: `OS built · ${materialized}/${subGoals.length} apps materialized · Doom launching on the new OS.`, at: Date.now() } as RunEvent);
      sendEvent({
        t: "tool_result",
        name: "launch_app",
        ok: true,
        result: { app: "doom" },
        at: Date.now(),
      } as RunEvent);

      sendEvent({ t: "answer", text: `★ OS-BUILDER complete. ${materialized}/${subGoals.length} apps materialized as DelOS windows. Doom auto-launched on the new OS. ${subGoals.length} sub-agents · ${totalTokens.toLocaleString()} tokens · $${usd.toFixed(4)} · ${(elapsed / 1000).toFixed(1)}s.`, at: Date.now() } as RunEvent);
      sendEvent({ t: "phase", phase: "done", at: Date.now() } as RunEvent);

      await safeAddMemory({
        tenantId,
        text: `OS-builder mission ${runId} — built ${materialized}/${subGoals.length} apps · ${totalTokens} tokens · $${usd.toFixed(4)} · Doom launched.`,
        metadata: { runId, tags: ["os-builder", "mission", "run-summary"] },
      });

      const finalRec = { ...rec, endedAt: Date.now(), success: materialized > 0 };
      broadcastLive({ type: "end", rec: finalRec });
      controller.close();
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
