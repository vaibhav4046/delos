// Multi-file codegen — produces real React/Next.js project trees from a prompt.
// Used when user says "build me an Uber clone" / "build a real SaaS dashboard" etc.
// Returns { name, description, files: [{path, content, language}] }
//
// AppSpec route (/api/build-app) is for constrained DSL mini-apps; this route
// produces unconstrained code suitable for a Codebase viewer window.

import { NextRequest } from "next/server";
import { z } from "zod";
import { safeAddMemory } from "@/lib/hydra";
import { env } from "@/lib/env";
import { rateLimit, clientIp } from "@/lib/rateLimit";

// Codegen is the heaviest paid path. Cap to keep one attacker from draining
// the shared Groq TPM budget. 8/min is well above a legit user's cadence;
// the 429 below already kicks in earlier when Groq TPM is hit.
const CODEGEN_LIMIT_PER_MIN = 8;
const CODEGEN_WINDOW_MS = 60_000;

// Direct Groq HTTP call — bypasses Vercel AI Gateway which billed our chunky
// codegen prompts as credit-card-required. The chat route still uses the SDK
// for streaming; codegen does its own JSON request for reliability.
// Default model: llama-4-scout-17b. Groq free-tier TPM is 30K/min for scout
// vs 8K/min for gpt-oss-120b — scout lets demo judges fire 3–4× more codegens
// before hitting rate limits. Code quality is comparable for small projects.
async function groqJson(prompt: string, system: string, model = "meta-llama/llama-4-scout-17b-16e-instruct"): Promise<string> {
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
      temperature: 0.35,
      // Groq free tier TPM cap is 8000. max_tokens must leave headroom for
      // the request prompt itself. 5500 caps generation; system+user prompt
      // stays under 2500 tokens.
      max_tokens: 5500,
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

export const runtime = "nodejs";
export const maxDuration = 90;

const bodySchema = z.object({
  prompt: z.string().min(5).max(800),
  stack: z.enum(["nextjs", "react-vite", "node-api"]).optional(),
  tenantId: z.string().min(1).max(120).optional(),
});

// Groq's response_format: { type: "json_object" } enforces strict JSON —
// safer than asking the LLM to base64 encode (which scout/maverick don't do
// reliably). Plain content + JSON escape works.
const fileSchema = z.object({
  path: z.string().min(1).max(200),
  content: z.string().min(1).max(8000),
  language: z.enum(["typescript", "javascript", "tsx", "jsx", "css", "json", "markdown", "html", "text"]).optional(),
});

const projectSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(400),
  stack: z.string().min(1).max(80),
  files: z.array(fileSchema).min(2).max(18),
  runInstructions: z.string().max(600).optional(),
  notes: z.array(z.string().max(240)).max(8).optional(),
});

export type CodegenProject = z.infer<typeof projectSchema>;

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
  // Pull data out into local consts — TS narrowing doesn't carry through
  // into the nested buildPrompt closure on older TS targets.
  const userPrompt = parsed.data.prompt;
  const stack = parsed.data.stack ?? "nextjs";
  const tenantId = parsed.data.tenantId || env.DELRIO_TENANT_ID;

  const stackHint =
    stack === "nextjs"
      ? "Next.js 16 App Router + React 19 + TypeScript + Tailwind v4 + Server Components where useful + Route Handlers under app/api/*/route.ts"
      : stack === "react-vite"
        ? "React 18 + Vite + TypeScript + Tailwind"
        : "Node.js 22 + TypeScript + Hono/Express for API only (no frontend)";

  function buildPrompt(scope: "full" | "tight" | "minimal"): string {
    const filesGoal =
      scope === "full" ? "4–6 files (page + 2-4 components + README)"
      : scope === "tight" ? "3–4 files (page + 1-2 components + README)"
      : "3 files only (page.tsx + ONE component + README). Each file ≤ 1200 characters.";
    const perFileCap =
      scope === "full" ? "≤ 2500" : scope === "tight" ? "≤ 1800" : "≤ 1200";
    return `You are a senior staff engineer. Produce a working multi-file project from the user request.

USER REQUEST:
${userPrompt}

STACK: ${stackHint}

RULES (strict):
- ${filesGoal}. Each file ${perFileCap} characters of source code.
- Syntactically valid. No \`...\` ellipses, no \`// TODO\`, no stubs.
- Tailwind classes for styling. No external CSS libs.
- Mock external services (maps/payments/auth) inline with realistic placeholder data.
- ESCAPE all newlines as \\n and quotes as \\" inside JSON string values.
- README.md last: feature list + file map + run instructions.
- name: kebab-case project name. PascalCase for components.

OUTPUT JSON SCHEMA:
{
  "name": "uber-clone",
  "description": "Ride-booking clone with map and trip pricing.",
  "stack": "Next.js 16 / React 19 / TS / Tailwind v4",
  "files": [
    { "path": "app/page.tsx", "content": "...escaped TSX...", "language": "tsx" },
    { "path": "app/components/Hero.tsx", "content": "...", "language": "tsx" },
    { "path": "README.md", "content": "...", "language": "markdown" }
  ],
  "runInstructions": "npm install && npm run dev → http://localhost:3000",
  "notes": ["mock map + payment inline"]
}

Return ONLY the JSON object.`;
  }

  try {
    const sys = "Respond with ONE JSON object only. No prose, no markdown fences, no commentary. Keep response under the model's token cap by writing tight, working code.";
    let project: z.infer<typeof projectSchema> | null = null;
    let lastErr = "";
    // Progressive scope: full → tight → minimal. Each retry shrinks scope so
    // free-tier Groq TPM (8K) never blocks. Worst case user gets 3-file MVP.
    const scopes: Array<"full" | "tight" | "minimal"> = ["full", "tight", "minimal"];
    for (const scope of scopes) {
      const p = lastErr ? `${buildPrompt(scope)}\n\nPrevious attempt failed: ${lastErr.slice(0, 160)}. Tighter scope this time.` : buildPrompt(scope);
      try {
        const raw = await groqJson(p, sys);
        const obj = JSON.parse(raw);
        const v = projectSchema.safeParse(obj);
        if (v.success) {
          project = v.data;
          break;
        }
        lastErr = v.error.message.slice(0, 240);
      } catch (e) {
        // groqJson HTTP error (400 max_tokens, 413 size, 429 rate) lands here
        // and we shrink scope on the next iteration. Best-effort recovery.
        const msg = (e as Error).message;
        lastErr = msg.slice(0, 240);
        // 429 means we just exhausted TPM — retrying immediately won't help.
        // Bail with friendly hint so user waits ~60s.
        if (msg.includes("429") || msg.includes("Rate limit")) {
          throw new Error("Groq TPM limit hit (8000/min free tier). Try again in ~60 seconds, or use a shorter prompt.");
        }
      }
    }
    if (!project) throw new Error(`codegen failed: ${lastErr}`);
    await safeAddMemory({
      tenantId,
      text: `Codegen project "${project.name}" — ${project.files.length} files. Prompt: ${userPrompt.slice(0, 160)}`,
      metadata: { runId: "codegen", tags: ["codegen", "app-build"], projectName: project.name, fileCount: project.files.length },
    });
    return Response.json({ ok: true, project });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
