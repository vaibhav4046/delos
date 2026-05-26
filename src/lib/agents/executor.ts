import { z } from "zod";
import { models, getEffectiveTemperature } from "../llm";
import type { Tool } from "../tools/registry";
import { generateJson, generateJsonWithFallback } from "./jsonGen";

function describeToolArgs(t: Tool): string {
  const shape = getShape(t.schema);
  if (!shape) return "{}";
  const entries = Object.entries(shape).map(([k, v]) => {
    const optional = (v as unknown as { isOptional?: () => boolean }).isOptional?.() ? "?" : "";
    const inner = describeZodType(v);
    return `${k}${optional}: ${inner}`;
  });
  return `{ ${entries.join(", ")} }`;
}

function getShape(schema: unknown): Record<string, z.ZodTypeAny> | null {
  const obj = schema as { shape?: unknown; _def?: { shape?: unknown } };
  const direct = obj.shape;
  if (direct && typeof direct === "object") return direct as Record<string, z.ZodTypeAny>;
  const inDef = obj._def?.shape;
  if (typeof inDef === "function") return (inDef as () => Record<string, z.ZodTypeAny>)();
  if (inDef && typeof inDef === "object") return inDef as Record<string, z.ZodTypeAny>;
  return null;
}

function describeZodType(v: unknown): string {
  const def = (v as { _def?: { typeName?: string; type?: string } })._def;
  const name = def?.typeName ?? def?.type ?? "any";
  return String(name).replace(/^Zod/, "").toLowerCase();
}

const callSchema = z.object({
  tool: z.string(),
  args: z.record(z.string(), z.unknown()).optional(),
  reasoning: z.string().max(280),
});

export async function pickToolCall(args: {
  goal: string;
  stepIntent: string;
  tools: Tool[];
  scratch: string[];
  lastError?: string;
  onUsage?: import("./jsonGen").LLMUsage extends infer U ? (u: U) => void : never;
}) {
  const toolBlock = args.tools
    .map((t) => `- ${t.name} args=${describeToolArgs(t)} — ${t.description}`)
    .join("\n");
  const errBlock = args.lastError ? `\nPrevious error: ${args.lastError}\nPick a different approach.` : "";
  const scratchBlock = args.scratch.length
    ? `\nScratchpad:\n${args.scratch.slice(-6).map((s) => "- " + s).join("\n")}`
    : "";

  const prompt = `EXECUTOR. Pick ONE tool call to advance this step.

OVERALL GOAL: ${args.goal}
THIS STEP: ${args.stepIntent}

TOOLS:
${toolBlock}
${scratchBlock}
${errBlock}

Output JSON:
{ "tool": "<tool_name>", "args": { ...kw args for the tool... }, "reasoning": "<one line>" }`;

  const obj = await generateJsonWithFallback({
    primary: models.executor,
    fallbacks: models.fallbackChain,
    schema: callSchema,
    prompt,
    temperature: getEffectiveTemperature(0.2),
    onUsage: args.onUsage,
  });
  return { tool: obj.tool, args: obj.args ?? {}, reasoning: obj.reasoning };
}

export async function finalAnswer(args: {
  goal: string;
  scratch: string[];
  toolHistory: Array<{ tool: string; ok: boolean; summary: string }>;
  onUsage?: import("./jsonGen").LLMUsage extends infer U ? (u: U) => void : never;
}) {
  const prompt = `You are producing the FINAL ANSWER.

GOAL:
${args.goal}

WORK DONE:
${args.toolHistory.map((h, i) => `${i + 1}. ${h.tool} [${h.ok ? "ok" : "fail"}] — ${h.summary}`).join("\n")}

NOTES:
${args.scratch.map((s) => "- " + s).join("\n")}

Write a tight 2-5 sentence answer directly addressing the goal. No filler.

Output JSON:
{ "answer": "..." }`;

  // finalAnswer is on the critical path · we MUST have a string out of this
  // function or the run ends with no `answer` event. Provider failover +
  // a synthesized fallback if every model misses.
  try {
    const obj = await generateJsonWithFallback({
      primary: models.executor,
      fallbacks: models.fallbackChain,
      schema: z.object({ answer: z.string().min(1) }),
      prompt,
      temperature: getEffectiveTemperature(0.4),
      onUsage: args.onUsage,
    });
    return obj.answer;
  } catch {
    // Synthesis LLM exhausted · stitch a clean deterministic answer from
    // the work done. No ugly "(model unavailable · fallback)" prefix in
    // the user-facing string — the tool output IS the answer when the
    // tools already did the work. The OS surfaces fallback state via the
    // provider-health pill, not by polluting the answer text.
    const wins = args.toolHistory.filter((h) => h.ok);
    if (wins.length > 0) {
      const last = wins[wins.length - 1];
      // If the last tool's summary is already a usable JSON-style answer
      // (eg `{"summary":[...]}`), parse it and present the inner text.
      const summary = last.summary || "";
      try {
        const obj = JSON.parse(summary) as Record<string, unknown>;
        // Common shapes: { summary: [...] } / { answer: "..." } / { result: ... }
        if (Array.isArray(obj.summary)) {
          return (obj.summary as unknown[]).map((s) => String(s)).join(" ");
        }
        if (typeof obj.answer === "string") return obj.answer;
        if (typeof obj.result === "string") return obj.result;
        if (typeof obj.text === "string") return obj.text;
      } catch {
        /* not JSON · use raw */
      }
      return summary.slice(0, 1200);
    }
    if (args.scratch.length > 0) {
      return args.scratch.slice(-3).join(" · ").slice(0, 600);
    }
    return "No usable result from this run. Try rephrasing the goal or pick a different model in Settings.";
  }
}
void generateJson;
