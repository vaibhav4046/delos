import { NextRequest } from "next/server";
import { z } from "zod";
import { streamText } from "ai";
import { resolveModel, type ModelKey } from "@/lib/llm";
import { callTool, listTools } from "@/lib/mcp/client";
import { rateLimit, clientIp } from "@/lib/rateLimit";

import { resolveTenant, zodErr } from "@/lib/apiAuth";
import { frameForThread, collectContext, persistTurn } from "@/lib/swarmContext";
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
  // Swarm context · when present, this chat turn participates in the recursive
  // context window: the server recalls prior cross-thread context into the
  // system prompt and persists both turns to the thread frame + long-term
  // memory. Omitted → stateless chat (unchanged behavior).
  threadId: z.string().min(1).max(120).optional(),
  mode: z.string().max(40).optional(),
});

// Cascade order: agents "flow under pressure". When the requested model's
// provider has no key (or it errors), fall through to the next keyed provider
// so the assistant still answers instead of dead-ending on a missing key.
const FALLBACK_ORDER: ModelKey[] = [
  "google:gemini-2.5-flash",
  "mistral:mistral-large-latest",
  "mistral:mistral-small-latest",
  "groq:openai/gpt-oss-120b",
  "groq:openai/gpt-oss-20b",
];

function envKeyFor(model: string): string | null {
  if (model.startsWith("groq:")) return "GROQ_API_KEY";
  if (model.startsWith("mistral:")) return "MISTRAL_API_KEY";
  if (model.startsWith("google:")) return "GOOGLE_GENERATIVE_AI_API_KEY";
  return null;
}

function hasProviderKey(model: string): boolean {
  const k = envKeyFor(model);
  return !k || (process.env[k] ?? "").length > 0;
}

// Requested model first, then the fallback chain, de-duped. Drop providers
// with no key so we never waste a round-trip on a guaranteed 401. If nothing
// is keyed, still attempt the requested model so the client gets a real error.
function candidateModels(requested: ModelKey): ModelKey[] {
  const ordered = [requested, ...FALLBACK_ORDER].filter((m, i, a) => a.indexOf(m) === i);
  const keyed = ordered.filter(hasProviderKey);
  return keyed.length ? keyed : [requested];
}

// Gemini 2.5 counts "thinking" tokens against the output budget. Left
// unbounded, open-ended prompts can spend the ENTIRE budget on reasoning and
// emit zero visible text — the stream comes back empty (observed: "which is
// best ai model now" → empty stream). For the fast/balanced Flash tier we
// disable thinking outright (chat doesn't need it, and it speeds first token);
// for the Pro reasoning tier we cap thinking so there's always room left for
// the answer. Namespaced under `google`, so Groq/Mistral ignore it.
function providerOptionsFor(model: ModelKey) {
  if (model === "google:gemini-2.5-flash") {
    return { google: { thinkingConfig: { thinkingBudget: 0 } } };
  }
  if (model === "google:gemini-2.5-pro") {
    return { google: { thinkingConfig: { thinkingBudget: 1024 } } };
  }
  return undefined;
}

// Turn raw provider errors into something a user can act on. Free-tier daily
// quota is the common one (e.g. Gemini free tier = 20 requests/day), and the
// raw message is a wall of billing-URL text — collapse it to a clear next step.
function friendlyErr(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/quota|rate.?limit|\b429\b|exceeded|too many requests/i.test(raw)) {
    return "All available models are rate-limited right now (free-tier daily quota reached). Add another provider key in Settings → Provider Keys, or try again later.";
  }
  return raw;
}

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
  const { messages, model, system, withSearch, searchMcpUrl, threadId, mode } = parsed.data;

  // Swarm-context prep · resolve tenant server-side (never trusted from body)
  // and recall the recursive cross-thread context window for this turn. Done
  // BEFORE the stream so first-token latency pays at most ONE recall.
  const lastUserContent = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  let swarmTenant: string | null = null;
  let swarmFrameId: string | null = null;
  let swarmHints: string[] = [];
  let swarmStats = { tokensUsed: 0, depthReached: 0, memoryHits: 0, itemCount: 0 };
  if (threadId) {
    try {
      const { tenantId } = await resolveTenant(req, { intent: "write" });
      swarmTenant = tenantId;
      const frame = frameForThread({ tenantId, threadId });
      swarmFrameId = frame.id;
      const collected = await collectContext({
        frameId: frame.id,
        tenantId,
        query: lastUserContent,
        tokenBudget: 900,
      });
      swarmHints = collected.hints.slice(0, 12);
      swarmStats = {
        tokensUsed: collected.tokensUsed,
        depthReached: collected.depthReached,
        memoryHits: collected.memoryHits,
        itemCount: collected.items.length,
      };
    } catch {
      // Context is best-effort — never block a chat on a recall failure.
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      // Guard every enqueue · client disconnect closes the controller and
      // enqueue throws. Latch `closed` so the cascade loop below also stops.
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          closed = true;
        }
      };

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

        // Recursive swarm-context block · prior turns from THIS thread, folded
        // ancestor summaries, and cross-thread memory the engine deemed
        // relevant. Injected silently so the model stays consistent without
        // narrating its memory.
        if (swarmFrameId) {
          send({ t: "context", frameId: swarmFrameId, ...swarmStats });
        }
        const contextBlock = swarmHints.length
          ? `Shared context recalled from this user's prior threads and runs (most relevant first). Use it silently to stay consistent; do not mention it unless asked:\n${swarmHints.map((h) => `- ${h}`).join("\n")}`
          : "";

        const finalSystem = [
          system,
          contextBlock,
          searchContext ? `\nRelevant context from web search:\n${searchContext}` : "",
        ]
          .filter(Boolean)
          .join("\n");

        const candidates = candidateModels(model);
        let streamed = false;
        let lastErr: unknown = null;
        // Accumulate the assistant's visible text so we can persist the turn
        // into swarm context once the stream completes.
        let assistantText = "";

        for (const cand of candidates) {
          // Stop cascading the moment the client goes away.
          if (req.signal.aborted || closed) break;
          const t0 = Date.now();
          try {
            const result = streamText({
              model: resolveModel(cand),
              system: finalSystem || undefined,
              messages: messages.map((m) => ({ role: m.role, content: m.content })),
              temperature: 0.7,
              providerOptions: providerOptionsFor(cand),
              // Abort the in-flight provider request if the client disconnects.
              abortSignal: req.signal,
              // Fail fast so a rate-limited provider cascades to the next
              // candidate quickly instead of blocking the stream through the
              // SDK's multi-second exponential backoff.
              maxRetries: 1,
            });

            let sawText = false;
            let finishReason: string | undefined;
            let usage: { inputTokens?: number; outputTokens?: number } | undefined;

            // Consume fullStream (NOT textStream): textStream silently SWALLOWS
            // provider errors — a 429/quota/401 just ends the stream empty, so
            // the old code mislabeled every provider failure as "empty stream"
            // and never cascaded. fullStream surfaces an explicit error part we
            // can throw on and fall through.
            for await (const part of result.fullStream) {
              if (part.type === "text-delta") {
                if (!sawText) {
                  // First visible token — commit to this candidate.
                  if (cand !== model) send({ t: "fallback", from: model, to: cand });
                  streamed = true;
                  sawText = true;
                }
                if (part.text) {
                  assistantText += part.text;
                  send({ t: "delta", text: part.text });
                }
              } else if (part.type === "error") {
                throw part.error; // → catch below; cascades if nothing streamed yet
              } else if (part.type === "finish") {
                finishReason = part.finishReason;
                usage = part.totalUsage as { inputTokens?: number; outputTokens?: number };
              }
            }

            if (!sawText) {
              // Ended with no visible text and no error part (odd finishReason,
              // or genuinely empty). Cascade rather than return a blank answer.
              lastErr = new Error(finishReason ? `no text (finishReason: ${finishReason})` : "empty stream");
              continue;
            }

            send({
              t: "done",
              ms: Date.now() - t0,
              promptTokens: usage?.inputTokens ?? 0,
              completionTokens: usage?.outputTokens ?? 0,
              model: cand,
            });
            break;
          } catch (err) {
            lastErr = err;
            // Once deltas are on the wire we can't cleanly restart on another
            // model, so surface the error. Otherwise fall through and cascade.
            if (streamed) {
              send({ t: "error", message: friendlyErr(err) });
              break;
            }
          }
        }

        if (!streamed && lastErr) {
          send({ t: "error", message: friendlyErr(lastErr) });
        }

        // Persist this exchange into the recursive context window so later
        // turns — in this thread or any other — can recall it. Best-effort:
        // a memory write must NEVER surface as a chat error.
        if (threadId && swarmTenant && streamed && assistantText.trim()) {
          try {
            if (lastUserContent.trim()) {
              await persistTurn({ tenantId: swarmTenant, threadId, role: "user", text: lastUserContent, mode });
            }
            await persistTurn({ tenantId: swarmTenant, threadId, role: "assistant", text: assistantText, mode });
          } catch {
            // swallow — context persistence is non-critical
          }
        }
      } catch (e) {
        send({ t: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        try {
          controller.close();
        } catch {}
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
