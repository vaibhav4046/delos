import { z } from "zod";
import { models, getEffectiveTemperature } from "../llm";
import { generateJson } from "./jsonGen";

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
  onUsage?: import("./jsonGen").LLMUsage extends infer U ? (u: U) => void : never;
}) {
  const prompt = `You are the CRITIC. You only evaluate whether the LAST STEP satisfied its DECLARED STEP INTENT — not whether the global goal is finished.

ORIGINAL GOAL (for context only — do NOT score against this):
${args.originalGoal}

CURRENT PLAN (for context):
${args.currentPlanSummary}

LAST STEP:
declared intent: ${args.lastStep.intent}
result: ${args.lastStep.toolResult}

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

  try {
    return await generateJson({
      model: models.critic,
      schema: verdictSchema,
      prompt,
      temperature: getEffectiveTemperature(0.1),
      onUsage: args.onUsage,
    });
  } catch {
    return await generateJson({
      model: models.fallback,
      schema: verdictSchema,
      prompt,
      temperature: getEffectiveTemperature(0.1),
      onUsage: args.onUsage,
    });
  }
}
