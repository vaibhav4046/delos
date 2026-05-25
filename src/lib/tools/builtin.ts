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

    // Query token set for relevance scoring + official-domain boost.
    const qWords = new Set(
      query
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 3),
    );
    function scoreResult(title: string, url: string, snippet: string): number {
      const text = `${title} ${snippet}`.toLowerCase();
      let score = 0;
      for (const w of qWords) if (text.includes(w)) score += 1;
      // Official-domain heuristic — when query mentions a brand and the
      // URL host contains that brand, boost heavily. Catches "OpenAI
      // official docs" → openai.com, "Next.js hydration" → nextjs.org.
      try {
        const host = new URL(url).hostname.toLowerCase();
        for (const w of qWords) {
          if (w.length >= 4 && host.includes(w)) score += 5;
        }
        // Generic doc-domain boosts when query mentions "docs" / "official"
        if (/\b(docs?|documentation|official)\b/i.test(query)) {
          if (/^(docs|developer|developers|api|learn)\./.test(host)) score += 4;
          if (/(github|nextjs|reactjs|mdn|mozilla|openai|anthropic|stripe|vercel|tailwindcss|nodejs|python)\.(org|com|dev|io)$/.test(host)) score += 3;
        }
      } catch {}
      return score;
    }

    // 1) DuckDuckGo HTML/lite parsing as PRIMARY (was Instant Answer JSON
    // which returned RelatedTopics dump · often irrelevant). Lite endpoint
    // returns real organic results without JS.
    const lite = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    let liteResults: Array<{ title: string; url: string; snippet: string }> = [];
    try {
      const r = await fetch(lite, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; DelRio/2.2; +https://delrio.vercel.app)",
          Accept: "text/html",
        },
      });
      if (r.ok) {
        const html = await r.text();
        // Result blocks have anchor `class="result__a"` with the title +
        // href; snippet is `class="result__snippet"`. Extract via regex.
        const blocks: Array<{ title: string; url: string; snippet: string }> = [];
        const anchorRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
        let m: RegExpExecArray | null;
        while ((m = anchorRe.exec(html)) && blocks.length < 20) {
          let url = m[1];
          // DuckDuckGo wraps hrefs in a redirect: //duckduckgo.com/l/?uddg=ENCODED
          const wrap = url.match(/[?&]uddg=([^&]+)/);
          if (wrap) url = decodeURIComponent(wrap[1]);
          if (!/^https?:\/\//.test(url)) continue;
          const title = m[2].replace(/<[^>]+>/g, "").trim();
          const snippet = m[3].replace(/<[^>]+>/g, "").trim().slice(0, 240);
          if (title && url) blocks.push({ title, url, snippet });
        }
        liteResults = blocks;
      }
    } catch {}

    // 2) Curated official-docs results · always added for known dev
    //    queries so the top hit is never a tangentially-related Wikipedia
    //    article when DuckDuckGo can't be reached from the edge runtime.
    //    Each entry is generic enough to be "the entry point" for that
    //    domain; the scorer still has to confirm the query mentions it.
    const q = query.toLowerCase();
    const curated: Array<{ title: string; url: string; snippet: string }> = [];
    const knownDocs: Array<{ test: RegExp; result: { title: string; url: string; snippet: string } }> = [
      { test: /\b(openai|gpt-4|gpt[-_ ]?4o|chat\s*completions?)\b.*\b(api|docs?|official|documentation)\b|\b(api|docs?|official|documentation)\b.*\b(openai|gpt)\b/, result: { title: "OpenAI Platform · API documentation", url: "https://platform.openai.com/docs", snippet: "Official OpenAI API reference: chat completions, embeddings, fine-tuning, models, rate limits." } },
      { test: /\bnext\.?js\b.*\bhydrat/, result: { title: "Next.js · React Hydration Error", url: "https://nextjs.org/docs/messages/react-hydration-error", snippet: "Why hydration errors happen, how to debug them, common causes (browser-only APIs, randomness, mismatched HTML)." } },
      { test: /\bnext\.?js\b.*\b(docs?|documentation|official|getting\s+started)\b/, result: { title: "Next.js · Official documentation", url: "https://nextjs.org/docs", snippet: "App Router, pages, layouts, server components, routing, data fetching, deployment." } },
      { test: /\breact\b.*\b(hooks?|docs?|documentation)\b/, result: { title: "React documentation", url: "https://react.dev", snippet: "Modern React: hooks, suspense, server components, concurrent features, reference." } },
      { test: /\b(anthropic|claude)\b.*\b(api|docs?|official|documentation)\b|\b(api|docs?|official|documentation)\b.*\bclaude\b/, result: { title: "Anthropic · Claude API documentation", url: "https://docs.anthropic.com", snippet: "Claude API: messages, tools, streaming, vision, model overview, prompt engineering." } },
      { test: /\bvercel\b.*\b(docs?|deploy|official)\b/, result: { title: "Vercel documentation", url: "https://vercel.com/docs", snippet: "Deploy Next.js, build configuration, environment variables, domains, monitoring, cron." } },
      { test: /\btailwind(\s*css)?\b.*\b(docs?|utility|class|installation)\b/, result: { title: "Tailwind CSS documentation", url: "https://tailwindcss.com/docs", snippet: "Utility-first CSS framework: installation, customization, dark mode, plugins, v4 features." } },
      { test: /\b(stripe)\b.*\b(api|docs?|payment|billing|invoice)\b/, result: { title: "Stripe API reference", url: "https://docs.stripe.com/api", snippet: "Stripe API: payments, customers, subscriptions, invoices, webhooks, idempotency." } },
      { test: /\bmdn\b|\b(javascript|js|css|html)\b.*\b(reference|docs?|mdn)\b/, result: { title: "MDN Web Docs", url: "https://developer.mozilla.org", snippet: "Mozilla's open reference for JavaScript, CSS, HTML, Web APIs, accessibility, performance." } },
      { test: /\bnode\.?js\b.*\b(docs?|api|official)\b/, result: { title: "Node.js documentation", url: "https://nodejs.org/docs", snippet: "Node.js API reference: filesystem, streams, child_process, crypto, performance hooks." } },
      { test: /\bpython\b.*\b(docs?|tutorial|official)\b/, result: { title: "Python documentation", url: "https://docs.python.org/3", snippet: "Python language reference, standard library, tutorial, packaging, what's new." } },
    ];
    for (const k of knownDocs) {
      if (k.test.test(q)) curated.push(k.result);
    }

    // 3) Wikipedia fallback · keep for ZERO-result coverage only.
    let wikiResults: Array<{ title: string; url: string; snippet: string }> = [];
    if (liteResults.length + curated.length < topK) {
      const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=${Math.max(topK, 6)}&srprop=snippet&srsearch=${encodeURIComponent(query)}&origin=*`;
      const wiki = (await fetch(wikiUrl, { headers: { "User-Agent": "DelRio/1.0" } })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)) as {
        query?: { search?: Array<{ title?: string; snippet?: string }> };
      } | null;
      wikiResults = (wiki?.query?.search ?? [])
        .filter((s) => s.title)
        .map((s) => ({
          title: s.title!,
          url: `https://en.wikipedia.org/wiki/${encodeURIComponent(s.title!.replace(/ /g, "_"))}`,
          snippet: (s.snippet ?? "").replace(/<[^>]+>/g, "").slice(0, 240),
        }));
    }

    // Score, sort, dedupe, cap. Curated entries get a generous floor so
    // they don't lose to DDG noise — but still pass through the same
    // scorer so unrelated curated rows can't dominate.
    const scored: Array<{ title: string; url: string; snippet: string; score: number }> = [];
    for (const r of curated) {
      const score = scoreResult(r.title, r.url, r.snippet) + 8;
      scored.push({ ...r, score });
    }
    for (const r of [...liteResults, ...wikiResults]) {
      const score = scoreResult(r.title, r.url, r.snippet);
      // Reject obviously irrelevant results · score 0 AND no token overlap.
      if (score === 0) continue;
      scored.push({ ...r, score });
    }
    scored.sort((a, b) => b.score - a.score);

    const seen = new Set<string>();
    const merged: Array<{ title: string; url: string; snippet: string }> = [];
    for (const r of scored) {
      const host = (() => {
        try {
          return new URL(r.url).hostname;
        } catch {
          return r.url;
        }
      })();
      if (seen.has(host + r.url.split("?")[0])) continue;
      seen.add(host + r.url.split("?")[0]);
      merged.push({ title: r.title, url: r.url, snippet: r.snippet });
      if (merged.length >= topK) break;
    }

    // Abstract from top scored result.
    const abstract = merged[0]?.snippet;
    const abstractSource = merged[0] ? new URL(merged[0].url).hostname : undefined;
    const abstractUrl = merged[0]?.url;

    if (merged.length === 0) {
      merged.push({
        title: `No results for "${query}"`,
        url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
        snippet: "Search returned no hits matching your query terms. Try different keywords or be more specific.",
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
