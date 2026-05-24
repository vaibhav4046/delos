// Multi-file codegen — produces real React/Next.js project trees from a prompt.
// Used when user says "build me an Uber clone" / "build a real SaaS dashboard" etc.
// Returns { name, description, files: [{path, content, language}] }
//
// Architecture: two-pass generation.
//   1. PLAN call — model emits the file list (10–15 paths + short brief each)
//   2. WRITE calls — for each file, a focused call generates the full source
//      with the file's own dedicated token budget. Calls fan out in parallel
//      batches of 3 so we don't blow the 30K-TPM ceiling.
// Single-shot is the old path; it boxed file size down to 1–2KB because the
// whole project shared one 5500-tok response. Two-pass lets each file get
// 5–10KB of real code, which is the difference between a "small" demo and
// an actual Uber-clone prototype with working state + mock data + interactive
// components.
//
// AppSpec route (/api/build-app) is for constrained DSL mini-apps; this route
// produces unconstrained code suitable for a Codebase viewer window.

import { NextRequest } from "next/server";
import { z } from "zod";
import { safeAddMemory } from "@/lib/hydra";
import { env } from "@/lib/env";
import { rateLimit, clientIp } from "@/lib/rateLimit";

import { zodErr } from "@/lib/apiAuth";
// Codegen is the heaviest paid path. Cap to keep one attacker from draining
// the shared Groq TPM budget. 6/min is well above a legit user's cadence;
// the 429 below already kicks in earlier when Groq TPM is hit.
const CODEGEN_LIMIT_PER_MIN = 6;
const CODEGEN_WINDOW_MS = 60_000;

// Default model: llama-4-scout-17b on Groq. Free-tier-confirmed available,
// 30K TPM, decent code. Kimi K2 + maverick-128e are gated behind paid tier
// for this account. Gemini 2.5 Flash steps in as first fallback because
// its code quality + 1M-token-per-day quota dwarfs Mistral-small's free
// allowance.
const DEFAULT_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

// Free-tier Groq models we cascade through on TPD/429. Order = best code
// quality first, but each has its own daily token bucket — so when 120b
// drains, 20b's 500K bucket is still untouched, etc. Maverick + Kimi K2
// stay out of the cascade because they're paid-only on this account.
const GROQ_CASCADE = [
  "openai/gpt-oss-120b",                  // 200K TPD, best free code
  "meta-llama/llama-4-scout-17b-16e-instruct", // 30K TPM, fast, decent
  "openai/gpt-oss-20b",                   // 500K TPD, smaller but fresh bucket
];

// Per-file write call: ~2K input prompt + 3.5K output = 5.5K tokens.
// Serial writes (parallel=1) + 2.5s sleep keeps us well under the 30K-TPM
// sliding cap even when the plan call is fresh in the same window.
// 10 files × 5.5K + plan 4K = 59K tokens but spread over ~30s = ~110K/min raw,
// so the sliding window naturally drains between batches.
// Codegen used to write 1-at-a-time + 2.5s sleep to avoid Groq's 30K TPM
// ceiling. With Cerebras + DeepSeek + OpenRouter now in the cascade (each
// on independent quotas, sub-second latency for Cerebras), the TPM bottleneck
// disappears — bump to 3-wide writes + 600ms sleep so 12-file clones land
// well under Vercel's 90s ceiling instead of timing out on Uber/Claude/etc.
const WRITE_PARALLEL = 3;
const BATCH_SLEEP_MS = 600;

/**
 * Send a JSON-mode completion to Groq. Throws on non-2xx so the caller can
 * decide to fall back to Mistral.
 */
async function groqOnceJson(
  prompt: string,
  system: string,
  maxTokens: number,
  model: string,
): Promise<string> {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      temperature: 0.4,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    throw new Error(`groq ${model} ${r.status}: ${errText.slice(0, 240)}`);
  }
  const j = (await r.json()) as { choices: Array<{ message: { content: string } }> };
  return j.choices[0]?.message?.content ?? "";
}

/**
 * Try every Groq model in the cascade before declaring Groq dead. Each model
 * has its own TPD bucket on the org, so when 120b 429s the 20b bucket is
 * often still completely fresh — no need to cross-cloud-providers yet.
 */
async function groqJson(prompt: string, system: string, maxTokens: number): Promise<string> {
  let lastErr: Error | null = null;
  for (const model of GROQ_CASCADE) {
    try {
      return await groqOnceJson(prompt, system, maxTokens, model);
    } catch (e) {
      lastErr = e as Error;
      const msg = (lastErr.message || "").toLowerCase();
      // Only cascade on rate-limit / quota / model-unavailable. For 4xx/5xx
      // that are genuine prompt errors, stop and let the outer cascade try
      // a different provider entirely.
      if (!/429|rate|quota|tokens per day|tpd|does not exist|access|503/.test(msg)) {
        throw lastErr;
      }
      console.warn(`[codegen] groq model ${model} ${msg.slice(0, 80)} — trying next groq model`);
    }
  }
  throw lastErr ?? new Error("all groq models failed");
}

/**
 * Gemini 2.5 Flash fallback — Google's free-tier model, strong JSX, strong code.
 * Different provider + different rate-limit bucket than Groq. Used as the FIRST
 * fallback because its code quality beats Mistral-small for clone work.
 */
async function geminiJson(
  prompt: string,
  system: string,
  maxTokens: number,
): Promise<string> {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!key) throw new Error("no Gemini key — set GOOGLE_GENERATIVE_AI_API_KEY to enable fallback");
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // Gemini doesn't take a separate system role; prepend system to the user content.
        contents: [
          { role: "user", parts: [{ text: `${system}\n\n${prompt}` }] },
        ],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: maxTokens,
          responseMimeType: "application/json",
        },
      }),
    },
  );
  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    throw new Error(`gemini ${r.status}: ${errText.slice(0, 240)}`);
  }
  const j = (await r.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw new Error("gemini: empty response");
  return text;
}

/**
 * OpenRouter — aggregator for ~50 free models including qwen3-coder,
 * llama-3.3-70b, hermes-3-405b, gpt-oss-120b, deepseek-v3, glm-4.5-air, etc.
 * Single endpoint, many model choices. Set OPENROUTER_API_KEY (free tier
 * at openrouter.ai) and the cascade picks it up.
 *
 * Default routes to qwen-3-coder (best free coder on the platform per
 * benchmarks). Caller can override via the optional model arg.
 */
async function openRouterJson(
  prompt: string,
  system: string,
  maxTokens: number,
  model = "qwen/qwen-3-coder:free",
): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("no OpenRouter key — set OPENROUTER_API_KEY to enable");
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      // OpenRouter requires HTTP-Referer or X-Title for app identification.
      "HTTP-Referer": "https://delrio.vercel.app",
      "X-Title": "DelOS Codebase Builder",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      temperature: 0.4,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    throw new Error(`openrouter ${r.status}: ${errText.slice(0, 240)}`);
  }
  const j = (await r.json()) as { choices: Array<{ message: { content: string } }> };
  return j.choices[0]?.message?.content ?? "";
}

/**
 * Cerebras free inference — extremely fast (sub-second per file). Set
 * CEREBRAS_API_KEY (free tier at cerebras.ai). llama-3.3-70b is the
 * default — better code quality than gpt-oss-20b, comparable to gpt-oss-120b.
 */
async function cerebrasJson(
  prompt: string,
  system: string,
  maxTokens: number,
  model = "llama-3.3-70b",
): Promise<string> {
  const key = process.env.CEREBRAS_API_KEY;
  if (!key) throw new Error("no Cerebras key — set CEREBRAS_API_KEY to enable");
  const r = await fetch("https://api.cerebras.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      temperature: 0.4,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    throw new Error(`cerebras ${r.status}: ${errText.slice(0, 240)}`);
  }
  const j = (await r.json()) as { choices: Array<{ message: { content: string } }> };
  return j.choices[0]?.message?.content ?? "";
}

/**
 * Together AI — $25 free trial credit, OpenAI-compatible. Many free models
 * including deepseek-coder, qwen2.5-coder, llama-3.3-70b. Set
 * TOGETHER_API_KEY to enable.
 */
async function togetherJson(
  prompt: string,
  system: string,
  maxTokens: number,
  model = "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free",
): Promise<string> {
  const key = process.env.TOGETHER_API_KEY;
  if (!key) throw new Error("no Together key — set TOGETHER_API_KEY to enable");
  const r = await fetch("https://api.together.xyz/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      temperature: 0.4,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    throw new Error(`together ${r.status}: ${errText.slice(0, 240)}`);
  }
  const j = (await r.json()) as { choices: Array<{ message: { content: string } }> };
  return j.choices[0]?.message?.content ?? "";
}

/**
 * DeepSeek — OpenAI-compatible at api.deepseek.com. Free tier sub-cent
 * pricing, very strong code (deepseek-chat / deepseek-coder). Set
 * DEEPSEEK_API_KEY to enable.
 */
async function deepseekJson(
  prompt: string,
  system: string,
  maxTokens: number,
  model = "deepseek-chat",
): Promise<string> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("no DeepSeek key — set DEEPSEEK_API_KEY to enable");
  const r = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      temperature: 0.4,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    throw new Error(`deepseek ${r.status}: ${errText.slice(0, 240)}`);
  }
  const j = (await r.json()) as { choices: Array<{ message: { content: string } }> };
  return j.choices[0]?.message?.content ?? "";
}

/**
 * Mistral fallback — last resort. Different provider, different rate-limit
 * bucket. mistral-small-latest is free-tier, JSON-mode supported, ok code.
 */
async function mistralJson(
  prompt: string,
  system: string,
  maxTokens: number,
): Promise<string> {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) throw new Error("no Mistral key — set MISTRAL_API_KEY to enable fallback");
  const r = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "mistral-small-latest",
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      temperature: 0.4,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    throw new Error(`mistral ${r.status}: ${errText.slice(0, 240)}`);
  }
  const j = (await r.json()) as { choices: Array<{ message: { content: string } }> };
  return j.choices[0]?.message?.content ?? "";
}

/**
 * Single entry point. Provider order (best free code quality first):
 *   1. Gemini 2.5 Flash — Google free tier, 1M tokens/day, strong JSX + clones
 *   2. Groq scout-17b   — 30K TPM, fast, fine for simpler files
 *   3. Mistral small    — last resort
 *
 * Each provider gets one shot. On any failure (429, schema reject, network),
 * we cascade to the next provider so the user gets a result rather than an
 * error message. Only when ALL THREE fail do we surface the original error.
 */
async function llmJson(prompt: string, system: string, maxTokens: number): Promise<string> {
  // Cascade order: Groq family (sub-model cascade inside) → Cerebras
  // (sub-second 70B) → OpenRouter free models → Gemini → Together AI free
  // tier → Mistral small (last resort). Each provider lives in its own
  // rate-limit bucket on its own org, so a TPD-drained Groq doesn't bleed
  // into Cerebras / Together. The codegen pipeline keeps going through
  // EVERY available free model before surfacing an error.
  const providers: Array<{ name: string; call: () => Promise<string> }> = [
    // Cerebras llama-3.3-70b — sub-second inference, the only way 12-file
    // clones land under Vercel's 90s function ceiling. Used to be position
    // #2 but Groq's 200-1000ms latency + sleep was timing out Uber / Claude
    // clones at the WRITE pass. Cerebras leads now.
    { name: "cerebras",   call: () => cerebrasJson(prompt, system, maxTokens) },
    { name: "groq",       call: () => groqJson(prompt, system, maxTokens) },
    // DeepSeek deepseek-chat — best code quality of any free-tier provider
    // in our benchmark. Strong second option before falling to OpenRouter.
    { name: "deepseek",   call: () => deepseekJson(prompt, system, maxTokens) },
    // OpenRouter qwen-3-coder — coder specialist. Pricier latency
    // than Groq but better JSX quality.
    { name: "openrouter", call: () => openRouterJson(prompt, system, maxTokens) },
    { name: "gemini",     call: () => geminiJson(prompt, system, Math.max(maxTokens, 6000)) },
    { name: "together",   call: () => togetherJson(prompt, system, maxTokens) },
    { name: "mistral",    call: () => mistralJson(prompt, system, maxTokens) },
  ];
  let lastErr: Error | null = null;
  for (const p of providers) {
    try {
      const raw = await p.call();
      // Validate JSON before returning — invalid JSON cascades to next provider.
      try {
        JSON.parse(raw);
        return raw;
      } catch (parseErr) {
        const reason = (parseErr as Error).message.slice(0, 80);
        console.warn(`[codegen] ${p.name} returned invalid JSON (${reason}), cascading`);
        lastErr = new Error(`${p.name} invalid JSON: ${reason}`);
      }
    } catch (e) {
      lastErr = e as Error;
      const m = (lastErr.message || "").toLowerCase();
      // Skip silently when a provider key is unset — that's expected for
      // free deploys where the user only configured 2-3 of the 6 providers.
      if (/^no \w+ key/.test(lastErr.message)) {
        console.info(`[codegen] ${p.name} skipped — ${lastErr.message.slice(0, 80)}`);
        continue;
      }
      console.warn(`[codegen] ${p.name} failed: ${m.slice(0, 120)}`);
    }
  }
  throw lastErr ?? new Error("all providers failed");
}

export const runtime = "nodejs";
export const maxDuration = 90;

const bodySchema = z.object({
  prompt: z.string().min(5).max(800),
  stack: z.enum(["nextjs", "react-vite", "node-api"]).optional(),
  tenantId: z.string().min(1).max(120).optional(),
});

// Each file can be up to 20K chars (~5KB of code, ~600 lines). The old 8K cap
// forced the model to write hello-world-tier code; 20K lets it ship real
// components with state, mock data, and styling.
const fileSchema = z.object({
  path: z.string().min(1).max(200),
  content: z.string().min(1).max(20000),
  language: z.enum(["typescript", "javascript", "tsx", "jsx", "css", "json", "markdown", "html", "text"]).optional(),
});

const projectSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(400),
  stack: z.string().min(1).max(80),
  files: z.array(fileSchema).min(2).max(20),
  runInstructions: z.string().max(600).optional(),
  notes: z.array(z.string().max(240)).max(8).optional(),
});

export type CodegenProject = z.infer<typeof projectSchema>;

// Plan-call schema — model returns the file blueprint, not the code itself.
// Language is a soft string (we normalize before final fileSchema) so model
// quirks ("ts" vs "typescript") don't blow up the plan stage.
const planSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(400),
  stack: z.string().min(1).max(80),
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(200),
        purpose: z.string().min(3).max(400),
        language: z.string().max(40).optional(),
      }),
    )
    .min(3)
    .max(15),
  runInstructions: z.string().max(600).optional(),
  notes: z.array(z.string().max(240)).max(8).optional(),
});

// Normalize variant language strings the model emits ("ts", "react", etc.)
// into our canonical enum used by the viewer.
type CanonLang = "typescript" | "javascript" | "tsx" | "jsx" | "css" | "json" | "markdown" | "html" | "text";
function normalizeLanguage(raw: string | undefined, path: string): CanonLang {
  const r = (raw ?? "").toLowerCase().trim();
  const byPath = (() => {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "tsx") return "tsx";
    if (ext === "ts") return "typescript";
    if (ext === "jsx") return "jsx";
    if (ext === "js" || ext === "mjs" || ext === "cjs") return "javascript";
    if (ext === "css") return "css";
    if (ext === "json") return "json";
    if (ext === "md" || ext === "markdown") return "markdown";
    if (ext === "html" || ext === "htm") return "html";
    return null;
  })();
  if (byPath) return byPath;
  if (r === "ts" || r === "typescript") return "typescript";
  if (r === "tsx" || r === "react-ts") return "tsx";
  if (r === "js" || r === "javascript") return "javascript";
  if (r === "jsx" || r === "react-js") return "jsx";
  if (r === "css" || r === "scss") return "css";
  if (r === "json") return "json";
  if (r === "md" || r === "markdown") return "markdown";
  if (r === "html") return "html";
  return "text";
}

type FilePlan = z.infer<typeof planSchema>;

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const lim = rateLimit(`codegen:ip:${ip}`, CODEGEN_LIMIT_PER_MIN, CODEGEN_WINDOW_MS);
  if (!lim.ok) {
    return Response.json(
      { ok: false, error: "Codegen rate limit. Try again in a minute." },
      { status: 429, headers: lim.headers },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return zodErr(parsed.error);
  }
  const userPrompt = parsed.data.prompt;
  const stack = parsed.data.stack ?? "nextjs";
  const tenantId = parsed.data.tenantId || env.DELRIO_TENANT_ID;

  const stackHint =
    stack === "nextjs"
      ? "Next.js 16 App Router + React 19 + TypeScript + Tailwind v4 + Server Components where useful + Route Handlers under app/api/*/route.ts"
      : stack === "react-vite"
        ? "React 18 + Vite + TypeScript + Tailwind"
        : "Node.js 22 + TypeScript + Hono/Express for API only (no frontend)";

  // Detect whether the user explicitly named a product/brand to clone.
  // If they did → high-fidelity brand-match mode. If they didn't → generic
  // app mode (clean modern design, NOT a brand pastiche). Same plan path,
  // different framing — the old prompt was hardcoded brand-mode which made
  // a "Pomodoro timer landing page" come out with PrimeBadge + FocusPicker
  // components leaked in from the Amazon/Perplexity training examples.
  const brandPatterns = /\b(amazon|perplexity|chatgpt|claude|gpt|uber|lyft|netflix|disney|hulu|prime\s*video|twitter|x\.com|github|gitlab|youtube|spotify|apple\s*music|airbnb|stripe|notion|slack|figma|discord|tinder|bumble|robinhood|coinbase|linear|miro|google|gmail|microsoft|teams|zoom|tiktok|instagram|whatsapp|telegram|reddit|hacker\s*news|hn|product\s*hunt|vercel|netlify|cloudflare|aws|gcp|azure|openai)\b/i;
  const isBrandClone = brandPatterns.test(userPrompt);

  try {
    // --- PASS 1: PLAN ---
    // Ask the model to lay out the file structure with a short brief for each.
    // No actual code yet — the brief is what each WRITE call gets as context.
    const planPrompt = isBrandClone
      ? `You are a senior staff engineer planning a SAME-TO-SAME clone of the specific real product named in the user request below.

USER REQUEST:
${userPrompt}

STACK: ${stackHint}

This must look like THE EXACT product named above — not a generic prototype, and NEVER a different product. If the user said "Pomodoro" do not invent Amazon components; if they said "Amazon" do not invent ChatGPT components.

- HONOR every color/layout/copy detail in the user request — exact hex codes the user specified, exact section names they listed, exact nav structure.
- Match THIS brand's visual hierarchy: hero shape, header strip, sidebar widths, button styling, typography weights.
- Mock data must use THIS product's conventions only. Don't blend conventions from other products.
- 10+ realistic items per list — real-shaped names, prices, descriptions tailored to the target product.
- Interactive components with state: forms, modals, search filters, like buttons, dropdowns, tabs.
- Inline-mocked services (no external APIs needed) so the project runs standalone.`
      : `You are a senior staff engineer planning a polished, working web app from the user's brief.

USER REQUEST:
${userPrompt}

STACK: ${stackHint}

This is a GENERIC app (no specific brand named). Design it with a clean, modern aesthetic — do NOT copy Amazon, Perplexity, ChatGPT, Claude, Uber, or any other product's chrome unless the user asked for it. Pick an appropriate color palette for the app's purpose and use it consistently.

- Component names must describe the THIS app's domain, not be lifted from other products. If the user asked for a Pomodoro timer, the components are Timer/SessionList/SettingsPanel — NOT PrimeBadge, RecommendationRail, or FocusPicker.
- Match the app's purpose with the right primitives: a productivity app uses checklists/timers/streaks; a marketing landing page uses hero/features/CTA/footer; an analytics tool uses charts/filters/metric cards.
- Mock data must be domain-appropriate (timer session logs for a Pomodoro app; not "Sponsored product" rows).
- 6+ realistic items per list, written in the app's voice.
- Interactive components with state, real handlers, no stubs.
- Inline mocks only; runs standalone.`;

    // Shared output contract appended to whichever framing branch ran above.
    // Prior version left this text outside the template literal — Turbopack
    // raised "Expected ';', '}' or <eof>" and the Vercel build failed silently
    // (last live deploy stuck on commit prior to the brand-mode split).
    const planPromptFull = planPrompt + `

Output the FILE PLAN — 8 to 14 files. For each file:
- path : exact path including extension (e.g. "app/page.tsx", "app/components/MapMock.tsx")
- purpose : 2–4 sentence brief of what this file contains, what it exports, what state it owns, what it imports from sibling files. Be SPECIFIC — name the props, state shape, mock data structure. The writer agent will use this brief verbatim.
- language : tsx | ts | css | json | markdown

Always include:
- app/page.tsx — top-level page wiring components together
- A README.md at the end with feature list + run instructions

Return JSON only:
{
  "name": "uber-clone",
  "description": "Working Uber ride-share prototype: map mock, fare estimator, driver list, trip booking flow.",
  "stack": "Next.js 16 / React 19 / TS / Tailwind v4",
  "files": [
    { "path": "app/page.tsx", "purpose": "Top-level page. Renders Hero, MapBlock, FareEstimator, DriverList, RecentTrips. Imports state from useTripState hook. No top-level state.", "language": "tsx" },
    ...
  ],
  "runInstructions": "npm install && npm run dev",
  "notes": ["mocks map + stripe inline"]
}`;

    const sysPlan = "Respond with ONE JSON object only. No prose. No markdown fences.";
    let plan: FilePlan | null = null;
    try {
      const rawPlan = await llmJson(planPromptFull, sysPlan, 4000);
      const obj = JSON.parse(rawPlan);
      const v = planSchema.safeParse(obj);
      if (v.success) plan = v.data;
      else throw new Error(`plan schema: ${v.error.message.slice(0, 200)}`);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("429") || msg.includes("Rate limit")) {
        throw new Error("Both Groq + Mistral hit rate limit on the plan call. Try again in ~60 seconds, or use a shorter prompt.");
      }
      throw new Error(`plan failed: ${msg.slice(0, 200)}`);
    }

    // --- PASS 2: WRITE each file ---
    // Each file gets its own focused call with the full plan as context + the
    // file's specific brief. Output goes into the projectSchema.files array.
    async function writeFile(planEntry: FilePlan["files"][number], allFiles: FilePlan["files"]): Promise<z.infer<typeof fileSchema>> {
      const siblings = allFiles
        .filter((f) => f.path !== planEntry.path)
        .map((f) => `  - ${f.path}: ${f.purpose}`)
        .join("\n");

      const writePrompt = `You are writing ONE file in a multi-file project. The file plan was decided already — you only write THIS file's source.

PROJECT: ${plan!.name} — ${plan!.description}
STACK: ${plan!.stack}
USER REQUEST: ${userPrompt}

SIBLING FILES (for import paths and contract awareness):
${siblings}

THE FILE YOU MUST WRITE:
Path: ${planEntry.path}
Purpose: ${planEntry.purpose}
Language: ${planEntry.language ?? "tsx"}

RULES (strict):
- ${isBrandClone
        ? "SAME-TO-SAME clone of the specific product named in the user request. Match exact colors (hex codes from the user request), exact layout proportions, exact copy from THAT product only. Do not blend in chrome from other products."
        : "Generic polished app — match the user's described domain. Do NOT add brand-specific chrome (\"Prime\", \"Reply to Claude\", \"Ask anything\", etc.) unless the user explicitly asked for that product. Component copy must match THIS app's purpose."}
- Write COMPLETE, syntactically valid code. No \`...\` ellipses, no \`// TODO\`, no \`/* implement later */\`, no \`throw new Error("not implemented")\`.
- JSX hygiene (Sandpack will fail otherwise): EVERY JSX attribute must have an explicit value — \`alt=""\` not \`alt=\`, \`disabled={true}\` not \`disabled=\`. Map keys must be unique strings or stable ids, not duplicated values. Close every tag. No stray commas in arrays. No trailing commas after JSX attrs.
- EXPORT RULE (Sandpack default-import resolution): every component file MUST use \`export default function ComponentName(...)\`. Sibling files import via \`import ComponentName from "./ComponentName"\` (default import). Do NOT use named exports for components. Mixing default + named breaks resolution and the preview shows "Element type is invalid: expected a string ... but got: object".
- Real working code: actual JSX, actual handlers, actual state, actual mock data.
- 200–600 lines is the sweet spot for a component file. README can be shorter.
- Inline mock data should be RICH and BRAND-AUTHENTIC (10+ items). Amazon → real-product-shaped names + prices + star ratings; ChatGPT → realistic chat titles; Perplexity → real-looking source URLs with favicon emoji; Claude → conversational starter phrases.
- Tailwind v4 utility classes for styling. Use exact hex codes inline with arbitrary values \`bg-[#FF9900]\` when the product's brand color is specified.
- Imports from siblings must use exact relative paths (./ComponentName, ../lib/hookName).
- ESCAPE all newlines as \\n and double-quotes as \\" inside the JSON string value.

Output JSON only:
{
  "path": "${planEntry.path}",
  "content": "...escaped file source...",
  "language": "${planEntry.language ?? "tsx"}"
}`;

      const sysWrite = "Respond with ONE JSON object only. No prose, no markdown fences, no commentary. Write production-quality code — real handlers, real state, real mock data, never stubs.";
      // 4500 max_tokens gives ~3.5KB of code per file. 2 in parallel keeps
      // total TPM under 13K so we don't trip Groq's 30K-per-minute ceiling.
      // 3500 max_tokens per file — tight enough to fit several writes in a
      // single TPM window even if the fallback kicks in.
      const raw = await llmJson(writePrompt, sysWrite, 3500);
      const obj = JSON.parse(raw) as { path?: string; content?: string; language?: string };
      // Normalize the language before Zod-validating so model variant strings
      // ("ts", "react-ts", missing) don't fail the enum.
      const normalized = {
        path: obj.path ?? planEntry.path,
        content: obj.content ?? "",
        language: normalizeLanguage(obj.language, obj.path ?? planEntry.path),
      };
      const v = fileSchema.safeParse(normalized);
      if (!v.success) {
        return {
          path: planEntry.path,
          content: `// codegen could not write this file: ${v.error.message.slice(0, 200)}\n// brief: ${planEntry.purpose}\n`,
          language: normalizeLanguage(planEntry.language, planEntry.path),
        };
      }
      return v.data;
    }

    // Fan out writes in batches of WRITE_PARALLEL to stay under Groq's TPM cap.
    // Sleep BATCH_SLEEP_MS between batches so the sliding-window TPM drains.
    const fileResults: Array<z.infer<typeof fileSchema>> = [];
    for (let i = 0; i < plan.files.length; i += WRITE_PARALLEL) {
      if (i > 0) await new Promise((r) => setTimeout(r, BATCH_SLEEP_MS));
      const batch = plan.files.slice(i, i + WRITE_PARALLEL);
      const settled = await Promise.allSettled(batch.map((f) => writeFile(f, plan!.files)));
      for (let j = 0; j < settled.length; j++) {
        const result = settled[j];
        if (result.status === "fulfilled") {
          fileResults.push(result.value);
        } else {
          const reason = String(result.reason).slice(0, 200);
          // Treat catastrophic per-file failure as a stub so the project still
          // ships partially. 429 inside a parallel batch usually means we
          // overshot TPM — bail to the friendly message.
          if (reason.includes("429") || reason.includes("Rate limit")) {
            throw new Error("Both Groq + Mistral hit rate limit mid-write. Try again in ~60 seconds.");
          }
          fileResults.push({
            path: batch[j].path,
            content: `// codegen write failed: ${reason}\n// brief: ${batch[j].purpose}\n`,
            // Normalize, otherwise the model's raw language string ("react-ts",
            // "react", etc.) from the plan stage flows straight into the final
            // projectSchema enum and fails validation. Bit me on Perplexity.
            language: normalizeLanguage(batch[j].language, batch[j].path),
          });
        }
      }
    }

    const project: z.infer<typeof projectSchema> = {
      name: plan.name,
      description: plan.description,
      stack: plan.stack,
      files: fileResults,
      runInstructions: plan.runInstructions,
      notes: plan.notes,
    };

    // Validate final shape (Zod should pass — fileResults already pass fileSchema).
    const finalParse = projectSchema.safeParse(project);
    if (!finalParse.success) {
      throw new Error(`final schema: ${finalParse.error.message.slice(0, 200)}`);
    }

    await safeAddMemory({
      tenantId,
      text: `Codegen project "${project.name}" — ${project.files.length} files. Prompt: ${userPrompt.slice(0, 160)}`,
      metadata: {
        runId: "codegen",
        tags: ["codegen", "app-build"],
        projectName: project.name,
        fileCount: project.files.length,
      },
    });
    return Response.json({ ok: true, project });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
