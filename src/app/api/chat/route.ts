import { NextRequest } from "next/server";
import { z } from "zod";
import { streamText } from "ai";
import { resolveModel, withModels, type ModelKey } from "@/lib/llm";
import { callTool, listTools } from "@/lib/mcp/client";
import { rateLimit, clientIp } from "@/lib/rateLimit";

import { zodErr } from "@/lib/apiAuth";
export const runtime = "nodejs";
export const maxDuration = 60;

// Cap LLM cost abuse: 20 streams/min per IP. A real chat user sends 1-2
// per minute; bots scraping our LLM keys would push much higher.
const CHAT_LIMIT_PER_MIN = 20;
const CHAT_WINDOW_MS = 60_000;

const modelKey = z.enum([
  "groq:openai/gpt-oss-120b",
  "groq:openai/gpt-oss-20b",
  "groq:meta-llama/llama-4-scout-17b-16e-instruct",
  "groq:meta-llama/llama-4-maverick-17b-128e-instruct",
  "groq:moonshotai/kimi-k2-instruct-0905",
  "mistral:mistral-large-latest",
  "mistral:mistral-small-latest",
  "google:gemini-2.5-flash",
  "google:gemini-2.5-pro",
]);

const messageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1).max(8000),
});

const bodySchema = z.object({
  messages: z.array(messageSchema).min(1).max(40),
  model: modelKey.default("groq:openai/gpt-oss-120b"),
  system: z.string().max(2000).optional(),
  withSearch: z.boolean().default(false),
  searchMcpUrl: z.string().url().optional(),
});

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const lim = rateLimit(`chat:ip:${ip}`, CHAT_LIMIT_PER_MIN, CHAT_WINDOW_MS);
  if (!lim.ok) {
    return new Response(JSON.stringify({ error: "Too many chat requests. Try again shortly." }), {
      status: 429,
      headers: { ...lim.headers, "Content-Type": "application/json" },
    });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return zodErr(parsed.error);
  }
  const { messages, model, system, withSearch, searchMcpUrl } = parsed.data;

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));

      try {
        let searchContext = "";
        if (withSearch && searchMcpUrl) {
          const lastUser = [...messages].reverse().find((m) => m.role === "user");
          if (lastUser) {
            send({ t: "search_start", query: lastUser.content });
            try {
              const tools = await listTools(searchMcpUrl);
              const wiki = tools.find((t) => t.name === "wiki_search");
              if (wiki) {
                const r = (await callTool(searchMcpUrl, "wiki_search", { query: lastUser.content })) as { text?: string };
                searchContext = r.text ?? "";
                send({ t: "search_result", text: searchContext.slice(0, 280) });
              }
            } catch (e) {
              send({ t: "search_error", message: e instanceof Error ? e.message : String(e) });
            }
          }
        }

        const finalSystem = [system, searchContext ? `\nRelevant context from web search:\n${searchContext}` : ""]
          .filter(Boolean)
          .join("\n");

        await withModels({ executor: model as ModelKey }, async () => {
          const t0 = Date.now();
          const result = await streamText({
            model: resolveModel(model),
            system: finalSystem || undefined,
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
            temperature: 0.7,
          });

          for await (const chunk of result.textStream) {
            send({ t: "delta", text: chunk });
          }

          const usage = (await result.usage) as unknown as { inputTokens?: number; outputTokens?: number; promptTokens?: number; completionTokens?: number } | undefined;
          send({
            t: "done",
            ms: Date.now() - t0,
            promptTokens: usage?.inputTokens ?? usage?.promptTokens ?? 0,
            completionTokens: usage?.outputTokens ?? usage?.completionTokens ?? 0,
            model,
          });
        });
      } catch (e) {
        send({ t: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
