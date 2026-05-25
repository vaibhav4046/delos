import { z } from "zod";

const actionSchema = z.union([
  z.object({
    kind: z.literal("set"),
    key: z.string().min(1).max(40),
    value: z.string().max(2000),
  }),
  z.object({
    kind: z.literal("toggle"),
    key: z.string().min(1).max(40),
  }),
  z.object({
    kind: z.literal("inc"),
    key: z.string().min(1).max(40),
    by: z.number().default(1),
  }),
  z.object({
    kind: z.literal("tool"),
    tool: z.enum(["calc", "web_search", "summarize", "notes_append", "wait"]),
    argsTemplate: z.record(z.string(), z.string()).optional(),
    saveAs: z.string().min(1).max(40).optional(),
  }),
  z.object({
    kind: z.literal("agent"),
    promptTemplate: z.string().min(3).max(800),
    saveAs: z.string().min(1).max(40).default("agentResult"),
  }),
  z.object({
    kind: z.literal("notify"),
    text: z.string().min(1).max(200),
  }),
  z.object({
    kind: z.literal("close"),
  }),
  z.object({
    kind: z.literal("push"),
    listKey: z.string().min(1).max(40),
    valueTemplate: z.string().max(500),
  }),
  z.object({
    kind: z.literal("clear"),
    key: z.string().min(1).max(40),
  }),
]);

export type AppAction = z.infer<typeof actionSchema>;

const baseNode = {
  if: z.string().max(200).optional(),
  className: z.string().max(200).optional(),
};

type NodeSchema = z.ZodType<AppNode>;

export type AppNode =
  | { kind: "text"; value: string; size?: "h1" | "h2" | "h3" | "body" | "mono"; if?: string; className?: string }
  | { kind: "button"; label: string; variant?: "primary" | "ghost" | "danger" | "success"; actions: AppAction[]; if?: string; className?: string }
  | { kind: "input"; bind: string; placeholder?: string; type?: "text" | "number" | "textarea"; if?: string; className?: string }
  | { kind: "row"; gap?: number; children: AppNode[]; if?: string; className?: string }
  | { kind: "col"; gap?: number; children: AppNode[]; if?: string; className?: string }
  | { kind: "card"; children: AppNode[]; if?: string; className?: string }
  | { kind: "list"; bindKey: string; itemTemplate: string; emptyText?: string; if?: string; className?: string }
  | { kind: "divider"; if?: string; className?: string }
  | { kind: "image"; icon: string; size?: number; if?: string; className?: string }
  | { kind: "spacer"; size?: number; if?: string; className?: string }
  | { kind: "pill"; text: string; tone?: "info" | "ok" | "warn" | "bad" | "muted"; if?: string; className?: string }
  // Hand-crafted HTML escape hatch — used by curated clones to ship pixel-
  // fidelity layouts the DSL can't express (sidebars, floating composer,
  // multi-column source cards). Server-built templates only; sanitized at
  // render time (no script tags, no on* handlers, no javascript: URLs).
  | { kind: "html"; html: string; if?: string; className?: string };

const nodeSchema: NodeSchema = z.lazy(() =>
  z.union([
    z.object({ ...baseNode, kind: z.literal("text"), value: z.string().max(4000), size: z.enum(["h1", "h2", "h3", "body", "mono"]).optional() }),
    z.object({ ...baseNode, kind: z.literal("button"), label: z.string().max(80), variant: z.enum(["primary", "ghost", "danger", "success"]).optional(), actions: z.array(actionSchema).min(1).max(6) }),
    z.object({ ...baseNode, kind: z.literal("input"), bind: z.string().min(1).max(40), placeholder: z.string().max(120).optional(), type: z.enum(["text", "number", "textarea"]).optional() }),
    z.object({ ...baseNode, kind: z.literal("row"), gap: z.number().int().min(0).max(12).optional(), children: z.array(nodeSchema).max(40) }),
    z.object({ ...baseNode, kind: z.literal("col"), gap: z.number().int().min(0).max(12).optional(), children: z.array(nodeSchema).max(40) }),
    z.object({ ...baseNode, kind: z.literal("card"), children: z.array(nodeSchema).max(40) }),
    z.object({ ...baseNode, kind: z.literal("list"), bindKey: z.string().min(1).max(40), itemTemplate: z.string().max(200), emptyText: z.string().max(120).optional() }),
    z.object({ ...baseNode, kind: z.literal("divider") }),
    z.object({ ...baseNode, kind: z.literal("image"), icon: z.string().max(40), size: z.number().int().min(8).max(80).optional() }),
    z.object({ ...baseNode, kind: z.literal("spacer"), size: z.number().int().min(0).max(64).optional() }),
    z.object({ ...baseNode, kind: z.literal("pill"), text: z.string().max(80), tone: z.enum(["info", "ok", "warn", "bad", "muted"]).optional() }),
    z.object({ ...baseNode, kind: z.literal("html"), html: z.string().max(40000) }),
  ]),
);

// Optional per-app theme · lets a clone override the retro OS palette so
// brand-accurate apps (Claude orange, OpenAI green, Snapchat yellow…)
// render true to source instead of inheriting the DelOS pixel-yellow.
// Colors must be hex / rgb / hsl strings; fontFamily a CSS font stack.
// AppRuntime applies these as CSS variables on a wrapper div.
const themeSchema = z.object({
  bg: z.string().max(60).optional(),
  surface: z.string().max(60).optional(),
  surface2: z.string().max(60).optional(),
  fg: z.string().max(60).optional(),
  muted: z.string().max(60).optional(),
  accent: z.string().max(60).optional(),
  onAccent: z.string().max(60).optional(),
  font: z.string().max(80).optional(),
  pixelFont: z.string().max(80).optional(),
  // Force rounded corners (modern look) instead of pixel-square cards.
  radius: z.union([z.string(), z.number()]).optional(),
}).optional();

export const appSpecSchema = z.object({
  id: z.string().min(1).max(60),
  name: z.string().min(1).max(60),
  icon: z.string().min(1).max(40).default("box"),
  width: z.number().int().min(240).max(900).default(420),
  height: z.number().int().min(180).max(700).default(360),
  initialState: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])).default({}),
  theme: themeSchema,
  root: nodeSchema,
});

export type AppSpec = z.infer<typeof appSpecSchema>;
