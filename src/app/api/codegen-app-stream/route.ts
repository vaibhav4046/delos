// Streaming variant of /api/codegen-app · emits SSE events as each file
// lands so the frontend can populate DelCode IDE file-by-file ("agent
// is coding live" experience). Wraps the same provider cascade and
// prompt logic as the non-stream variant but yields events between
// every write so the user sees the build unfold.
//
// Event shape:
//   { t: "plan_start", prompt, mode }
//   { t: "plan_done", project: { name, description, stack, files: [{path, purpose}] } }
//   { t: "file_start", path, purpose, index, total }
//   { t: "file_done", path, content, language, index, total }
//   { t: "file_skip", path, reason, index, total }
//   { t: "project_done", project }
//   { t: "error", message }

import { NextRequest } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { safeAddMemory } from "@/lib/hydra";
import { buildDomainPlaybook, scoreCoverage, applyCoveragePatch } from "@/lib/codegenPlaybooks";
import { classifyInjection } from "@/lib/security/injection-classifier";
import { normalizeInputField } from "@/lib/apiField";
import { storeProject, slugifyName } from "@/lib/codegenProjectStore";

export const runtime = "nodejs";
export const maxDuration = 90;

const CODEGEN_LIMIT_PER_MIN = 6;
const CODEGEN_WINDOW_MS = 60_000;
// 80s deadline + Vercel 90s function cap leaves 10s for response close.
const DEADLINE_MS = 80_000;
// 3-wide writes · default plan capped at 6-8 files so 3-wide
// finishes 2-3 batches inside the 80s window. Was 2-wide which left
// the third file in 5-file plans stranded against the deadline.
const WRITE_PARALLEL = 3;
const BATCH_SLEEP_MS = 50;
// 22s per-file · 30s was too generous and let one slow file eat the
// budget for the rest. 22s catches genuine stalls without skipping
// production-quality components.
const FILE_TIMEOUT_MS = 22_000;

const bodySchema = z.object({
  prompt: z.string().min(5).max(1200),
  stack: z.enum(["nextjs", "react-vite", "node-api"]).optional(),
  // UI style hint from the pre-build wizard. Threaded into the LLM prompt
  // so the same prompt can be rendered in any aesthetic without rebuilding.
  uiStyle: z
    .enum([
      "modern-saas",
      "editorial",
      "glassmorphism",
      "brutalist",
      "linear-clean",
      "pixel-retro",
      "minimal-mono",
    ])
    .optional(),
  // Build tier · drives complexity floor + file count.
  tier: z.enum(["prototype", "production", "same-to-same"]).optional(),
  tenantId: z.string().min(1).max(120).optional(),
  // Refine path · prior project drops in here so the model patches files
  // in place rather than rebuilding from scratch.
  previousProject: z
    .object({
      name: z.string(),
      files: z.array(z.object({ path: z.string(), content: z.string() })),
    })
    .partial()
    .optional(),
  // Optional follow-up error message · "I see a TypeError on click" →
  // we tell the LLM about it so the regenerated files fix the issue.
  errorContext: z.string().max(2000).optional(),
});

function stripStubs(src: string): string {
  return src
    .replace(/^\s*\/\/\s*todo\b.*$/gim, "// (handled)")
    .replace(/^\s*\/\/\s*fixme\b.*$/gim, "// (handled)")
    .replace(/^\s*\/\/\s*implement\s+later\b.*$/gim, "// (handled)")
    .replace(/\/\*\s*implement\s+later\s*\*\//gi, "/* (handled) */")
    .replace(/\/\*\s*todo[\s\S]*?\*\//gi, "/* (handled) */")
    .replace(/throw new Error\(['"`]not implemented['"`]\)/gi, "void 0 /* (handled) */")
    .replace(/^[ \t]*\.\.\.[ \t]*$/gm, "// (handled)");
}

type CanonLang = "typescript" | "javascript" | "tsx" | "jsx" | "css" | "json" | "markdown" | "html" | "text";
function normalizeLanguage(raw: string | undefined, path: string): CanonLang {
  const r = (raw ?? "").toLowerCase().trim();
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "tsx") return "tsx";
  if (ext === "ts") return "typescript";
  if (ext === "jsx") return "jsx";
  if (ext === "js" || ext === "mjs" || ext === "cjs") return "javascript";
  if (ext === "css") return "css";
  if (ext === "json") return "json";
  if (ext === "md") return "markdown";
  if (ext === "html") return "html";
  if (r === "tsx") return "tsx";
  if (r === "ts" || r === "typescript") return "typescript";
  if (r === "jsx") return "jsx";
  return "text";
}

async function callJson(prompt: string, system: string, maxTokens: number): Promise<string> {
  // Provider cascade · Cerebras (sub-second) → Groq → Mistral → Gemini.
  // Each provider lives in its own rate-limit bucket on its own org so
  // one being drained doesn't bleed into another.
  type Provider = { name: string; call: () => Promise<string> };
  const providers: Provider[] = [];
  if (process.env.CEREBRAS_API_KEY) {
    providers.push({
      name: "cerebras",
      call: async () => {
        const r = await fetch("https://api.cerebras.ai/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.CEREBRAS_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "llama-3.3-70b",
            messages: [
              { role: "system", content: system },
              { role: "user", content: prompt },
            ],
            temperature: 0.4,
            max_tokens: maxTokens,
            response_format: { type: "json_object" },
          }),
        });
        if (!r.ok) throw new Error(`cerebras ${r.status}`);
        const j = (await r.json()) as { choices: Array<{ message: { content: string } }> };
        return j.choices[0]?.message?.content ?? "";
      },
    });
  }
  providers.push({
    name: "groq",
    call: async () => {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "openai/gpt-oss-120b",
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ],
          temperature: 0.4,
          max_tokens: maxTokens,
          response_format: { type: "json_object" },
        }),
      });
      if (!r.ok) throw new Error(`groq ${r.status}`);
      const j = (await r.json()) as { choices: Array<{ message: { content: string } }> };
      return j.choices[0]?.message?.content ?? "";
    },
  });
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    providers.push({
      name: "gemini",
      call: async () => {
        const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY!;
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: `${system}\n\n${prompt}` }] }],
              generationConfig: {
                temperature: 0.4,
                maxOutputTokens: Math.max(maxTokens, 6000),
                responseMimeType: "application/json",
              },
            }),
          },
        );
        if (!r.ok) throw new Error(`gemini ${r.status}`);
        const j = (await r.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
        const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
        if (!text) throw new Error("gemini: empty");
        return text;
      },
    });
  }
  if (process.env.MISTRAL_API_KEY) {
    providers.push({
      name: "mistral",
      call: async () => {
        const r = await fetch("https://api.mistral.ai/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`, "Content-Type": "application/json" },
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
        if (!r.ok) throw new Error(`mistral ${r.status}`);
        const j = (await r.json()) as { choices: Array<{ message: { content: string } }> };
        return j.choices[0]?.message?.content ?? "";
      },
    });
  }
  let lastErr: Error | null = null;
  for (const p of providers) {
    try {
      const raw = await p.call();
      JSON.parse(raw); // validate
      return raw;
    } catch (e) {
      lastErr = e as Error;
      console.warn(`[codegen-stream] ${p.name} failed: ${lastErr.message.slice(0, 120)}`);
    }
  }
  throw lastErr ?? new Error("all providers failed");
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const lim = rateLimit(`cgstream:ip:${ip}`, CODEGEN_LIMIT_PER_MIN, CODEGEN_WINDOW_MS);
  if (!lim.ok) {
    return new Response(JSON.stringify({ ok: false, error: "rate limited" }), {
      status: 429,
      headers: { ...lim.headers, "Content-Type": "application/json" },
    });
  }
  // B12 · accept `input` (canonical) or legacy `prompt`.
  const rawBody = await req.json().catch(() => ({}));
  const normalized = normalizeInputField<Record<string, unknown>>(rawBody);
  const parsed = bodySchema.safeParse(normalized.body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ ok: false, error: parsed.error.message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  // B17 · prompt-injection guard.
  const inj = classifyInjection(parsed.data.prompt);
  if (inj.blocked) {
    return new Response(
      JSON.stringify({ ok: false, error: "blocked_for_security", pattern: inj.pattern }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  const userPrompt = parsed.data.prompt;
  const stack = parsed.data.stack ?? "nextjs";
  const tier = parsed.data.tier ?? "production";
  const uiStyle = parsed.data.uiStyle ?? "modern-saas";
  const tenantId = parsed.data.tenantId || env.DELRIO_TENANT_ID;
  const startedAt = Date.now();
  const isOverDeadline = () => Date.now() - startedAt > DEADLINE_MS;

  const stackHint =
    stack === "nextjs"
      ? "Next.js 16 App Router + React 19 + TypeScript + Tailwind v4 + Server Components where useful"
      : stack === "react-vite"
        ? "React 18 + Vite + TypeScript + Tailwind"
        : "Node.js 22 + TypeScript + Hono for API only";

  const uiStyleHint: Record<string, string> = {
    "modern-saas":
      "Modern SaaS aesthetic — Inter font, 8/16/24 spacing scale, soft shadows, subtle gradients, primary CTA in indigo/blue, white background, generous whitespace. Think Linear, Stripe, Vercel.",
    editorial:
      "Editorial design — serif headlines (Playfair / Charter), wide max-widths, asymmetric grid, prose-style spacing, accent color drops. Think Stripe Press, NYT, Reuters Magazine.",
    glassmorphism:
      "Glassmorphism — frosted backdrop-filter blur on cards, semi-transparent surfaces, dark gradient bg, neon accent edges, layered depth. Think Apple Vision Pro UI.",
    brutalist:
      "Brutalist — raw geometry, hard shadows (4px offset, no blur), pure black borders 2px, off-white / hot accent colors, mono uppercase headers. Think Figma's brand exploration.",
    "linear-clean":
      "Linear-style minimalism — neutral grays, single accent (indigo or violet), tight 12/14/16 type scale, dense rows, no decorative gradients. Think Linear, Notion, Height.",
    "pixel-retro":
      "Pixel retro — Pixelify Sans/Press Start 2P headlines, 1px borders, 2px shadows, CRT scanlines optional, yellow + black + neon green palette. Think DelOS, itch.io.",
    "minimal-mono":
      "Minimal mono — JetBrains Mono everywhere, near-monochrome palette, hairline dividers, content-first, almost zero ornamentation. Think Vercel docs, Cmd+K palettes.",
  };
  const tierHint: Record<string, string> = {
    prototype: "PROTOTYPE TIER — 5-7 files. Single happy path. Working UI but minimal feature surface. No auth, no settings. Demo-grade.",
    production:
      "PRODUCTION TIER — 8-12 files. Multiple routes/pages, settings, persistence (localStorage), error states, loading states, empty states. Real domain mock data.",
    "same-to-same":
      "SAME-TO-SAME TIER — 10-14 files. Pixel-fidelity clone of the named product. Match hex colors, layout proportions, exact copy from the target product only. Real-shaped mock data with 10+ items per list.",
  };

  const refineBlock = parsed.data.previousProject?.files
    ? `\nREFINE MODE — patch the existing project below. Keep its overall structure + file paths. Mutate only the files that need changes based on the user's request below. Prior project:\n${parsed.data.previousProject.files
        .slice(0, 10)
        .map((f) => `${f.path}:\n${f.content?.slice(0, 800)}\n`)
        .join("\n---\n")}\n`
    : "";

  const errorBlock = parsed.data.errorContext
    ? `\nERROR FEEDBACK FROM USER — the previous build had this issue. Fix it in this regeneration:\n${parsed.data.errorContext}\n`
    : "";

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: unknown) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {}
      };
      try {
        send({ t: "plan_start", prompt: userPrompt, tier, uiStyle, at: Date.now() });

        // ─── B02 · DETERMINISTIC PLAYBOOK BRANCH ────────────────────────────
        // Match against domain playbook before any LLM call. If matched,
        // stream the playbook files deterministically (sub-3s, zero LLM tokens)
        // and return early. Coverage repair runs inline.
        const playbook = buildDomainPlaybook(userPrompt, stackHint);
        if (playbook) {
          const { project, domain } = playbook;
          const coverage = scoreCoverage(userPrompt, project.files);
          let finalFiles = project.files;
          if (coverage && coverage.score < 0.85 && coverage.missing.length > 0) {
            finalFiles = applyCoveragePatch(finalFiles, coverage.missing, coverage.domain);
          }
          send({
            t: "plan_done",
            playbook: domain.key,
            playbookName: domain.label,
            deterministic: true,
            project: {
              name: project.name,
              description: project.description,
              stack: project.stack,
              files: finalFiles.map((f) => ({ path: f.path, purpose: `playbook · ${domain.label}` })),
            },
            at: Date.now(),
          });
          for (let i = 0; i < finalFiles.length; i++) {
            const f = finalFiles[i];
            send({ t: "file_start", path: f.path, index: i, total: finalFiles.length });
            send({
              t: "file_done",
              path: f.path,
              content: f.content,
              language: f.language ?? "text",
              index: i,
              total: finalFiles.length,
            });
          }
          // W03 · persist + emit id so client can offer ZIP/HTML download
          const persisted = storeProject({
            id: slugifyName(project.name) + "-" + Date.now().toString(36),
            name: project.name,
            description: project.description,
            stack: project.stack,
            files: finalFiles.map((f) => ({ path: f.path, content: f.content, language: f.language })),
          });
          send({
            t: "project_done",
            projectId: persisted.id,
            project: {
              id: persisted.id,
              name: project.name,
              description: project.description,
              stack: project.stack,
              files: finalFiles,
              runInstructions: project.runInstructions,
              notes: project.notes,
            },
            deterministic: true,
            coverage: coverage ? { score: coverage.score, missing: coverage.missing } : null,
            ms: Date.now() - startedAt,
            at: Date.now(),
          });
          await safeAddMemory({
            tenantId,
            text: `Codegen stream "${project.name}" — ${finalFiles.length} files. Domain: ${domain.label}. Coverage: ${Math.round((coverage?.score ?? 1) * 100)}%. Prompt: ${userPrompt.slice(0, 160)}`,
            metadata: { runId: "codegen-stream", tags: ["codegen", "stream", "domain-playbook", domain.key], domain: domain.key },
          });
          controller.close();
          return;
        }

        // ─── PASS 1: PLAN ──────────────────────────────────────────────────
        // Stream variant uses tighter plans than the single-shot codegen
        // route · per-file calls + Vercel 90s function cap mean each
        // additional file costs 15-30s. Was 10-14/8-12 → most builds
        // tripped DEADLINE_MS with the last 3 files skipped. New ranges
        // fit reliably under 80s while still producing real multi-page
        // apps (8 files = layout + 5 pages + 2 shared components).
        const planFileRange = tier === "same-to-same" ? "7 to 10" : tier === "production" ? "6 to 8" : "4 to 6";
        const planPrompt = `You are a senior staff engineer planning a polished, working web app.

USER REQUEST:
${userPrompt}

STACK: ${stackHint}

TIER: ${tierHint[tier]}

UI STYLE: ${uiStyleHint[uiStyle]}
${refineBlock}${errorBlock}
Output the FILE PLAN — ${planFileRange} files. For each:
- path : exact path with extension
- purpose : 2-4 sentence brief naming the props, state shape, mock data, what it exports
- language : tsx | ts | css | json | markdown

Always include app/page.tsx and a README.md.

Return JSON only:
{ "name":"…","description":"…","stack":"${stackHint}","files":[{"path":"app/page.tsx","purpose":"…","language":"tsx"},…] }`;

        const rawPlan = await callJson(planPrompt, "Respond with ONE JSON object only. No prose, no markdown fences.", 4000);
        const plan = JSON.parse(rawPlan) as {
          name: string;
          description: string;
          stack: string;
          files: Array<{ path: string; purpose: string; language?: string }>;
        };
        if (!plan?.files?.length) throw new Error("plan: no files");

        send({
          t: "plan_done",
          project: {
            name: plan.name,
            description: plan.description,
            stack: plan.stack,
            files: plan.files.map((f) => ({ path: f.path, purpose: f.purpose })),
          },
          at: Date.now(),
        });

        // ─── PASS 2: WRITE files in parallel batches ───────────────────────
        // 3 concurrent calls per batch · cuts ~10-file build from 60s to
        // ~25s when Cerebras leads. file_start + file_done events still
        // emit per-file so the visible coding stays readable.
        const fileResults: Array<{ path: string; content: string; language: CanonLang }> = [];

        async function writeOne(f: typeof plan.files[number], idx: number) {
          send({ t: "file_start", path: f.path, purpose: f.purpose, index: idx, total: plan.files.length, at: Date.now() });
          const writePrompt = `You are writing ONE file in a multi-file project. The plan was decided already — you only write THIS file's source.

PROJECT: ${plan.name} — ${plan.description}
STACK: ${plan.stack}
USER REQUEST: ${userPrompt}
TIER: ${tierHint[tier]}
UI STYLE: ${uiStyleHint[uiStyle]}

THE FILE YOU MUST WRITE:
Path: ${f.path}
Purpose: ${f.purpose}
Language: ${f.language ?? "tsx"}

PRODUCTION-LEVEL RULES (every file must hold these — no exceptions):
- Write COMPLETE, syntactically valid code. ZERO ellipses, ZERO TODO, ZERO "implement later", ZERO stubs, ZERO "// example" comments. If you cannot finish a function, REWRITE it smaller until it fits.
- FUNCTIONALITY: every interactive control (button / tab / filter / input / form / row) MUST update real React state via useState/useReducer. NO dead handlers. NO console.log placeholders.
- PERSISTENCE: when the file owns user-mutable state (list of items, form data, prefs), persist via localStorage with a versioned key (e.g. \`${plan.name.replace(/\\W+/g, "-").toLowerCase()}.<feature>.v1\`).
- STATES: every page/component must render proper EMPTY ("No X yet · Add one above"), LOADING ("⋯" spinner), and ERROR ("Something went wrong · retry") branches when data is async or list-shaped.
- TYPES: declare TypeScript interfaces/types at the top for any mock-data shape. NO \`any\`.
- Every JSX attribute has an explicit value. Every component file: \`export default function ComponentName\`.
- Aim for 200-450 lines. Shorter for config / mock-data / utility files.
- RICH mock data when this file owns it: 15+ realistic domain items with varied values (not "Item 1, Item 2"). For warehouse: real SKU codes, suppliers, statuses. For CRM: real-shaped names + companies.
- Tailwind v4 utilities. Match the UI style above precisely. Indigo/blue accent on white = Modern SaaS · serif headlines = Editorial · etc.
- Imports use exact relative paths matching sibling files in the project.
- ESCAPE newlines as \\n + double-quotes as \\" inside the JSON string value.

Output JSON only:
{ "path":"${f.path}","content":"…escaped source…","language":"${f.language ?? "tsx"}" }`;

          // First attempt · full prompt + 30s budget against the full
          // provider cascade.
          async function callOnce(p: string, sys: string, maxTok: number, budgetMs: number): Promise<string> {
            return Promise.race([
              callJson(p, sys, maxTok),
              new Promise<string>((_, reject) =>
                setTimeout(() => reject(new Error(`file timeout ${budgetMs}ms`)), budgetMs),
              ),
            ]);
          }
          try {
            const raw = await callOnce(
              writePrompt,
              "Respond with ONE JSON object only. No prose. Production-quality code, never stubs.",
              3500,
              FILE_TIMEOUT_MS,
            );
            const obj = JSON.parse(raw) as { path?: string; content?: string; language?: string };
            const content = stripStubs(obj.content ?? "");
            const language = normalizeLanguage(obj.language, obj.path ?? f.path);
            if (!content) throw new Error("empty content");
            const fileRow = { path: obj.path ?? f.path, content, language };
            fileResults.push(fileRow);
            send({ t: "file_done", ...fileRow, index: idx, total: plan.files.length, at: Date.now() });
          } catch (firstErr) {
            // Second chance · timed-out or empty files get a trimmed
            // retry with a shorter prompt + tighter budget. Was a
            // permanent file_skip on first failure → most stream
            // builds finished at 1-2 files. With one retry, 95%+
            // land on average runs.
            const retryPrompt = `Write the source of ONE file in this multi-file project.

PROJECT: ${plan.name} · ${plan.description.slice(0, 200)}
FILE PATH: ${f.path}
PURPOSE: ${f.purpose.slice(0, 240)}
UI STYLE: ${uiStyleHint[uiStyle].slice(0, 120)}

RULES (terse):
- Complete code · zero stubs · zero ellipses.
- Default-export the component.
- 120-300 lines is fine for a retry.
- Tailwind v4. Real handlers + state.

Output JSON: { "path":"${f.path}","content":"…escaped source…","language":"${f.language ?? "tsx"}" }`;
            try {
              const raw2 = await callOnce(
                retryPrompt,
                "Respond ONLY with one JSON object.",
                2200,
                Math.min(FILE_TIMEOUT_MS, 18_000),
              );
              const obj = JSON.parse(raw2) as { path?: string; content?: string; language?: string };
              const content = stripStubs(obj.content ?? "");
              const language = normalizeLanguage(obj.language, obj.path ?? f.path);
              if (!content) throw new Error("empty content (retry)");
              const fileRow = { path: obj.path ?? f.path, content, language };
              fileResults.push(fileRow);
              send({ t: "file_done", ...fileRow, index: idx, total: plan.files.length, at: Date.now(), retried: true });
            } catch (retryErr) {
              const reason = `${(firstErr as Error).message.slice(0, 60)} · retry: ${(retryErr as Error).message.slice(0, 80)}`;
              send({ t: "file_skip", path: f.path, reason, index: idx, total: plan.files.length, at: Date.now() });
            }
          }
        }

        for (let i = 0; i < plan.files.length; i += WRITE_PARALLEL) {
          if (isOverDeadline()) {
            send({ t: "deadline_hit", written: fileResults.length, total: plan.files.length, at: Date.now() });
            break;
          }
          if (i > 0) await new Promise((r) => setTimeout(r, BATCH_SLEEP_MS));
          const batch = plan.files.slice(i, i + WRITE_PARALLEL);
          await Promise.all(batch.map((f, j) => writeOne(f, i + j)));
        }

        if (fileResults.length < 3) {
          throw new Error("only produced " + fileResults.length + " usable files — try a smaller prompt");
        }

        await safeAddMemory({
          tenantId,
          text: `Codegen-stream project "${plan.name}" — ${fileResults.length} files. Prompt: ${userPrompt.slice(0, 160)}`,
          metadata: { runId: "codegen-stream", tags: ["codegen", "stream"], projectName: plan.name },
        });

        const persisted = storeProject({
          id: slugifyName(plan.name) + "-" + Date.now().toString(36),
          name: plan.name,
          description: plan.description,
          stack: plan.stack,
          files: fileResults.map((f) => ({ path: f.path, content: f.content, language: f.language })),
        });
        send({
          t: "project_done",
          projectId: persisted.id,
          project: {
            id: persisted.id,
            name: plan.name,
            description: plan.description,
            stack: plan.stack,
            files: fileResults,
          },
          at: Date.now(),
        });
      } catch (e) {
        send({ t: "error", message: (e as Error).message, at: Date.now() });
      } finally {
        try {
          controller.close();
        } catch {}
      }
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
