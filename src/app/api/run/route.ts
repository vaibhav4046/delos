import { NextRequest } from "next/server";
import { orchestrate } from "@/lib/orchestrator";
import { withModels, withTemperature, type ModelOverrides, type ModelKey } from "@/lib/llm";
import { buildMcpTools } from "@/lib/mcp/registry";
import type { ChaosKind, RunEvent } from "@/lib/types";
import { z } from "zod";
import { recordRunStart, recordEvent, broadcastLive, getRun, flushRunSnapshot } from "@/lib/runLog";
import { recordRunStats } from "@/lib/stats";
import { env } from "@/lib/env";
import { getServerSession } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 60;

const modelKey = z
  .enum([
    "groq:openai/gpt-oss-120b",
    "groq:openai/gpt-oss-20b",
    "groq:meta-llama/llama-4-scout-17b-16e-instruct",
    "groq:meta-llama/llama-4-maverick-17b-128e-instruct",
    "groq:moonshotai/kimi-k2-instruct-0905",
    "mistral:mistral-large-latest",
    "mistral:mistral-small-latest",
    "google:gemini-2.5-flash",
    "google:gemini-2.5-pro",
  ])
  .optional();

const mcpServer = z.object({
  id: z.string().min(1).max(60),
  name: z.string().min(1).max(80),
  url: z.string().url(),
  enabled: z.boolean().default(true),
});

const bodySchema = z.object({
  goal: z.string().min(3).max(800),
  chaos: z
    .array(z.enum(["tool_flake", "tool_outage", "goal_drift", "context_flood", "user_interrupt"]))
    .default([]),
  interrupt: z
    .object({ afterSteps: z.number().int().nonnegative(), newGoal: z.string().min(3) })
    .optional(),
  maxSteps: z.number().int().min(1).max(12).optional(),
  models: z.object({ planner: modelKey, executor: modelKey, critic: modelKey }).partial().optional(),
  mcpServers: z.array(mcpServer).max(8).optional(),
  tenantId: z.string().min(1).max(120).optional(),
  temperature: z.number().min(0).max(1.5).optional(),
  identity: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: parsed.error.message }), { status: 400 });
  }
  const { goal: rawGoal, chaos, interrupt, maxSteps, models, mcpServers, tenantId, temperature, identity } = parsed.data;
  // JarvisOS: prepend identity preamble so every agent's outputs match the user's tone, format, role.
  const goal = identity ? `${identity}\n---\nUSER GOAL:\n${rawGoal}` : rawGoal;
  const overrides: ModelOverrides | undefined = models
    ? Object.fromEntries(Object.entries(models).filter(([, v]) => v) as Array<[string, ModelKey]>)
    : undefined;

  const extraTools = mcpServers && mcpServers.length > 0 ? await buildMcpTools(mcpServers) : [];

  // Per-user scoping: signed-in user's tenantId always overrides client-sent value.
  // Prevents tenant ID spoofing across users.
  const session = await getServerSession();
  const effectiveTenant = session?.tenantId || tenantId || env.DELRIO_TENANT_ID;
  let resolvedRunId: string | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        await withModels(overrides, async () => withTemperature(temperature, async () => {
          for await (const ev of orchestrate({
            goal,
            chaos: chaos as ChaosKind[],
            interrupt,
            maxSteps,
            extraTools,
            tenantId: effectiveTenant,
          }) as AsyncIterable<RunEvent>) {
            // First event is always `meta` with runId — establish log record
            if (ev.t === "meta" && !resolvedRunId) {
              resolvedRunId = ev.runId;
              const rec = recordRunStart({ runId: ev.runId, tenantId: effectiveTenant, goal });
              broadcastLive({ type: "start", rec });
            }
            if (resolvedRunId) {
              recordEvent(resolvedRunId, ev);
              const rec = getRun(resolvedRunId);
              if (rec) broadcastLive({ type: "event", rec });
            }
            send(ev);
          }
        }));
      } catch (e) {
        const errEv: RunEvent = { t: "error", message: e instanceof Error ? e.message : String(e), at: Date.now() };
        if (resolvedRunId) recordEvent(resolvedRunId, errEv);
        send(errEv);
      } finally {
        const doneEv: RunEvent = { t: "phase", phase: "done", note: "stream end", at: Date.now() };
        if (resolvedRunId) {
          recordEvent(resolvedRunId, doneEv);
          const rec = getRun(resolvedRunId);
          if (rec) {
            recordRunStats({ drift: rec.drift, replans: rec.replans });
            broadcastLive({ type: "end", rec });
          }
          // Await durable snapshot BEFORE closing stream — survives Vercel Lambda shutdown
          try {
            await flushRunSnapshot(resolvedRunId);
          } catch {}
        }
        send(doneEv);
        controller.close();
      }
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
