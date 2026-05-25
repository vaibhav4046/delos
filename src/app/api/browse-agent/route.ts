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

const Req = z.object({
  task: z.string().min(3).max(2000).optional(),
  input: z.string().min(3).max(2000).optional(),
  tabContext: z
    .object({
      url: z.string().max(400).optional(),
      title: z.string().max(400).optional(),
      text: z.string().max(8000).optional(),
      selection: z.string().max(2000).optional(),
    })
    .optional(),
  tenantId: z.string().max(120).optional(),
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
  // Strip code fences if present
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  // Find first { and last }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
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

  const ctx = parsed.data.tabContext;
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
  const verdict = PlanResp.safeParse(obj);
  if (!verdict.success) {
    // Last-resort fallback · answer with the raw text as a single "answer" step
    return Response.json({
      ok: true,
      planner,
      plan: [{ action: "answer", args: { text: raw.slice(0, 1200) }, tier: "read" }],
      final: raw.slice(0, 240),
    });
  }
  return Response.json({ ok: true, planner, ...verdict.data });
}

export async function GET() {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
}
