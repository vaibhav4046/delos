import { NextRequest } from "next/server";
import { z } from "zod";
import { buildRegistry } from "@/lib/tools/builtin";

import { zodErr } from "@/lib/apiAuth";
export const runtime = "nodejs";

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
  return Response.json({ ok: false, error: res.error }, { status: 200 });
}
