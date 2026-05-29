import { NextRequest } from "next/server";
import { z } from "zod";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { resolveTenant, zodErr } from "@/lib/apiAuth";
import { persistTurn } from "@/lib/swarmContext";

export const runtime = "nodejs";
export const maxDuration = 15;

// Ingest one conversation turn into the swarm-context engine: append it to the
// thread's frame, persist a long-term memory entry, and return the recursive
// context window the client should inject on the next turn.
const bodySchema = z.object({
  threadId: z.string().min(1).max(120),
  role: z.enum(["user", "assistant"]),
  text: z.string().min(1).max(8000),
  mode: z.string().max(40).optional(),
  label: z.string().max(120).optional(),
  pinned: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  // Two turns per message (user + assistant) × bursty typing → generous cap.
  const lim = rateLimit(`ctx-thread:ip:${ip}`, 120, 60_000);
  if (!lim.ok) {
    return Response.json({ error: "Too many context updates. Slow down." }, { status: 429, headers: lim.headers });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return zodErr(parsed.error);

  // tenantId is resolved server-side from the session/IP — never trusted from
  // the body (BOLA). Context writes are scoped to the resolved tenant.
  const { tenantId } = await resolveTenant(req, { intent: "write" });

  const { frameId, context } = await persistTurn({ tenantId, ...parsed.data });
  return Response.json({
    frameId,
    hints: context.hints,
    tokensUsed: context.tokensUsed,
    depthReached: context.depthReached,
    memoryHits: context.memoryHits,
    items: context.items.map((i) => ({ source: i.source, text: i.text, threadId: i.threadId, at: i.at })),
  });
}
