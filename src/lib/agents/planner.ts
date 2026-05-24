import { z } from "zod";
import { models, getEffectiveTemperature } from "../llm";
import type { Plan } from "../types";
import type { Tool } from "../tools/registry";
import { generateJson } from "./jsonGen";

const planSchema = z.object({
  rationale: z.string(),
  subgoals: z
    .array(z.string().min(3).max(280))
    .max(3)
    .optional()
    .describe("Optional sub-goals to fan-out to parallel sub-agents BEFORE main steps — only when the goal genuinely decomposes."),
  steps: z
    .array(
      z.object({
        id: z.string(),
        intent: z.string(),
        tool: z.string().optional(),
        args: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .min(1)
    .max(8),
});

export async function makePlan(args: {
  goal: string;
  tools: Tool[];
  memoryHints: string[];
  priorAttempt?: { what: string; why: string };
  onUsage?: import("./jsonGen").LLMUsage extends infer U ? (u: U) => void : never;
}): Promise<Plan> {
  const toolBlock = args.tools
    .map((t) => {
      const s = t.schema as unknown as { shape?: Record<string, unknown>; _def?: { shape?: unknown } };
      const shape = (s.shape && typeof s.shape === "object")
        ? s.shape
        : (typeof s._def?.shape === "function"
            ? (s._def.shape as () => Record<string, unknown>)()
            : (s._def?.shape as Record<string, unknown> | undefined));
      const keys = shape ? Object.keys(shape).join(",") : "";
      return `- ${t.name}(${keys}) — ${t.description} [tags: ${t.tags.join(",")}]`;
    })
    .join("\n");

  const memBlock = args.memoryHints.length
    ? `Relevant memories from past runs:\n${args.memoryHints.map((m) => "- " + m).join("\n")}`
    : "No prior memory available.";

  const recovery = args.priorAttempt
    ? `\nPRIOR ATTEMPT FAILED — DO IT DIFFERENTLY:\nwhat: ${args.priorAttempt.what}\nreason: ${args.priorAttempt.why}`
    : "";

  const prompt = `You are the PLANNER for a multi-agent system.

GOAL: ${args.goal}

AVAILABLE TOOLS:
${toolBlock}

${memBlock}
${recovery}

Produce a 2-5 step plan. Each step picks one tool (or omits tool for pure reasoning).

If — and ONLY if — the goal genuinely decomposes into 2-3 independent research/computation chunks, optionally declare a "subgoals" array. Each subgoal will be answered IN PARALLEL by a sub-agent before the main steps run, and the answers will be added to your scratchpad context. Use sparingly; most goals do NOT need this.

Output JSON with exact shape:
{ "rationale": "<one-line plan summary>",
  "subgoals": ["question 1", "question 2"]   // optional, 0-3 entries
  "steps": [ { "id": "s1", "intent": "...", "tool": "<tool_name_or_omit>", "args": { ... } } ] }`;

  const obj = await generateJson({
    model: models.planner,
    schema: planSchema,
    prompt,
    temperature: getEffectiveTemperature(0.3),
    onUsage: args.onUsage,
  });
  return { goal: args.goal, rationale: obj.rationale, steps: obj.steps, subgoals: obj.subgoals };
}
