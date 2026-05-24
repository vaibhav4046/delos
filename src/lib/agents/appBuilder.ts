import { models, getEffectiveTemperature } from "../llm";
import { generateJson } from "./jsonGen";
import { appSpecSchema, type AppSpec } from "../appSpec";
import { BUILTIN_APPS } from "../builtinApps";

// Instant-template matcher. Free-tier LLMs frequently fail to produce a
// schema-valid AppSpec on the first attempt; for common prompts we'd rather
// ship a hand-crafted polished app than fail and surface a Zod error to the
// user. Keyword-based for now; the builtin library covers the common asks.
function matchBuiltin(prompt: string): AppSpec | null {
  const p = prompt.toLowerCase();
  const TARGETS: Array<{ keys: RegExp; id: string }> = [
    { keys: /\b(pomodoro|focus timer|25.minute)\b/, id: "pomodoro" },
    { keys: /\b(stopwatch|tick counter|timer)\b/, id: "stopwatch" },
    { keys: /\b(tip|gratuity|bill split)\b/, id: "tip-calc" },
    { keys: /\b(habit tracker|streak|daily habit)\b/, id: "habit-tracker" },
    { keys: /\b(todo|task list|checklist|kanban|board)\b/, id: "kanban-board" },
    { keys: /\b(notes?|notepad|scratchpad)\b/, id: "notes-lite" },
    { keys: /\b(weather|forecast|temperature)\b/, id: "weather-widget" },
    { keys: /\b(poll|voting|votes?)\b/, id: "poll-booth" },
    { keys: /\b(chat|messaging|conversation)\b/, id: "chat-room" },
    { keys: /\b(markdown|md editor|preview)\b/, id: "markdown-editor" },
    { keys: /\b(expense|budget|spending|finance)\b/, id: "expense-tracker" },
    { keys: /\b(contacts?|crm|address book)\b/, id: "contacts-crm" },
  ];
  for (const t of TARGETS) {
    if (t.keys.test(p)) {
      const found = BUILTIN_APPS.find((a) => a.id === t.id);
      if (found) return found;
    }
  }
  return null;
}

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
  // Fast path · keyword-match to a hand-crafted builtin so common prompts
  // ship a polished app instantly. LLM path is reserved for novel asks.
  const instant = matchBuiltin(userPrompt);
  if (instant) return instant;

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
- Aim for 6–14 visible widgets — empty/tiny apps feel broken. Wrap groups in "card" with a heading "text" h3 so the layout reads as designed, not raw.
- Add a "text" h1 title at the top + a one-line h3 subtitle/tagline ("Stay focused 25 minutes at a time.") so judges can grok the app in 2s.
- Use icon names that exist in lucide-react (PascalCase). Mention the icon once near the title via { kind: "image", icon: "...", size: 28 }.
- Use { kind: "pill", text, tone } for status badges (e.g. "Running", "Paused", "Streak 3 days") — they look much more polished than raw text.
- For interactive apps that need LLM help, use { kind: "agent", ... } with a specific, scoped promptTemplate.
- For math, prefer { kind: "tool", tool: "calc", argsTemplate: { expr: "{{a}}+{{b}}" }, saveAs: "result" }.
- Variables for {{interpolation}} come from initialState + bound inputs + tool saveAs results.
- Keep button labels short (1–3 words). Group primary + secondary buttons in a "row" with gap 2.
- Match THIS app's domain in every label and string — never re-use copy from unrelated products. "Pomodoro timer" must say "Start Session", not "Add to Cart".

Return ONLY the JSON object.`;

  return await generateJson({
    model: models.planner,
    schema: appSpecSchema,
    prompt,
    temperature: getEffectiveTemperature(0.4),
    maxRetries: 3,
  });
}
