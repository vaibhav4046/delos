// Built-in AppSpec library — instant-install templates.
// No LLM round-trip. Returns full validated AppSpec for any of 6 production apps.

import { BUILTIN_APPS, getBuiltinApp, listBuiltinApps } from "@/lib/builtinApps";
import { appSpecSchema } from "@/lib/appSpec";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (id) {
    const app = getBuiltinApp(id);
    if (!app) {
      return Response.json({ ok: false, reason: `unknown builtin app: ${id}` }, { status: 404 });
    }
    const parsed = appSpecSchema.safeParse(app);
    if (!parsed.success) {
      return Response.json({ ok: false, reason: "spec invalid", issues: parsed.error.issues }, { status: 500 });
    }
    return Response.json({ ok: true, app: parsed.data });
  }

  return Response.json({
    ok: true,
    count: BUILTIN_APPS.length,
    apps: listBuiltinApps(),
  });
}
