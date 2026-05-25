import { z } from "zod";
import { ToolRegistry, type Tool } from "./registry";

function chaosFail(ctx: { chaos: Set<string> }, kind: string): boolean {
  return ctx.chaos.has(kind);
}

function flakeRoll(ctx: { chaos: Set<string> }): boolean {
  if (!ctx.chaos.has("tool_flake")) return false;
  return Math.random() < 0.6;
}

const webSearch: Tool<
  { query: string; topK?: number },
  { results: Array<{ title: string; url: string; snippet: string }>; abstract?: string; abstractSource?: string; abstractUrl?: string }
> = {
  name: "web_search",
  description: "Search the public web. Returns top-K results plus an instant-answer extract when available.",
  tags: ["search", "web", "research"],
  schema: z.object({ query: z.string().min(1), topK: z.number().int().positive().max(10).optional() }),
  async run({ query, topK = 5 }, ctx) {
    if (chaosFail(ctx, "tool_outage")) throw new Error("Search provider is down (chaos: tool_outage)");
    if (flakeRoll(ctx)) throw new Error("Transient network error (chaos: tool_flake)");

    // 1) DuckDuckGo Instant Answer (good for definitions / topics).
    const ddgUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
    const ddg = await fetch(ddgUrl, { headers: { "User-Agent": "DelRio/1.0" } })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null) as {
        RelatedTopics?: Array<{ Text?: string; FirstURL?: string; Topics?: Array<{ Text?: string; FirstURL?: string }> }>;
        AbstractText?: string;
        AbstractSource?: string;
        AbstractURL?: string;
      } | null;
    const flatTopics: Array<{ Text?: string; FirstURL?: string }> = [];
    for (const t of ddg?.RelatedTopics ?? []) {
      if (Array.isArray(t.Topics)) flatTopics.push(...t.Topics);
      else flatTopics.push(t);
    }
    const ddgResults = flatTopics
      .filter((x) => x.Text && x.FirstURL)
      .map((x) => ({ title: x.Text!.slice(0, 100), url: x.FirstURL!, snippet: x.Text! }));

    let abstract = ddg?.AbstractText || undefined;
    let abstractSource = ddg?.AbstractSource || undefined;
    let abstractUrl = ddg?.AbstractURL || undefined;

    // 2) Wikipedia REST API as a real fallback. DDG returns empty for many
    // queries (especially over server-side fetches from cloud IPs), so we
    // also pull the top Wikipedia results so DEL SEARCH never lands empty.
    const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=${Math.max(topK, 6)}&srprop=snippet&srsearch=${encodeURIComponent(query)}&origin=*`;
    const wiki = await fetch(wikiUrl, { headers: { "User-Agent": "DelRio/1.0" } })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null) as {
        query?: { search?: Array<{ title?: string; snippet?: string; pageid?: number }> };
      } | null;
    const wikiResults = (wiki?.query?.search ?? [])
      .filter((s) => s.title)
      .map((s) => ({
        title: s.title!,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(s.title!.replace(/ /g, "_"))}`,
        // Wikipedia snippet uses MediaWiki <span class="searchmatch">…</span> markup.
        snippet: (s.snippet ?? "").replace(/<[^>]+>/g, "").slice(0, 240),
      }));

    // 3) If DDG had an extract and Wikipedia hit the same topic first, use that
    // as the abstract source — Wikipedia is almost always more useful copy.
    if (!abstract && wikiResults[0]?.snippet) {
      abstract = wikiResults[0].snippet;
      abstractSource = "Wikipedia";
      abstractUrl = wikiResults[0].url;
    }

    // Merge, dedupe by URL, cap at topK.
    const merged: Array<{ title: string; url: string; snippet: string }> = [];
    const seen = new Set<string>();
    for (const r of [...ddgResults, ...wikiResults]) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      merged.push(r);
      if (merged.length >= topK) break;
    }

    if (merged.length === 0) {
      merged.push({
        title: `No results for "${query}"`,
        url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
        snippet: "No DuckDuckGo or Wikipedia hits. Try a different phrasing.",
      });
    }
    return { results: merged, abstract, abstractSource, abstractUrl };
  },
};

import { safeFetch } from "../safeUrl";

const httpFetch: Tool<{ url: string }, { status: number; text: string }> = {
  name: "http_fetch",
  description: "Fetch a URL and return text (truncated to 4000 chars).",
  tags: ["web", "fetch", "research"],
  schema: z.object({ url: z.string().url() }),
  async run({ url }, ctx) {
    if (chaosFail(ctx, "tool_outage")) throw new Error("HTTP fetch disabled (chaos: tool_outage)");
    if (flakeRoll(ctx)) throw new Error("Connection reset (chaos: tool_flake)");
    const r = await safeFetch(url, { headers: { "User-Agent": "DelRio/1.0" } });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      return { status: r.status, text: `redirect -> ${loc ?? "?"}` };
    }
    const text = (await r.text()).slice(0, 4000);
    return { status: r.status, text };
  },
};

const calc: Tool<{ expr: string }, { value: number }> = {
  name: "calc",
  description: "Evaluate a basic arithmetic expression. Supports + - * / ( ) and decimals.",
  tags: ["math", "compute"],
  schema: z.object({ expr: z.string().min(1).max(200) }),
  async run({ expr }) {
    if (!/^[\d\s+\-*/().]+$/.test(expr)) throw new Error("Invalid characters in expression");
    // safe eval via Function with whitelisted chars
    const value = Function(`"use strict"; return (${expr});`)() as number;
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Non-numeric result");
    return { value };
  },
};

const notes: Tool<{ text: string }, { ok: true }> = {
  name: "notes_append",
  description: "Append a short note to the agent's scratchpad. Useful for intermediate findings.",
  tags: ["memory", "scratchpad"],
  schema: z.object({ text: z.string().min(1).max(500) }),
  async run({ text }, ctx) {
    ctx.emit({ kind: "scratchpad", data: { text } });
    return { ok: true } as const;
  },
};

const sleep: Tool<{ ms: number }, { slept: number }> = {
  name: "wait",
  description: "Sleep for a given number of milliseconds (max 3000).",
  tags: ["util"],
  schema: z.object({ ms: z.number().int().positive().max(3000) }),
  async run({ ms }) {
    await new Promise((r) => setTimeout(r, ms));
    return { slept: ms };
  },
};

const summarize: Tool<{ text: string; bullets?: number }, { summary: string[] }> = {
  name: "summarize",
  description: "Compress a long text into N bullet points (default 5). Pure heuristic, no LLM.",
  tags: ["compress", "summary"],
  schema: z.object({ text: z.string().min(1), bullets: z.number().int().positive().max(10).optional() }),
  async run({ text, bullets = 5 }) {
    const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.length > 20);
    return { summary: sentences.slice(0, bullets) };
  },
};

const finalAnswerTool: Tool<{ text: string }, { ok: true; text: string }> = {
  name: "final_answer",
  description:
    "Emit the final user-facing answer and end the run. Use this as the LAST step in every plan. The text should be the complete, polished answer to the user's goal.",
  tags: ["final", "answer", "terminal"],
  schema: z.object({ text: z.string().min(1).max(4000) }),
  async run({ text }, ctx) {
    ctx.emit({ kind: "final_answer", data: { text } });
    return { ok: true as const, text };
  },
};

// Exact-fact pinning · agent calls this when the user says something
// like "remember my name is Varun" or "set project codename to X".
// Was: only generic run-summaries got written, so recall returned
// "Run completed for goal X" instead of "user_name=Varun" — 2026-05-25
// brutal-QA "Memory not trustworthy" P0. Orchestrator listens for the
// emitted memory_pin event and calls safeAddMemory with pinned=true so
// recall ranks these above run summaries.
const memoryPin: Tool<{ key: string; value: string }, { ok: true; pinned: string }> = {
  name: "memory_pin",
  description:
    "Pin an exact user fact (key=value) so future runs recall it verbatim. Use for names, preferences, project codenames, instructions, dates, configs — anything the user states as a durable fact. Examples: { key: 'user_name', value: 'Varun' }, { key: 'response_style', value: 'terse bullets' }.",
  tags: ["memory", "pin", "exact-fact"],
  schema: z.object({
    key: z.string().min(1).max(80).regex(/^[a-z][a-z0-9_]*$/i, "key must be snake_case identifier"),
    value: z.string().min(1).max(400),
  }),
  async run({ key, value }, ctx) {
    ctx.emit({ kind: "memory_pin", data: { key, value } });
    return { ok: true as const, pinned: `${key}=${value}` };
  },
};

export function buildRegistry(): ToolRegistry {
  return new ToolRegistry()
    .register(webSearch)
    .register(httpFetch)
    .register(calc)
    .register(notes)
    .register(sleep)
    .register(summarize)
    .register(memoryPin)
    .register(finalAnswerTool);
}
