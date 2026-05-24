import { z } from "zod";
import type { Tool } from "../tools/registry";
import { listTools, callTool } from "./client";
import type { MCPServerConfig, MCPToolSpec } from "./types";

function jsonSchemaToZod(spec: MCPToolSpec["inputSchema"]): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  const props = spec.properties ?? {};
  const required = new Set(spec.required ?? []);
  for (const [k, v] of Object.entries(props)) {
    const t = (v.type ?? "string").toLowerCase();
    let zt: z.ZodTypeAny =
      t === "number" || t === "integer"
        ? z.number()
        : t === "boolean"
          ? z.boolean()
          : t === "array"
            ? z.array(z.unknown())
            : t === "object"
              ? z.record(z.string(), z.unknown())
              : z.string();
    if (!required.has(k)) zt = zt.optional();
    shape[k] = zt;
  }
  return z.object(shape).passthrough() as unknown as z.ZodType<Record<string, unknown>>;
}

export async function buildMcpTools(servers: MCPServerConfig[]): Promise<Tool[]> {
  const out: Tool[] = [];
  for (const srv of servers) {
    if (!srv.enabled) continue;
    let specs: MCPToolSpec[] = [];
    try {
      specs = await listTools(srv.url);
    } catch (e) {
      console.warn(`[mcp] listTools failed for ${srv.name}:`, e);
      continue;
    }
    for (const spec of specs) {
      const schema = jsonSchemaToZod(spec.inputSchema);
      const tool: Tool<Record<string, unknown>, unknown> = {
        name: `mcp_${srv.id}_${spec.name}`,
        description: `[MCP:${srv.name}] ${spec.description}`,
        tags: ["mcp", srv.id, ...inferTags(spec.name + " " + spec.description)],
        schema,
        async run(args) {
          return await callTool(srv.url, spec.name, args);
        },
      };
      out.push(tool as Tool);
    }
  }
  return out;
}

function inferTags(text: string): string[] {
  const t = text.toLowerCase();
  const tags: string[] = [];
  if (/search|wiki|wikipedia|query/.test(t)) tags.push("search", "research");
  if (/time|clock|date|timezone/.test(t)) tags.push("time", "util");
  if (/fact|fun|trivia/.test(t)) tags.push("trivia");
  if (/weather|temp|forecast/.test(t)) tags.push("weather");
  if (/stock|price|market/.test(t)) tags.push("finance");
  return tags;
}
