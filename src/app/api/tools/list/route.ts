import { buildRegistry } from "@/lib/tools/builtin";
import type { z } from "zod";

export const runtime = "nodejs";

export async function GET() {
  const reg = buildRegistry();
  const out = reg.list().map((t) => {
    const shape = getShape(t.schema);
    const fields = shape
      ? Object.entries(shape).map(([k, v]) => ({
          name: k,
          type: typeName(v),
          optional: isOptional(v),
        }))
      : [];
    return { name: t.name, description: t.description, tags: t.tags, fields };
  });
  return Response.json({ tools: out });
}

function getShape(schema: unknown): Record<string, z.ZodTypeAny> | null {
  const obj = schema as { shape?: unknown; _def?: { shape?: unknown } };
  if (obj.shape && typeof obj.shape === "object") return obj.shape as Record<string, z.ZodTypeAny>;
  const inDef = obj._def?.shape;
  if (typeof inDef === "function") return (inDef as () => Record<string, z.ZodTypeAny>)();
  if (inDef && typeof inDef === "object") return inDef as Record<string, z.ZodTypeAny>;
  return null;
}

function typeName(v: unknown): string {
  const def = (v as { _def?: { typeName?: string; type?: string } })._def;
  const t = def?.typeName ?? def?.type ?? "any";
  return String(t).replace(/^Zod/, "").toLowerCase();
}

function isOptional(v: unknown): boolean {
  const m = (v as { isOptional?: () => boolean }).isOptional;
  if (typeof m === "function") return m.call(v);
  const def = (v as { _def?: { typeName?: string } })._def;
  return def?.typeName === "ZodOptional";
}
