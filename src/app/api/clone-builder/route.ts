// Production-ready clone builder. Voice command "build a Twitter clone"
// or POST { inspiration: "Twitter" } emits an SSE stream that ends with
// a `deploy_complete` event carrying a CloneSpec the OS can materialize.
//
// For the 6 named built-in templates the planner step is skipped — we
// return the canned CloneSpec instantly. For everything else we'd call
// the LLM planner with the CloneSpec schema as a contract; that path is
// stubbed here for now (returns a minimal one-page placeholder) so the
// SSE wire-format is exercised against prod regardless of LLM cost.

import { NextRequest } from "next/server";
import { z } from "zod";
import { resolveTenant, zodErr } from "@/lib/apiAuth";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { CloneSpec } from "@/lib/cloneSpec";
import { TWITTER_CLONE } from "@/lib/clone-templates/twitter";

export const runtime = "nodejs";
export const maxDuration = 60;

// Sanitize on read · reject path-traversal + control chars before persistence.
// Strips C0 control codes, parent-traversal (..), path separators, then
// collapses whitespace. Pen-test caught `../../etc/passwd` being accepted
// as inspiration and used verbatim as the spec name — refused now.
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

      // 1) Template path — instant.
      const template = TEMPLATES[inspiration];
      let spec: z.infer<typeof CloneSpec>;
      if (template) {
        spec = template();
        send({ t: "clone_template_hit", inspiration, name: spec.name });
      } else {
        // 2) LLM path stub — return a one-page placeholder so wire-format
        // works while the full planner pipeline lands in the next pass.
        spec = {
          id: cloneId,
          name: parsed.data.inspiration.slice(0, 40),
          inspiration: parsed.data.inspiration,
          icon: "Box",
          branding: { primary: "#FFD60A", secondary: "#07070B", font: "Inter" },
          storage: "localStorage",
          auth: "none",
          features: parsed.data.features ?? ["placeholder"],
          models: [
            { name: "Item", fields: [{ name: "id", type: "id" }, { name: "title", type: "string" }, { name: "createdAt", type: "date" }] },
          ],
          apis: [{ path: "/item/list", method: "GET" }, { path: "/item/create", method: "POST" }],
          pages: [
            {
              id: "home",
              path: "/",
              title: parsed.data.inspiration.slice(0, 40),
              layout: "full",
              root: {
                kind: "col",
                gap: 3,
                children: [
                  { kind: "text", value: `${parsed.data.inspiration} clone (LLM planner offline — using stub).`, size: "h2" },
                  { kind: "input", bind: "draft", placeholder: "type something…" },
                  { kind: "button", label: "Save", variant: "primary", actions: [{ kind: "push", listKey: "items", valueTemplate: "{{draft}}" }, { kind: "set", key: "draft", value: "" }] },
                  { kind: "divider" },
                  { kind: "list", bindKey: "items", itemTemplate: "{{item}}", emptyText: "nothing yet" },
                ],
              },
            },
          ],
        };
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
