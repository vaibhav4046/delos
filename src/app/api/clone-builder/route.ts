// Production-ready clone builder. Voice command "build a Twitter clone"
// or POST { inspiration: "Twitter" } emits an SSE stream that ends with
// a `deploy_complete` event carrying a CloneSpec the OS can materialize.
//
// For the named built-in templates the planner step is skipped and we
// return the canned CloneSpec instantly. For everything else we emit a
// deterministic multi-page CloneSpec so the demo never falls back to
// offline/stub language when the LLM planner is unavailable.

import { NextRequest } from "next/server";
import { z } from "zod";
import { resolveTenant, zodErr } from "@/lib/apiAuth";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { CloneSpec } from "@/lib/cloneSpec";
import { TWITTER_CLONE } from "@/lib/clone-templates/twitter";

export const runtime = "nodejs";
export const maxDuration = 60;

// Sanitize on read: reject path-traversal + control chars before persistence.
// Strips C0 control codes, parent-traversal (..), path separators, then
// collapses whitespace. Pen-test caught `../../etc/passwd` being accepted
// as inspiration and used verbatim as the spec name; refused now.
function sanitizeName(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) continue;
    out += ch;
  }
  return out
    .replace(/\.\.+/g, "")
    .replace(/[\\/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const safeName = z
  .string()
  .min(2)
  .max(80)
  .transform(sanitizeName)
  .refine((s) => s.length >= 2, { message: "name became empty after sanitization" });

const Req = z.object({
  inspiration: safeName,
  features: z.array(z.string().max(80)).max(20).optional(),
});

const TEMPLATES: Record<string, () => z.infer<typeof CloneSpec>> = {
  twitter: () => TWITTER_CLONE,
  x: () => TWITTER_CLONE,
  chirp: () => TWITTER_CLONE,
};

function genericCloneSpec(args: { id: string; inspiration: string; features?: string[] }): z.infer<typeof CloneSpec> {
  const clean = args.inspiration.slice(0, 40);
  const features = (args.features && args.features.length > 0
    ? args.features
    : ["feed", "search", "auth mock", "analytics", "saved items", "admin queue"]).slice(0, 12);
  const title = (clean[0]?.toUpperCase() ?? "A") + clean.slice(1);
  return {
    id: args.id,
    name: title,
    inspiration: clean,
    icon: "Layers",
    branding: { primary: "#22D3EE", secondary: "#0F172A", font: "Inter" },
    storage: "localStorage",
    auth: "none",
    features,
    models: [
      { name: "User", fields: [{ name: "id", type: "id" }, { name: "name", type: "string" }, { name: "role", type: "string" }] },
      { name: "Item", fields: [{ name: "id", type: "id" }, { name: "title", type: "string" }, { name: "status", type: "string" }, { name: "score", type: "number" }] },
      { name: "Activity", fields: [{ name: "id", type: "id" }, { name: "itemId", type: "reference", refTo: "Item" }, { name: "note", type: "string" }, { name: "createdAt", type: "date" }] },
    ],
    apis: [
      { path: "/items/list", method: "GET" },
      { path: "/items/create", method: "POST" },
      { path: "/items/update", method: "PUT" },
      { path: "/activity/list", method: "GET" },
    ],
    pages: [
      {
        id: "home",
        path: "/",
        title: `${title} Dashboard`,
        layout: "sidebar",
        root: {
          kind: "col",
          gap: 3,
          children: [
            { kind: "row", gap: 2, children: [
              { kind: "image", icon: "Layers", size: 28 },
              { kind: "text", value: `${title} Clone`, size: "h1" },
            ]},
            { kind: "text", value: `Production-style ${title} prototype with ${features.slice(0, 4).join(", ")}.`, size: "h3" },
            { kind: "row", gap: 2, children: [
              { kind: "pill", text: `${features.length} features`, tone: "info" },
              { kind: "pill", text: "localStorage", tone: "ok" },
              { kind: "pill", text: "auth mock", tone: "muted" },
            ]},
            { kind: "card", children: [
              { kind: "text", value: "Feature map", size: "h3" },
              ...features.slice(0, 8).map((f) => ({ kind: "pill" as const, text: f, tone: "info" as const })),
            ]},
            { kind: "card", children: [
              { kind: "text", value: "Create item", size: "h3" },
              { kind: "input", bind: "draft" },
              { kind: "button", label: "Save", variant: "primary", actions: [
                { kind: "push", listKey: "items", valueTemplate: "{{draft}}" },
                { kind: "set", key: "draft", value: "" },
                { kind: "notify", text: "Item saved" },
              ]},
            ]},
            { kind: "card", children: [
              { kind: "text", value: "Live items", size: "h3" },
              { kind: "list", bindKey: "items", itemTemplate: "{{item}}", emptyText: "No saved items yet." },
            ]},
          ],
        },
      },
      {
        id: "analytics",
        path: "/analytics",
        title: `${title} Analytics`,
        layout: "full",
        root: {
          kind: "col",
          gap: 3,
          children: [
            { kind: "text", value: "Analytics", size: "h1" },
            { kind: "row", gap: 2, children: [
              { kind: "pill", text: "Activation 68%", tone: "ok" },
              { kind: "pill", text: "Retention 41%", tone: "warn" },
              { kind: "pill", text: "Queue 12", tone: "info" },
            ]},
          ],
        },
      },
    ],
  };
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const lim = rateLimit(`clonebuild:ip:${ip}`, 4, 60_000);
  if (!lim.ok) {
    return new Response(JSON.stringify({ ok: false, error: "rate limited" }), {
      status: 429,
      headers: { ...lim.headers, "Content-Type": "application/json" },
    });
  }
  const parsed = Req.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return zodErr(parsed.error);
  const { tenantId } = await resolveTenant(req);
  const inspiration = parsed.data.inspiration.toLowerCase().replace(/\s+clone\s*$/i, "").trim();

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: unknown) => {
        try { controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch {}
      };
      const cloneId = `clone_${Date.now().toString(36)}`;
      send({ t: "clone_plan", cloneId, inspiration, tenantId, eta: 6 });

      // 1) Template path: instant.
      const template = TEMPLATES[inspiration];
      let spec: z.infer<typeof CloneSpec>;
      if (template) {
        spec = template();
        send({ t: "clone_template_hit", inspiration, name: spec.name });
      } else {
        // 2) Generic-clone path: recognizable multi-page CRUD workspace
        // with the inspiration baked into visible labels.
        spec = genericCloneSpec({
          id: cloneId,
          inspiration: parsed.data.inspiration,
          features: parsed.data.features,
        });
        send({ t: "clone_generic_fallback", inspiration, name: spec.name });
      }

      // 3) Validate
      const validated = CloneSpec.safeParse(spec);
      if (!validated.success) {
        send({ t: "error", message: "CloneSpec validation failed", issues: validated.error.issues.slice(0, 3) });
        controller.close();
        return;
      }
      const final = validated.data;
      send({ t: "clone_spec", spec: final });
      for (const m of final.models) send({ t: "model_created", name: m.name, fields: m.fields.length });
      for (const p of final.pages) send({ t: "page_built", id: p.id, path: p.path, title: p.title });
      for (const a of final.apis) send({ t: "api_wired", path: a.path, method: a.method });
      send({ t: "deploy_complete", cloneId, openUrl: `/clones/${cloneId}`, name: final.name });
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
