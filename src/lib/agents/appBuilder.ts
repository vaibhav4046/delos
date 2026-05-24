import { models, getEffectiveTemperature } from "../llm";
import { generateJson } from "./jsonGen";
import { appSpecSchema, type AppSpec } from "../appSpec";

const exampleSpec = `{
  "id": "counter",
  "name": "Counter",
  "icon": "Hash",
  "width": 320,
  "height": 240,
  "initialState": { "count": 0 },
  "root": {
    "kind": "col",
    "gap": 3,
    "children": [
      { "kind": "text", "size": "h1", "value": "{{count}}" },
      { "kind": "row", "gap": 2, "children": [
        { "kind": "button", "label": "-", "variant": "ghost", "actions": [{ "kind": "inc", "key": "count", "by": -1 }] },
        { "kind": "button", "label": "+", "variant": "primary", "actions": [{ "kind": "inc", "key": "count" }] }
      ]},
      { "kind": "button", "label": "Reset", "variant": "danger", "actions": [
        { "kind": "set", "key": "count", "value": "0" },
        { "kind": "notify", "text": "counter reset" }
      ]}
    ]
  }
}`;

export async function buildAppFromPrompt(userPrompt: string): Promise<AppSpec> {
  const prompt = `You design SMALL pixel-style desktop apps as JSON specs that render inside a retro Mario-themed OS called DelOS.

USER REQUEST:
${userPrompt}

OUTPUT SCHEMA (informal):
- id: kebab-case unique id
- name: short title
- icon: a lucide-react icon name (capitalized PascalCase), e.g. Calculator, Hash, Clock, BookOpen, Pin, Coffee, Heart, Music, ListChecks, Sparkles, Star, Bot
- width/height: pixel sizes (320-600 wide, 240-500 tall typical)
- initialState: { key: value } — strings, numbers, booleans, or arrays of strings
- root: a node tree

NODE KINDS:
- { kind: "text", value: "string with {{state.key}} interpolation", size?: "h1"|"h2"|"h3"|"body"|"mono" }
- { kind: "button", label, variant?: "primary"|"ghost"|"danger"|"success", actions: [Action,...] }
- { kind: "input", bind: "stateKey", placeholder?, type?: "text"|"number"|"textarea" }
- { kind: "row" | "col", gap?: 0-12, children: [...] }
- { kind: "card", children: [...] }
- { kind: "list", bindKey: "stateKeyHoldingArray", itemTemplate: "{{item}}", emptyText? }
- { kind: "pill", text, tone?: "info"|"ok"|"warn"|"bad"|"muted" }
- { kind: "divider" }
- { kind: "image", icon: "Calculator", size?: 24 }
- { kind: "spacer", size?: 8 }
- Any node accepts optional "if": "stateKey" (truthy gate) and "className"

ACTION KINDS:
- { kind: "set", key, value: "string with {{state.x}}" }
- { kind: "toggle", key }
- { kind: "inc", key, by?: number }
- { kind: "push", listKey, valueTemplate: "string with {{input}}" }
- { kind: "clear", key }
- { kind: "notify", text }
- { kind: "close" }
- { kind: "tool", tool: "calc"|"web_search"|"summarize"|"notes_append"|"wait", argsTemplate?: { argName: "{{state}}" }, saveAs?: "stateKey" }
- { kind: "agent", promptTemplate: "Write a haiku about {{topic}}", saveAs: "stateKey" }

EXAMPLE (counter app):
${exampleSpec}

RULES:
- Output ONE JSON object matching the schema.
- Keep UI tight: 2-6 nodes deep typically, no more than ~25 nodes total.
- Use icon names that exist in lucide-react (PascalCase).
- For interactive apps that need LLM help, use { kind: "agent", ... }.
- For math, prefer { kind: "tool", tool: "calc", argsTemplate: { expr: "{{a}}+{{b}}" }, saveAs: "result" }.
- Variables for {{interpolation}} come from initialState + bound inputs + tool saveAs results.
- Be opinionated about design: choose 1-2 sentences for any prose. Keep label text short.

Return ONLY the JSON object.`;

  return await generateJson({
    model: models.planner,
    schema: appSpecSchema,
    prompt,
    temperature: getEffectiveTemperature(0.4),
    maxRetries: 3,
  });
}
