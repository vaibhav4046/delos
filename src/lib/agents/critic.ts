import { z } from "zod";
import { models, getEffectiveTemperature } from "../llm";
import { generateJson, generateJsonWithFallback } from "./jsonGen";

const verdictSchema = z.object({
  verdict: z.enum(["pass", "retry", "replan"]),
  driftScore: z.number().min(0).max(1),
  critique: z.string(),
  fix: z.string().optional(),
  // Clean imperative new goal string ≤120 chars — used as adapt.to when present.
  newGoal: z.string().max(160).optional(),
});

export async function critique(args: {
  originalGoal: string;
  currentPlanSummary: string;
  lastStep: { intent: string; toolResult: string };
  // Number of memory hits surfaced for this run. When 0, the critic must
  // refuse to certify any "found in memory / recalled / from previous run"
  // claim — that closes a QA-found bug where the answer claimed memory
  // proof while memoryRecall.hits=0.
  memoryHits?: number;
  onUsage?: import("./jsonGen").LLMUsage extends infer U ? (u: U) => void : never;
}) {
  const recallBlock = typeof args.memoryHits === "number"
    ? `MEMORY RECALL: ${args.memoryHits} hits.
If the step result CLAIMS memory proof ("from memory", "recalled", "previously", "last run", "i remember") but MEMORY RECALL hit count is 0, that is a hallucinated memory claim — driftScore >= 0.7 and verdict = "replan" with a newGoal that drops the memory claim.`
    : "";
  const prompt = `You are the CRITIC. You only evaluate whether the LAST STEP satisfied its DECLARED STEP INTENT — not whether the global goal is finished.

ORIGINAL GOAL (for context only — do NOT score against this):
${args.originalGoal}

CURRENT PLAN (for context):
${args.currentPlanSummary}

LAST STEP:
declared intent: ${args.lastStep.intent}
result: ${args.lastStep.toolResult}

${recallBlock}

Rules:
- driftScore is purely about: did the result satisfy the declared step intent? 0 = yes perfectly. 1 = result is unrelated to step intent.
- A successful tool call that does what the step intent asked = drift 0.0–0.2. PASS.
- A successful tool call that did the WRONG action = drift 0.6+. REPLAN.
- A failed tool result with an intent that needs a different approach = drift 0.5+. RETRY or REPLAN.
- DO NOT score drift high just because the global goal isn't fully done yet — that is expected mid-plan.
- DO NOT mark "replan" if the step did exactly what its intent said.

verdict:
- "pass" = step intent satisfied; continue plan
- "retry" = step intent not yet satisfied but same tool/approach can be retried
- "replan" = step intent fundamentally wrong; need new plan

Output JSON:
{ "verdict": "pass|retry|replan", "driftScore": 0.0, "critique": "one sentence about step↔intent match", "fix": "optional one-sentence directive", "newGoal": "if verdict=replan, a clean imperative goal string under 120 chars (e.g. 'Search authoritative sources for X, then summarize.'). Omit if no replan." }`;

  // Pre-LLM hard check: hallucinated-memory claims with 0 recall hits are
  // always replans. We don't trust the model to consistently catch this.
  const claimsMemory = /\b(from memory|recalled|previously|last run|i remember|memory recall|recall(?:ed|ing)?\s+from)\b/i.test(args.lastStep.toolResult);
  const noHits = args.memoryHits === 0;
  if (claimsMemory && noHits) {
    return {
      verdict: "replan" as const,
      driftScore: 0.85,
      critique: "Step result claims memory recall but no memory hits were returned for this run.",
      fix: "Drop the memory claim — either re-query memory or answer from scratch without invoking prior runs.",
      newGoal: `Re-answer without memory claims: ${args.originalGoal.slice(0, 90)}`,
    };
  }

  try {
    return await generateJsonWithFallback({
      primary: models.critic,
      fallbacks: models.fallbackChain,
      schema: verdictSchema,
      prompt,
      temperature: getEffectiveTemperature(0.1),
      onUsage: args.onUsage,
    });
  } catch {
    // Heuristic critic of last resort · LLM unavailable across all providers.
    // Use structural cues: a non-empty tool result that mentions the intent
    // keywords is a pass; otherwise retry once before escalating.
    const result = args.lastStep.toolResult.toLowerCase();
    const intentWords = args.lastStep.intent.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const hit = intentWords.some((w) => result.includes(w));
    return {
      verdict: hit ? ("pass" as const) : ("retry" as const),
      driftScore: hit ? 0.1 : 0.4,
      critique: "Heuristic verdict · LLM critic unavailable, scored by keyword overlap.",
    };
  }
}
void generateJson;
