import { NextRequest } from "next/server";
import { z } from "zod";
import { buildAppFromPrompt } from "@/lib/agents/appBuilder";
import { safeAddMemory } from "@/lib/hydra";
import { env } from "@/lib/env";
import { withModels, type ModelOverrides, type ModelKey } from "@/lib/llm";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { classifyInjection } from "@/lib/security/injection-classifier";
import { normalizeInputField } from "@/lib/apiField";
import { detectDomain } from "@/lib/codegenPlaybooks";

import { zodErr } from "@/lib/apiAuth";
export const runtime = "nodejs";
export const maxDuration = 60;

const BUILD_LIMIT_PER_MIN = 8;
const BUILD_WINDOW_MS = 60_000;

const modelKey = z
  .enum([
    "groq:openai/gpt-oss-120b",
    "groq:openai/gpt-oss-20b",
    "groq:meta-llama/llama-4-scout-17b-16e-instruct",
    "groq:meta-llama/llama-4-maverick-17b-128e-instruct",
    "groq:moonshotai/kimi-k2-instruct-0905",
    "mistral:mistral-large-latest",
    "mistral:mistral-small-latest",
    "google:gemini-2.5-flash",
    "google:gemini-2.5-pro",
  ])
  .optional();

const bodySchema = z.object({
  prompt: z.string().min(3).max(800),
  models: z.object({ planner: modelKey, executor: modelKey, critic: modelKey }).partial().optional(),
  tenantId: z.string().min(1).max(120).optional(),
  // Refine path · client posts the previous spec so the LLM can mutate
  // it in place instead of building a fresh app (which silently switches
  // domains via matchBuiltin / clone templates).
  previousSpec: z.unknown().optional(),
});

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const lim = rateLimit(`buildapp:ip:${ip}`, BUILD_LIMIT_PER_MIN, BUILD_WINDOW_MS);
  if (!lim.ok) {
    return Response.json(
      { error: "Too many build-app requests. Try again shortly." },
      { status: 429, headers: lim.headers },
    );
  }
  // B12 · accept `input` (canonical) or legacy `prompt`.
  const rawBody = await req.json().catch(() => ({}));
  const normalized = normalizeInputField<Record<string, unknown>>(rawBody);
  const parsed = bodySchema.safeParse(normalized.body);
  if (!parsed.success) {
    return zodErr(parsed.error);
  }
  // B17 · prompt-injection guard. Block known patterns at the edge so the
  // LLM never sees an "ignore previous instructions / print SYSTEM_PROMPT"
  // payload. 400 with { error: "blocked_for_security" }.
  const inj = classifyInjection(parsed.data.prompt);
  if (inj.blocked) {
    return Response.json(
      { error: "blocked_for_security", pattern: inj.pattern },
      { status: 400 },
    );
  }
  const overrides: ModelOverrides | undefined = parsed.data.models
    ? Object.fromEntries(Object.entries(parsed.data.models).filter(([, v]) => v) as Array<[string, ModelKey]>)
    : undefined;
  const tenantId = parsed.data.tenantId || env.DELRIO_TENANT_ID;
  try {
    // Best-effort prior-spec coercion. We don't re-validate against
    // appSpecSchema here — appBuilder injects this into the LLM context
    // verbatim, and an invalid prior spec still gives the LLM useful
    // signal about labels/theme. Worst case: LLM ignores the malformed
    // bits and falls back to a fresh build.
    const previousSpec =
      parsed.data.previousSpec && typeof parsed.data.previousSpec === "object"
        ? (parsed.data.previousSpec as Parameters<typeof buildAppFromPrompt>[1]) // type narrowing below
        : undefined;
    let spec = await withModels(overrides, () =>
      buildAppFromPrompt(parsed.data.prompt, previousSpec ? { previousSpec: previousSpec as never } : undefined),
    );
    // F05 · domain playbook coverage check + repair. If the prompt matches a
    // known domain (investor CRM, regulatory, clinical, etc.) ensure the
    // domain's required terms appear as visible labels in the spec. Below
    // 85% coverage, append a coverage-patch component listing missing terms.
    const domain = detectDomain(parsed.data.prompt);
    let coverage: { score: number; missing: string[]; domain: string } | null = null;
    if (domain) {
      const flat = JSON.stringify(spec).toLowerCase();
      const matched: string[] = [];
      const missing: string[] = [];
      for (const term of domain.requiredTerms) {
        const re = new RegExp(`\\b${term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`, "i");
        if (re.test(flat)) matched.push(term);
        else missing.push(term);
      }
      const score = matched.length / Math.max(1, domain.requiredTerms.length);
      coverage = { score, missing, domain: domain.key };
      if (score < 0.85 && missing.length > 0) {
        // Inject a "Domain coverage" section so the missing terms become visible.
        // We mutate the spec defensively · narrow the shape we trust.
        const root = (spec as unknown as { root?: { kind: string; children?: unknown[] }; components?: unknown[] }).components;
        const patchTitle = `${domain.label} · required surfaces`;
        const patchNodes = missing.map((m, i) => ({ id: `cov-${i}`, kind: "text" as const, value: m.charAt(0).toUpperCase() + m.slice(1) }));
        if (Array.isArray(root)) {
          (root as Array<{ id: string; kind: string }>).push(
            { id: "coverage-heading", kind: "text" } as { id: string; kind: string; value?: string },
            ...patchNodes,
          );
          // Set value field after spread since the heading is shaped differently
          (root[root.length - 1 - missing.length] as unknown as { value?: string }).value = patchTitle;
        }
      }
    }
    await safeAddMemory({
      tenantId,
      text: `Built DelOS app "${spec.name}" from prompt: ${parsed.data.prompt.slice(0, 120)}`,
      metadata: { runId: "app-builder", tags: ["app-build"], appId: spec.id, ...(coverage ? { domain: coverage.domain, coverage: coverage.score } : {}) },
    });
    return Response.json({ spec, ...(coverage ? { playbook: coverage.domain, coverage } : {}) });
  } catch (e) {
    // Most failures here are "LLM didn't return a valid AppSpec" (zod fail
    // on the generated JSON). That's a user-facing problem with the prompt,
    // not a server crash — return 422 with a clean message so the builder
    // UI can render "try a more specific prompt" instead of the raw stack.
    const msg = e instanceof Error ? e.message : String(e);
    const isSpecFail = /spec|json|invalid|parse|zod|validation/i.test(msg);
    return Response.json(
      {
        error: isSpecFail
          ? "Couldn't compile an app spec from that prompt. Try something more specific (e.g. \"Build a habit tracker with 7-day streak\")."
          : msg,
      },
      { status: isSpecFail ? 422 : 500 },
    );
  }
}
