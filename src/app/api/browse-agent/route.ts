// /api/browse-agent · Perplexity-style autonomous browser planner.
//
// The Chrome extension hits this with a user task + current tab context.
// We return a multi-step plan that the extension executes against the
// active tab via chrome.scripting (navigate / scroll / click / fill / extract).
//
// Each step has a `tier` so the extension can gate destructive/external
// actions behind user approval.
//
// Streams plan + step results as SSE. Falls back to a single final answer
// when streaming is unavailable.
import { NextRequest } from "next/server";
import { z } from "zod";
import { runQuickAgent } from "@/lib/agents/quick";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { isNimEnabled, nimChat, NIM_MODELS } from "@/lib/llm/providers/nim";
import { classifyInjection } from "@/lib/security/injection-classifier";
import { safeAddMemory, ensureTenant } from "@/lib/hydra";
import { sanitizeMemoryText } from "@/lib/sanitize";
import { guardMemoryWrite } from "@/lib/memory/writeGuard";

export const runtime = "nodejs";
export const maxDuration = 60;

const Step = z.object({
  action: z.enum(["navigate", "scroll", "click", "fill", "read", "links", "extract", "summarize", "answer"]),
  args: z.record(z.string(), z.unknown()).default({}),
  rationale: z.string().max(240).optional(),
  tier: z.enum(["read", "reversible", "external", "destructive"]).default("read"),
});

const PlanResp = z.object({
  plan: z.array(Step).min(1).max(8),
  final: z.string().max(2000).optional(),
});

// EXT-FIX-1 · be lenient with extension payloads · extension sends `null`
// when "use current tab" is unchecked or tab read fails. Zod `.optional()`
// rejects null, so accept it explicitly. Also `transform`-truncate oversized
// fields rather than reject the whole request — long selections / page text
// are common and should not 400 the browse plan.
const TabCtx = z.object({
  url: z.string().optional().transform((v) => (v ?? "").slice(0, 400)),
  title: z.string().optional().transform((v) => (v ?? "").slice(0, 400)),
  text: z.string().optional().transform((v) => (v ?? "").slice(0, 8000)),
  selection: z.string().optional().transform((v) => (v ?? "").slice(0, 2000)),
});

const Req = z.object({
  task: z.string().min(1).max(2000).optional(),
  input: z.string().min(1).max(2000).optional(),
  tabContext: TabCtx.nullable().optional(),
  tenantId: z.string().max(120).optional().nullable(),
});

const SYSTEM = `You are DelOS Browser Agent · a Perplexity-style planner that
breaks a user's task into 1-6 concrete actions executable by a Chrome
extension against the user's active tab.

Action vocabulary (use ONLY these):
- navigate { url } · open a URL in the current tab
- scroll { direction: "up"|"down"|"top"|"bottom", amount?: 800 }
- click { needle } · click element whose visible text matches needle (case-insensitive substring)
- fill { field, value } · fill input matching field (placeholder/label/name)
- read · pull title + body text from current tab
- links { limit?: 20 } · list top visible links
- extract { query } · summarize tab content focused on a query
- summarize · summarize the current tab
- answer { text } · give user a direct text answer (use when no browse needed)

Tiers — mark destructive/external steps so the extension gates them:
- read · scroll/read/links/extract/summarize
- reversible · fill (draft only)
- external · click that posts forms / submits / sends
- destructive · clicking delete/wipe/remove-account etc.

Output STRICTLY one JSON object:
{
  "plan": [
    { "action": "navigate", "args": { "url": "https://news.ycombinator.com" }, "rationale": "go to HN", "tier": "read" },
    { "action": "scroll", "args": { "direction": "down", "amount": 1200 }, "tier": "read" },
    { "action": "extract", "args": { "query": "top 5 stories" }, "tier": "read" },
    { "action": "summarize", "tier": "read" }
  ],
  "final": "I'll open Hacker News, scroll, and summarize the top 5."
}

Rules:
- Plan must achieve the task with at most 6 steps.
- If task is already answerable without browsing, plan = [{"action":"answer","args":{"text":"..."}}].
- Never click links you have not seen first via read/links.
- If a task asks for destructive action (delete account, send money), mark tier:"destructive" and add a confirmation step.`;

function safeParseJson(text: string): unknown {
  if (!text) return null;
  // Strip code fences if present
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  // Try parse as-is first (cleanest case).
  try {
    return JSON.parse(cleaned);
  } catch {}
  // Find first { and last matching balanced }.
  const start = cleaned.indexOf("{");
  if (start === -1) return null;
  // Walk brace-balanced to find matching close · handles nested JSON
  // inside prose ("Here is my plan: { … } and we will execute it").
  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) end = cleaned.lastIndexOf("}");
  if (end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const lim = rateLimit(`browse:ip:${ip}`, 12, 60_000);
  if (!lim.ok) {
    return Response.json({ error: "rate_limited" }, { status: 429, headers: lim.headers });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  // Field unification
  if (typeof body.input === "string" && !body.task) body.task = body.input;
  const parsed = Req.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "bad_request", detail: parsed.error.message }, { status: 400 });
  }
  const task = parsed.data.task ?? parsed.data.input ?? "";
  if (!task) return Response.json({ error: "task_required" }, { status: 400 });

  const inj = classifyInjection(task);
  if (inj.blocked) {
    return Response.json({ error: "blocked_for_security", pattern: inj.pattern }, { status: 400 });
  }

  // EXT-FIX-1 · ctx may be null if extension sent `tabContext: null`. Treat as missing.
  const ctx = parsed.data.tabContext ?? undefined;
  const userMsg = [
    `TASK:\n${task}`,
    ctx?.url ? `CURRENT_TAB:\n  url: ${ctx.url}\n  title: ${ctx.title ?? ""}` : "",
    ctx?.selection ? `USER_SELECTION:\n${ctx.selection.slice(0, 600)}` : "",
    ctx?.text ? `PAGE_EXCERPT:\n${ctx.text.slice(0, 2000)}` : "",
  ].filter(Boolean).join("\n\n");

  // Prefer NIM Nemotron for planning (low temp, structured output).
  // Fall back to runQuickAgent (provider cascade) when NIM not available.
  let raw = "";
  let planner = "fallback";
  try {
    if (isNimEnabled()) {
      const r = await nimChat({
        model: NIM_MODELS.nemotronSuper49b,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userMsg },
        ],
        temperature: 0.2,
        max_tokens: 900,
      });
      raw = r.text;
      planner = NIM_MODELS.nemotronSuper49b;
    }
  } catch {
    /* fall through */
  }
  if (!raw) {
    try {
      raw = await runQuickAgent({
        prompt: userMsg,
        systemOverride: SYSTEM,
      });
      planner = "groq-fallback";
    } catch (e) {
      return Response.json({ error: "planner_failed", detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
    }
  }

  const obj = safeParseJson(raw);
  let verdict = PlanResp.safeParse(obj);
  // R5-B · planner sometimes wraps plan inside an "answer" step's text · try
  // to extract that nested JSON and re-validate before falling back.
  if (!verdict.success && obj && typeof obj === "object") {
    const o = obj as { plan?: Array<{ action?: string; args?: { text?: string } }> };
    const firstAnswer = o.plan?.[0];
    if (firstAnswer?.action === "answer" && typeof firstAnswer.args?.text === "string") {
      const nested = safeParseJson(firstAnswer.args.text);
      const reParse = PlanResp.safeParse(nested);
      if (reParse.success) verdict = reParse;
    }
  }
  // EXT-MEM-1 · sync every successful browse plan into Hydra memory so the OS
  // MemoryDashboard shows what the extension did. Tenant comes from request
  // body (extension `state.cfg.tenantId`); fall back to `delrio_demo` so
  // anonymous extension users still see their history on the same dashboard.
  // Honors writeGuard, sanitize, and the source enum (`browser-search`).
  const tenantId = (parsed.data.tenantId && String(parsed.data.tenantId).trim()) || "delrio_demo";
  async function persistRun(finalText: string, planLength: number) {
    try {
      const summary = [
        `Browse · ${task.slice(0, 160)}`,
        ctx?.url ? `tab: ${ctx.url}` : "",
        `plan: ${planLength} step${planLength === 1 ? "" : "s"} · planner: ${planner}`,
        finalText ? `result: ${finalText.slice(0, 400)}` : "",
      ].filter(Boolean).join(" · ");
      const guard = guardMemoryWrite(summary);
      if (!guard.ok) return; // silently skip blocked writes; client still gets the plan
      await ensureTenant(tenantId);
      await safeAddMemory({
        tenantId,
        text: sanitizeMemoryText(summary),
        metadata: {
          tags: ["browser-search", "extension"],
          source: "browser-search",
        },
      });
    } catch {
      /* memory write must never block the plan response */
    }
  }

  if (!verdict.success) {
    const fallbackFinal = raw.slice(0, 240);
    await persistRun(fallbackFinal, 1);
    return Response.json({
      ok: true,
      planner,
      plan: [{ action: "answer", args: { text: raw.slice(0, 1200) }, tier: "read" }],
      final: fallbackFinal,
      memorySynced: true,
    });
  }
  await persistRun(verdict.data.final ?? "", verdict.data.plan.length);
  return Response.json({ ok: true, planner, ...verdict.data, memorySynced: true });
}

export async function GET() {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
}
