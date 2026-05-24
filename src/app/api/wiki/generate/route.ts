import { generateText } from "ai";
import { resolveModel } from "@/lib/llm";
import { safeAddMemory, ensureTenant } from "@/lib/hydra";
import { env } from "@/lib/env";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 60;

const Req = z.object({
  topic: z.string().min(2).max(120),
  tenantId: z.string().default(env.DELRIO_TENANT_ID),
  depth: z.enum(["brief", "standard", "deep"]).default("standard"),
});

async function groundWithWiki(topic: string): Promise<string | null> {
  try {
    const r = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic.replace(/\s+/g, "_"))}`,
      { headers: { "User-Agent": "DelRio/1.0", Accept: "application/json" } },
    );
    if (!r.ok) return null;
    const j = (await r.json()) as { extract?: string; title?: string };
    if (!j.extract) return null;
    return `Wikipedia anchor (${j.title}): ${j.extract}`;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const parsed = Req.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ ok: false, error: parsed.error.message }, { status: 400 });
  const { topic, tenantId, depth } = parsed.data;
  await ensureTenant(tenantId);

  // Ground with Wikipedia if available
  const grounding = await groundWithWiki(topic);
  const sections = depth === "brief" ? 3 : depth === "deep" ? 7 : 5;
  const wordTarget = depth === "brief" ? 250 : depth === "deep" ? 1200 : 600;

  const prompt = `You are DelOS Wiki — a grounded article generator. Write a Wikipedia-style article on the topic below.

Topic: "${topic}"
${grounding ? `\nGrounding (use as factual anchor; do not contradict):\n${grounding}\n` : "\n(no Wikipedia anchor found — write from general knowledge but mark speculative claims as [unverified])\n"}

Requirements:
- Markdown format with H1 title, then ${sections} H2 sections (e.g. Overview, Background, Key Concepts, Examples, Significance, Criticism, References).
- ~${wordTarget} words total.
- Use [bracketed terms] for entities that could be linked to other wiki pages.
- Cite Wikipedia explicitly when grounded: "(source: Wikipedia)".
- End with a References section listing 3-5 sources (real URLs preferred).
- Tone: encyclopedic, neutral, factual.

Output ONLY the markdown article. No preamble.`;

  let article = "";
  try {
    const r = await generateText({
      model: resolveModel("groq:openai/gpt-oss-120b"),
      prompt,
      temperature: 0.3,
      abortSignal: AbortSignal.timeout(45_000),
    });
    article = r.text.trim();
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }

  // Persist as wiki memory
  const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  await safeAddMemory({
    tenantId,
    text: `WIKI_ARTICLE [${slug}] topic="${topic}" depth=${depth} grounded=${!!grounding}\n\n${article.slice(0, 6000)}`,
    metadata: {
      tags: ["wiki", "article", slug, depth, grounding ? "grounded" : "unverified"],
      slug,
      topic,
      depth,
      grounded: !!grounding,
      generatedAt: Date.now(),
    },
  });

  return Response.json({
    ok: true,
    topic,
    slug,
    article,
    grounded: !!grounding,
    grounding: grounding?.slice(0, 200),
    depth,
    words: article.split(/\s+/).length,
    persisted: true,
  });
}

export async function GET() {
  return Response.json({
    ok: true,
    description: "POST { topic, depth?: brief|standard|deep, tenantId? } → Wikipedia-grounded LLM article. Persisted as memory tagged wiki + slug for recall.",
    examples: [
      { topic: "Multi-agent orchestration", depth: "standard" },
      { topic: "HydraDB graph memory", depth: "deep" },
      { topic: "Antigravity 2.0 keynote", depth: "brief" },
    ],
  });
}
