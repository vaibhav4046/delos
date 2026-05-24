import type { JsonRpcResponse, MCPToolSpec } from "./types";
import { safeFetch } from "../safeUrl";

let nextId = 1;

async function rpc(url: string, method: string, params?: Record<string, unknown>): Promise<unknown> {
  const id = nextId++;
  // User-supplied MCP URLs flow into /api/chat → here. Without the SSRF guard
  // an attacker could point at a private metadata IP or internal service.
  const res = await safeFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} }),
    timeoutMs: 10_000,
  });
  if (!res.ok) throw new Error(`MCP HTTP ${res.status} from ${url}`);
  const body = (await res.json()) as JsonRpcResponse;
  if ("error" in body) throw new Error(`MCP error ${body.error.code}: ${body.error.message}`);
  return body.result;
}

export async function listTools(url: string): Promise<MCPToolSpec[]> {
  const r = (await rpc(url, "tools/list")) as { tools?: MCPToolSpec[] };
  return r.tools ?? [];
}

export async function callTool(url: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  const r = (await rpc(url, "tools/call", { name, arguments: args })) as {
    content?: Array<{ type: string; text?: string }>;
    isError?: boolean;
  };
  if (r.isError) {
    const t = r.content?.find((c) => c.type === "text")?.text ?? "MCP tool error";
    throw new Error(t);
  }
  // Concatenate text contents
  const text = (r.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
  return { text, raw: r };
}
