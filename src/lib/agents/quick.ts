import { generateText } from "ai";
import { models, getEffectiveTemperature } from "../llm";
import type { LLMUsage } from "./jsonGen";

export async function runQuickAgent(args: {
  prompt: string;
  onUsage?: (u: LLMUsage) => void;
  systemOverride?: string;
}): Promise<string> {
  const t0 = Date.now();
  const result = await generateText({
    model: models.executor,
    system:
      args.systemOverride ??
      "You are a concise focused assistant. Reply in 1-4 sentences with the answer. No filler. No 'I think', no caveats.",
    prompt: args.prompt,
    temperature: getEffectiveTemperature(0.6),
  });
  const ms = Date.now() - t0;
  if (args.onUsage) {
    const u = result.usage as unknown as { inputTokens?: number; outputTokens?: number; promptTokens?: number; completionTokens?: number } | undefined;
    const m = models.executor as unknown as { modelId?: string };
    args.onUsage({
      model: m.modelId ?? "executor",
      promptTokens: u?.inputTokens ?? u?.promptTokens ?? 0,
      completionTokens: u?.outputTokens ?? u?.completionTokens ?? 0,
      ms,
    });
  }
  return result.text.trim();
}
