import { z, ZodError } from "zod";
import type { ToolResult } from "../types";

export type Tool<TArgs = unknown, TOut = unknown> = {
  name: string;
  description: string;
  tags: string[];
  schema: z.ZodType<TArgs>;
  run: (args: TArgs, ctx: ToolCtx) => Promise<TOut>;
};

export type ToolCtx = {
  runId: string;
  chaos: Set<string>;
  emit: (event: { kind: string; data: unknown }) => void;
};

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register<TArgs, TOut>(tool: Tool<TArgs, TOut>) {
    this.tools.set(tool.name, tool as unknown as Tool);
    return this;
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  byTag(tag: string): Tool[] {
    return this.list().filter((t) => t.tags.includes(tag));
  }

  fallbacks(name: string): Tool[] {
    const t = this.get(name);
    if (!t) return [];
    const targetTags = new Set(t.tags);
    return this.list().filter(
      (other) => other.name !== name && other.tags.some((tag) => targetTags.has(tag)),
    );
  }

  async execute(name: string, args: unknown, ctx: ToolCtx): Promise<ToolResult> {
    const tool = this.get(name);
    if (!tool) return { ok: false, error: `Tool not found: ${name}` };
    try {
      const parsed = tool.schema.parse(args);
      const data = await tool.run(parsed, ctx);
      return { ok: true, data };
    } catch (e) {
      // Don't leak the raw multiline ZodError blob (CWE-209) — arg-validation
      // failures collapse to a compact "field: message" list. This is the
      // single choke-point for every tool, so /api/tool and the orchestrator
      // both stop echoing the stringified Zod issue array. Runtime errors fall
      // through to their plain message.
      if (e instanceof ZodError) {
        const issues = e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
        return { ok: false, error: `invalid args — ${issues}` };
      }
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
