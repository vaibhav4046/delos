import { NextRequest } from "next/server";
import { z } from "zod";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { resolveTenant, zodErr } from "@/lib/apiAuth";
import { collectContext, frameForThread } from "@/lib/swarmContext";

export const runtime = "nodejs";
export const maxDuration = 15;

// On-demand recursive context window for a query, optionally anchored to a
// specific thread frame. Used by "continue-anywhere" (seed a new chat/run from
// a past thread's context) and by agents fetching cross-thread context.
const bodySchema = z.object({
  query: z.string().min(1).max(2000),
  threadId: z.string().max(120).optional(),
  tokenBudget: z.number().int().min(100).max(4000).optional(),
  maxDepth: z.number().int().min(0).max(12).optional(),
});

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const lim = rateLimit(`ctx-recall:ip:${ip}`, 60, 60_000);
  if (!lim.ok) {
    return Response.json({ error: "Too many recall requests." }, { status: 429, headers: lim.headers });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return zodErr(parsed.error);
  const { query, threadId, tokenBudget, maxDepth } = parsed.data;

  const { tenantId } = await resolveTenant(req, { intent: "read" });
  const frameId = threadId ? frameForThread({ tenantId, threadId }).id : undefined;
  const ctx = await collectContext({ frameId, tenantId, query, tokenBudget, maxDepth });
  return Response.json({
    frameId: ctx.frameId,
    hints: ctx.hints,
    tokensUsed: ctx.tokensUsed,
    depthReached: ctx.depthReached,
    memoryHits: ctx.memoryHits,
    items: ctx.items.map((i) => ({ source: i.source, text: i.text, threadId: i.threadId, at: i.at })),
  });
}
