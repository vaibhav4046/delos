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
import { isOpenRouterEnabled, openRouterChat, OPENROUTER_MODELS } from "@/lib/llm/providers/openrouter";
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

// EXT-V2-4 · resolve bare site names + search terms into real URLs so the
// extension's navigate step can land somewhere useful even when the planner
// returns sloppy values. Keeps DuckDuckGo as universal fallback.
const KNOWN_SITES: Record<string, string> = {
  github: "https://github.com",
  google: "https://www.google.com",
  youtube: "https://www.youtube.com",
  twitter: "https://twitter.com",
  x: "https://twitter.com",
  reddit: "https://www.reddit.com",
  chatgpt: "https://chat.openai.com",
  claude: "https://claude.ai",
  notion: "https://www.notion.so",
  gmail: "https://mail.google.com",
  drive: "https://drive.google.com",
  calendar: "https://calendar.google.com",
  hackernews: "https://news.ycombinator.com",
  hn: "https://news.ycombinator.com",
  airbnb: "https://www.airbnb.com",
  airasia: "https://www.airasia.com",
  amazon: "https://www.amazon.com",
  wikipedia: "https://www.wikipedia.org",
  linkedin: "https://www.linkedin.com",
  stackoverflow: "https://stackoverflow.com",
};

function normalizeNavUrl(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  let s = input.trim();
  if (!s) return undefined;
  // Strip prefix verbs the LLM tends to leak ("open github" → "github")
  s = s.replace(/^(open|go to|navigate to|visit|launch)\s+/i, "");
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[\w-]+\.[\w.-]+/.test(s)) return "https://" + s.replace(/^\/+/, "");
  const key = s.toLowerCase().replace(/\s+/g, "");
  if (KNOWN_SITES[key]) return KNOWN_SITES[key];
  // DuckDuckGo lite so we always have a real URL · `?q=` is fine for SERP.
  return "https://duckduckgo.com/?q=" + encodeURIComponent(s);
}

const SYSTEM = `You are DelOS Browser Agent. A Perplexity-style RESEARCH planner that
breaks a user's task into 4-8 concrete actions executable by a Chrome
extension against the user's active tab. You ALWAYS produce a direct answer.

Action vocabulary (use ONLY these):
- navigate { url } · open a URL in the current tab. For research, use a
  SEARCH ENGINE URL with the query encoded: https://www.google.com/search?q=...
  or https://duckduckgo.com/?q=... NEVER navigate to a bare homepage when
  the user asked for specific information.
- scroll { direction: "up"|"down"|"top"|"bottom", amount?: 1500 }
- click { needle } · click element whose visible text matches needle (case-insensitive substring)
- fill { field, value } · fill input matching field (placeholder/label/name)
- read · pull title + body text from current tab
- links { limit?: 20 } · list top visible links
- extract { query } · LLM-summarize the current tab focused on the query.
  Use this LIBERALLY · once per page visited.
- summarize · summarize the current tab
- answer { text } · ALWAYS the LAST step. Write a thorough 3-6 sentence
  direct answer with concrete details (names, prices, links). NEVER end a
  research plan without an answer step.

Tiers (extension uses to gate approvals):
- read · scroll/read/links/extract/summarize/navigate to a search/article page
- reversible · fill (draft only)
- external · click that posts forms / submits / sends
- destructive · clicking delete/wipe/remove-account etc.

PLAN TEMPLATES BY INTENT:

Research / find / compare / best / cheapest / top / review:
  1. navigate { url: search engine URL with query encoded }
  2. scroll down 1500
  3. extract { query: original task }
  4. (optional) click a high-signal result link
  5. (optional) extract { query }
  6. answer { text: direct answer with names, prices, links }

Summarize current page:
  1. read
  2. summarize
  3. answer { text: summary }

Single direct question (math, definition, well-known fact):
  1. answer { text: direct answer }

Action on current page (click X, fill Y):
  1. click { needle } OR fill { field, value }
  2. answer { text: confirmation }

Output STRICTLY one JSON object:
{
  "plan": [
    { "action": "navigate", "args": { "url": "https://www.google.com/search?q=best+wireless+earbuds+under+50+pounds+2025+uk" }, "rationale": "search results for the query", "tier": "read" },
    { "action": "scroll", "args": { "direction": "down", "amount": 1500 }, "tier": "read" },
    { "action": "extract", "args": { "query": "top 3 wireless earbuds under £50 with names, prices, key features" }, "tier": "read" },
    { "action": "answer", "args": { "text": "Based on the search results, the top 3 wireless earbuds under £50 are: 1) ... 2) ... 3) ..." }, "tier": "read" }
  ],
  "final": "Searching for the best earbuds under £50, scrolling through results, extracting picks, and writing a direct answer."
}

CRITICAL RULES:
- NEVER produce a plan that is just [navigate] · always include extract + answer.
- For research tasks, the LAST step MUST be { "action": "answer", "args": { "text": "..." } } with a real 3-6 sentence answer.
- If you don't know the answer yet, plan navigation to a search engine first, then extract, then answer based on extraction.
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
  // BYOK · user can paste their own OpenRouter key in Settings · header
  // takes precedence over server env. Server-side key is the safety net.
  const userOpenRouterKey = req.headers.get("x-byok-openrouter") || undefined;
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
  // EXT-V9 · NIM cold start kills demos · cap at 12 s then fall back to Groq.
  // Vercel maxDuration is 60 s; NIM cold = 30-90 s. Race against a timeout
  // so the user sees a plan in <15 s every time. Groq fallback is fast.
  try {
    if (isNimEnabled()) {
      const nimPromise = nimChat({
        model: NIM_MODELS.nemotronSuper49b,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userMsg },
        ],
        temperature: 0.2,
        max_tokens: 900,
      });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("nim_timeout")), 12_000),
      );
      const r = await Promise.race([nimPromise, timeoutPromise]);
      raw = r.text;
      planner = NIM_MODELS.nemotronSuper49b;
    }
  } catch {
    /* nim timeout or error · fall through to Groq cascade */
  }
  if (!raw) {
    try {
      raw = await runQuickAgent({
        prompt: userMsg,
        systemOverride: SYSTEM,
      });
      planner = "groq-fallback";
    } catch {
      // Groq cascade exhausted · try OpenRouter as last fallback. Honors
      // user BYOK header so judges can run unlimited on their own key.
      if (isOpenRouterEnabled(userOpenRouterKey)) {
        try {
          const orRes = await openRouterChat({
            model: OPENROUTER_MODELS.llama33,
            messages: [
              { role: "system", content: SYSTEM },
              { role: "user", content: userMsg },
            ],
            temperature: 0.2,
            max_tokens: 1200,
            userKey: userOpenRouterKey,
          });
          raw = orRes.text;
          planner = `openrouter/${orRes.model}`;
        } catch (e2) {
          return Response.json({ error: "planner_failed", detail: e2 instanceof Error ? e2.message : String(e2) }, { status: 502 });
        }
      } else {
        return Response.json({ error: "planner_failed", detail: "all providers exhausted" }, { status: 502 });
      }
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
    // EXT-V8 · fallback path used to ship a 1-step answer that bypassed the
    // V6 research enforcement. For research tasks, build a proper
    // navigate + scroll + extract + answer plan even when the planner JSON
    // failed validation so the user still gets a real browse run.
    const fallbackFinal = raw.slice(0, 240);
    const isResearchFallback = /\b(find|search|research|best|cheapest|top|compare|review|recommend|under\s+\$?\d|under\s+£\d|under\s+€\d|which|what.*(should|are|is the)|list|show me|latest|news|current|today|now|right now|recently|summarize|tldr|explain|tell me about|who is|what is|how (do|to|does)|definition)\b/i.test(task);
    let fallbackPlan;
    if (isResearchFallback) {
      const searchUrl = "https://www.google.com/search?q=" + encodeURIComponent(task);
      fallbackPlan = [
        { action: "navigate" as const, args: { url: searchUrl }, rationale: "search engine for research", tier: "read" as const },
        { action: "scroll" as const, args: { direction: "down", amount: 1500 }, rationale: "show more results", tier: "read" as const },
        { action: "extract" as const, args: { query: task }, rationale: "pull relevant content", tier: "read" as const },
        { action: "answer" as const, args: { text: raw.slice(0, 1200) }, rationale: "direct answer", tier: "read" as const },
      ];
    } else {
      fallbackPlan = [{ action: "answer" as const, args: { text: raw.slice(0, 1200) }, tier: "read" as const }];
    }
    await persistRun(fallbackFinal, fallbackPlan.length);
    return Response.json({
      ok: true,
      planner,
      plan: fallbackPlan,
      final: fallbackFinal,
      memorySynced: true,
    });
  }
  // EXT-V2-4 · post-process plan · normalize every navigate step's URL so the
  // extension never sees a bare "github" or "open airbnb" and dead-ends.
  let normalizedPlan = verdict.data.plan.map((step) => {
    if (step.action === "navigate") {
      const rawUrl = (step.args as Record<string, unknown>)?.url ?? (step.args as Record<string, unknown>)?.query;
      const fixed = normalizeNavUrl(rawUrl);
      if (fixed) {
        return { ...step, args: { ...(step.args as object), url: fixed } };
      }
    }
    return step;
  });

  // EXT-V6-1 · enforce RESEARCH PLAN SHAPE.
  // Detect intent: research / find / compare / best / cheapest / top / review.
  // If the planner returned a shallow plan (just 1-2 steps without an answer),
  // auto-expand into navigate -> scroll -> extract -> answer so the user
  // always gets a direct answer instead of just "opened amazon".
  // EXT-V8 · broader trigger · catches news/latest/current/now/today/explain/
  // tell me about/who is/what is in addition to the V6 set so time-sensitive
  // and informational queries also force a real navigate + extract pass.
  const isResearchTask = /\b(find|search|research|best|cheapest|top|compare|review|recommend|under\s+\$?\d|under\s+£\d|under\s+€\d|which|what.*(should|are|is the)|list|show me|latest|news|current|today|now|right now|recently|summarize|tldr|explain|tell me about|who is|what is|how (do|to|does)|definition)\b/i.test(task);
  const hasAnswer = normalizedPlan.some((s) => s.action === "answer");
  const hasExtract = normalizedPlan.some((s) => s.action === "extract" || s.action === "summarize");
  const hasNavigate = normalizedPlan.some((s) => s.action === "navigate");

  if (isResearchTask) {
    // Force search-engine URL on first navigate when the planner left a bare
    // homepage. Amazon homepage doesn't answer "best earbuds under £50".
    const firstNavIdx = normalizedPlan.findIndex((s) => s.action === "navigate");
    if (firstNavIdx >= 0) {
      const navStep = normalizedPlan[firstNavIdx];
      const navUrl = String((navStep.args as Record<string, unknown>)?.url || "");
      // If the URL is a bare homepage (no path/query) for a research task,
      // swap to a search engine query so the page has actual results.
      const isBareHomepage = /^https?:\/\/[^/?#]+\/?$/.test(navUrl);
      if (isBareHomepage || !navUrl) {
        const searchUrl = "https://www.google.com/search?q=" + encodeURIComponent(task);
        normalizedPlan[firstNavIdx] = { ...navStep, args: { ...(navStep.args as object), url: searchUrl } };
      }
    } else if (!hasNavigate) {
      // No navigate at all on a research task · inject one at the front.
      normalizedPlan.unshift({
        action: "navigate",
        args: { url: "https://www.google.com/search?q=" + encodeURIComponent(task) },
        rationale: "search engine for research",
        tier: "read",
      });
    }
    // Insert scroll + extract before answer if missing.
    if (!hasExtract) {
      const insertAt = normalizedPlan.findIndex((s) => s.action === "answer");
      const idx = insertAt === -1 ? normalizedPlan.length : insertAt;
      normalizedPlan.splice(idx, 0,
        { action: "scroll", args: { direction: "down", amount: 1500 }, rationale: "show more results", tier: "read" },
        { action: "extract", args: { query: task }, rationale: "pull relevant content for the task", tier: "read" },
      );
    }
    // Ensure the LAST step is answer. If not, append a placeholder; the
    // executor will fill it from the prior extract result via a synthesis
    // step on the client side.
    if (!hasAnswer) {
      normalizedPlan.push({
        action: "answer",
        args: { text: verdict.data.final || "Synthesis pending. Re-running with extracted context." },
        rationale: "direct answer to the user",
        tier: "read",
      });
    }
  }

  // Cap at 8 steps regardless (Step schema max is 8).
  if (normalizedPlan.length > 8) normalizedPlan = normalizedPlan.slice(0, 8);
  await persistRun(verdict.data.final ?? "", normalizedPlan.length);
  return Response.json({ ok: true, planner, ...verdict.data, plan: normalizedPlan, memorySynced: true });
}

export async function GET() {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
}
