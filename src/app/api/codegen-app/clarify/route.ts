// R5-E · /api/codegen-app/clarify · Claude-Code-style preflight pass.
// Decides if the prompt has enough detail to proceed. Returns either:
//   { clarify: false, playbook: '<guessed-id>' }
// or
//   { clarify: true, playbook: '<guessed-id>',
//     questions: [{ id, text, options: [...] }] }  (max 3)
//
// Voice + VibeCode UI use this to either skip straight to build or render
// quick chips. Uses NIM Nemotron when available · falls back to Groq.

import { NextRequest } from "next/server";
import { z } from "zod";
import { runQuickAgent } from "@/lib/agents/quick";
import { isNimEnabled, nimChat, NIM_MODELS } from "@/lib/llm/providers/nim";
import { classifyInjection } from "@/lib/security/injection-classifier";
import { detectDomain } from "@/lib/codegenPlaybooks";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const maxDuration = 30;

const Req = z.object({
  prompt: z.string().min(3).max(2000).optional(),
  input: z.string().min(3).max(2000).optional(),
  model: z.string().max(120).optional(),
});

const ClarifyResp = z.object({
  clarify: z.boolean(),
  playbook: z.string().max(80).optional(),
  questions: z
    .array(
      z.object({
        id: z.string().max(20),
        text: z.string().max(240),
        options: z.array(z.string().max(80)).max(6),
      }),
    )
    .max(3)
    .optional(),
});

const SYSTEM = `You are a senior product engineer triaging build requests for a codegen agent.
Given a user prompt, decide whether 1-3 clarifying questions would materially
change the generated app. If the prompt is concrete enough (specific domain +
features), skip the questions. If ambiguous (e.g. "build me a notion clone"),
ask the smallest number of high-leverage questions.

Output STRICTLY one JSON object:
{ "clarify": true,
  "playbook": "notion-clone",
  "questions": [
    { "id": "surface", "text": "Single page or sidebar with page tree?", "options": ["sidebar","single-page"] },
    { "id": "realtime", "text": "Solo or live multiplayer?", "options": ["solo","multiplayer"] }
  ]
}

Or when clear:
{ "clarify": false, "playbook": "investor-crm" }

Rules:
- Max 3 questions. Each must have 2-4 options.
- Reject prompts that already specify >5 concrete features ("clarify": false).
- "playbook" is a free-form domain tag · investor-crm, regulatory-fintech,
  clinical-trial, legal-contracts, ai-tutor, ops-incident, notion-clone,
  linear-clone, generic-saas, etc.
- Output JSON only · no fences, no prose.`;

function safeParseJson(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
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
  const lim = rateLimit(`clarify:ip:${ip}`, 20, 60_000);
  if (!lim.ok) {
    return Response.json({ error: "rate_limited" }, { status: 429, headers: lim.headers });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof body.input === "string" && !body.prompt) body.prompt = body.input;
  const parsed = Req.safeParse(body);
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const prompt = parsed.data.prompt ?? parsed.data.input ?? "";
  if (!prompt) return Response.json({ error: "prompt_required" }, { status: 400 });
  const inj = classifyInjection(prompt);
  if (inj.blocked) return Response.json({ error: "blocked_for_security", pattern: inj.pattern }, { status: 400 });

  // Fast-path · if prompt clearly matches a domain playbook with >5 word
  // requirement terms present, skip the LLM call and return clarify:false.
  const domain = detectDomain(prompt);
  if (domain) {
    const lower = prompt.toLowerCase();
    const hits = domain.requiredTerms.filter((t) => lower.includes(t.toLowerCase())).length;
    if (hits >= 4) {
      return Response.json({ clarify: false, playbook: domain.key });
    }
  }

  // Otherwise ask the LLM
  let raw = "";
  try {
    if (isNimEnabled()) {
      const r = await nimChat({
        model: NIM_MODELS.nemotronSuper49b,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 600,
      });
      raw = r.text;
    } else {
      raw = await runQuickAgent({ prompt, systemOverride: SYSTEM });
    }
  } catch {
    // On planner failure, default to "skip clarify" so the user isn't blocked
    return Response.json({ clarify: false, playbook: domain?.key ?? "generic", note: "planner_unavailable" });
  }

  const obj = safeParseJson(raw);
  const verdict = ClarifyResp.safeParse(obj);
  if (!verdict.success) {
    return Response.json({ clarify: false, playbook: domain?.key ?? "generic" });
  }
  return Response.json(verdict.data);
}

export async function GET() {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
}
