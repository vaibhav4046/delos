import { NextRequest } from "next/server";
import { z } from "zod";
import { buildRegistry } from "@/lib/tools/builtin";
import { rateLimit, clientIp } from "@/lib/rateLimit";

import { zodErr } from "@/lib/apiAuth";
export const runtime = "nodejs";

// This route runs builtin tools — including `http_fetch` and `web_search`,
// which make outbound requests from the server. Left unthrottled it's an
// open egress-amplification / scraping proxy. Cap to 30/min per IP: generous
// for a real agent loop, uneconomic for abuse.
const TOOL_LIMIT_PER_MIN = 30;
const TOOL_WINDOW_MS = 60_000;

// Accept both `tool` (canonical) and `name` (alias for OpenAI-style invocations).
const bodySchema = z
  .object({
    tool: z.string().min(1).max(40).optional(),
    name: z.string().min(1).max(40).optional(),
    args: z.record(z.string(), z.unknown()).default({}),
  })
  .refine((d) => !!(d.tool || d.name), {
    message: "either 'tool' or 'name' is required",
  });

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const lim = rateLimit(`tool:ip:${ip}`, TOOL_LIMIT_PER_MIN, TOOL_WINDOW_MS);
  if (!lim.ok) {
    return Response.json(
      { ok: false, error: "Too many tool calls. Try again in a minute." },
      { status: 429, headers: lim.headers },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return zodErr(parsed.error);
  }
  const toolName = parsed.data.tool ?? parsed.data.name!;
  const reg = buildRegistry();
  const res = await reg.execute(toolName, parsed.data.args, {
    runId: "tool-runtime",
    chaos: new Set(),
    emit: () => {},
  });
  if (res.ok) return Response.json({ ok: true, data: res.data });
  // B14 · unknown tool → HTTP 404 (was 200+ok:false which broke API contract).
  // Schema/runtime errors stay 400 so callers can distinguish "wrong tool"
  // from "wrong args".
  const notFound = /^Tool not found:/i.test(res.error ?? "");
  return Response.json(
    { ok: false, error: res.error },
    { status: notFound ? 404 : 400 },
  );
}

export async function GET() {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
}
