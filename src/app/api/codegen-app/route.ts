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

// Codegen is the heaviest paid path. Cap to keep one attacker from draining
// the shared Groq TPM budget. 6/min is well above a legit user's cadence;
// the 429 below already kicks in earlier when Groq TPM is hit.
const CODEGEN_LIMIT_PER_MIN = 6;
const CODEGEN_WINDOW_MS = 60_000;

// Default model: Moonshot Kimi K2 (256B params, instruct-0905).
// Best free-tier code generator on Groq right now — beats scout-17b /
// maverick-17b / gpt-oss-120b on JSX validity + same-to-same product matching.
// 60K TPM ceiling on Groq free tier (2× scout's 30K), so the two-pass plan +
// write fan-out has more headroom too.
const DEFAULT_MODEL = "moonshotai/kimi-k2-instruct-0905";

// Per-file write call: ~2K input prompt + 3.5K output = 5.5K tokens.
// Serial writes (parallel=1) + 2.5s sleep keeps us well under the 30K-TPM
// sliding cap even when the plan call is fresh in the same window.
// 10 files × 5.5K + plan 4K = 59K tokens but spread over ~30s = ~110K/min raw,
// so the sliding window naturally drains between batches.
const WRITE_PARALLEL = 1;
const BATCH_SLEEP_MS = 2500;

/**
 * Send a JSON-mode completion to Groq. Throws on non-2xx so the caller can
 * decide to fall back to Mistral.
 */
async function groqJson(
  prompt: string,
  system: string,
  maxTokens: number,
  model: string = DEFAULT_MODEL,
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
    throw new Error(`groq ${r.status}: ${errText.slice(0, 240)}`);
  }
  const j = (await r.json()) as { choices: Array<{ message: { content: string } }> };
  return j.choices[0]?.message?.content ?? "";
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
 * Single entry point: try Groq (Kimi K2), on 429 fall to Gemini 2.5 Flash,
 * then Mistral small. Gemini beats Mistral on JSX validity + product
 * accuracy so it's first in the fallback chain. Anything other than rate-
 * limit propagates the original error so genuine schema failures don't
 * silently retry against three providers.
 */
async function llmJson(prompt: string, system: string, maxTokens: number): Promise<string> {
  const isRate = (msg: string) => msg.includes("429") || /rate.?limit/i.test(msg) || msg.includes("Too Many Requests");
  try {
    return await groqJson(prompt, system, maxTokens);
  } catch (e) {
    const msg = (e as Error).message || "";
    if (!isRate(msg)) throw e;
    console.warn("[codegen] Groq 429, falling to Gemini");
    try {
      return await geminiJson(prompt, system, maxTokens);
    } catch (e2) {
      const msg2 = (e2 as Error).message || "";
      if (!isRate(msg2)) throw e2;
      console.warn("[codegen] Gemini 429, falling to Mistral");
      return await mistralJson(prompt, system, maxTokens);
    }
  }
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
    return Response.json({ error: parsed.error.message }, { status: 400 });
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

  try {
    // --- PASS 1: PLAN ---
    // Ask the model to lay out the file structure with a short brief for each.
    // No actual code yet — the brief is what each WRITE call gets as context.
    const planPrompt = `You are a senior staff engineer planning a SAME-TO-SAME clone of a real product.

USER REQUEST:
${userPrompt}

STACK: ${stackHint}

This must look like the real product, not a generic prototype. Specifically:
- HONOR every color/layout/copy detail in the user request — exact hex codes, exact section names ("Prime badge", "Recommendation rail", "Focus picker"), exact nav structure.
- Match the brand's visual hierarchy: hero shape, header strip, sidebar widths, button styling, typography weights.
- Mock data must use the product's CONVENTIONS: Amazon → product titles + 4.5-star ratings + "Sponsored" labels; ChatGPT → "Today / Yesterday / Previous 7 Days" buckets; Perplexity → numbered [1][2][3] citations + sources panel; Claude → conversation chips + Anthropic burnt orange.
- 10+ realistic items per list — real product names, prices, descriptions.
- Interactive components with state: forms, modals, search filters, like buttons, dropdowns, tabs.
- Inline-mocked services (no external APIs needed) so the project runs standalone.

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
      const rawPlan = await llmJson(planPrompt, sysPlan, 4000);
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
- SAME-TO-SAME clone. Match the real product's exact colors (hex codes from the user request), exact layout proportions, exact copy ("Prime", "Sponsored", "Reply to Claude", "Ask anything", etc.).
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
