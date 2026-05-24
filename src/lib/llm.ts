import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createGroq } from "@ai-sdk/groq";
import { createMistral } from "@ai-sdk/mistral";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { env } from "./env";
import { DEFAULTS, type ModelKey, type ModelOverrides } from "./llm.catalog";

export { DEFAULTS, MODEL_CATALOG, MODEL_KEYS } from "./llm.catalog";
export type { ModelKey, ModelOverrides } from "./llm.catalog";

const groq = createGroq({ apiKey: env.GROQ_API_KEY });
const mistral = createMistral({ apiKey: env.MISTRAL_API_KEY });
const google = createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY });

export function resolveModel(key: ModelKey): LanguageModel {
  const [provider, name] = key.split(":") as [string, string];
  if (provider === "groq") return groq(name);
  if (provider === "mistral") return mistral(name);
  if (provider === "google") return google(name);
  throw new Error(`Unknown model provider: ${provider}`);
}

export function buildModels(overrides?: ModelOverrides) {
  const planner = resolveModel(overrides?.planner ?? DEFAULTS.planner);
  const executor = resolveModel(overrides?.executor ?? DEFAULTS.executor);
  const critic = resolveModel(overrides?.critic ?? DEFAULTS.critic);
  return {
    planner,
    executor,
    critic,
    fallback: google("gemini-2.5-flash"),
    embedding: google.textEmbeddingModel("text-embedding-004"),
  };
}

const defaultModels = buildModels();

type Models = ReturnType<typeof buildModels>;
const overrideStore = new AsyncLocalStorage<Models>();

export function withModels<T>(overrides: ModelOverrides | undefined, fn: () => T): T {
  if (!overrides || Object.keys(overrides).length === 0) return fn();
  return overrideStore.run(buildModels(overrides), fn);
}

export const models: Models = new Proxy({} as Models, {
  get(_t, prop: string) {
    const active = overrideStore.getStore() ?? defaultModels;
    return (active as unknown as Record<string, unknown>)[prop];
  },
}) as Models;

// Temperature override: user-set creativity slider.
// Each agent has a role-tuned default (e.g. critic=0.1, executor=0.4). When user sets
// a global temperature, we SCALE each role's default proportionally vs the 0.7 anchor.
// This preserves the relative dynamics (critic stays cooler than executor) while still
// honoring user intent. Clamped to [0, 2] (Vercel AI SDK max).
const tempStore = new AsyncLocalStorage<number>();
const TEMP_ANCHOR = 0.7;

export function withTemperature<T>(userTemp: number | undefined, fn: () => T): T {
  if (userTemp === undefined || userTemp === null || Number.isNaN(userTemp)) return fn();
  return tempStore.run(userTemp, fn);
}

export function getEffectiveTemperature(roleDefault: number): number {
  const userTemp = tempStore.getStore();
  if (userTemp === undefined) return roleDefault;
  // Scale: at anchor (0.7), use roleDefault as-is. Above/below, scale proportionally.
  const scaled = roleDefault * (userTemp / TEMP_ANCHOR);
  return Math.min(2, Math.max(0, scaled));
}
