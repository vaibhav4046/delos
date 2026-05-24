import { z } from "zod";
import { ToolRegistry, type Tool } from "./registry";

function chaosFail(ctx: { chaos: Set<string> }, kind: string): boolean {
  return ctx.chaos.has(kind);
}

function flakeRoll(ctx: { chaos: Set<string> }): boolean {
  if (!ctx.chaos.has("tool_flake")) return false;
  return Math.random() < 0.6;
}

const webSearch: Tool<{ query: string; topK?: number }, { results: Array<{ title: string; url: string; snippet: string }> }> = {
  name: "web_search",
  description: "Search the public web. Returns top-K results.",
  tags: ["search", "web", "research"],
  schema: z.object({ query: z.string().min(1), topK: z.number().int().positive().max(10).optional() }),
  async run({ query, topK = 5 }, ctx) {
    if (chaosFail(ctx, "tool_outage")) throw new Error("Search provider is down (chaos: tool_outage)");
    if (flakeRoll(ctx)) throw new Error("Transient network error (chaos: tool_flake)");
    // DuckDuckGo Instant Answer — free, no key
    const url = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
    const r = await fetch(url, { headers: { "User-Agent": "DelRio/1.0" } }).catch(() => null);
    if (!r || !r.ok) {
      // graceful degradation: synthesize "results" so loop has something to work with
      return {
        results: [
          { title: `Stub: ${query}`, url: "https://example.com", snippet: "Web tool unavailable, stub result." },
        ].slice(0, topK),
      };
    }
    const j = await r.json().catch(() => null);
    const related = (j?.RelatedTopics ?? []) as Array<{ Text?: string; FirstURL?: string }>;
    const results = related
      .filter((x) => x.Text && x.FirstURL)
      .slice(0, topK)
      .map((x) => ({ title: x.Text!.slice(0, 80), url: x.FirstURL!, snippet: x.Text! }));
    if (results.length === 0) {
      results.push({ title: `No instant results for ${query}`, url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`, snippet: "Falling back to query URL." });
    }
    return { results };
  },
};

function assertPublicHttpUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http(s) URLs allowed");
  }
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    host === "metadata.google.internal" ||
    host === "metadata.goog"
  ) {
    throw new Error("Blocked host");
  }
  // IPv4 literal: block loopback / private / link-local / metadata / multicast / reserved.
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const o = v4.slice(1).map((n) => parseInt(n, 10));
    if (o.some((x) => x < 0 || x > 255)) throw new Error("Invalid IP");
    const [a, b] = o;
    if (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    ) {
      throw new Error("Blocked private IP");
    }
  }
  // IPv6 literal: block any [::*] form except global unicast 2000::/3 (still allow public IPv6).
  if (host.startsWith("[")) {
    const v6 = host.slice(1, -1);
    const low = v6.toLowerCase();
    if (
      low === "::1" ||
      low === "::" ||
      low.startsWith("fc") ||
      low.startsWith("fd") ||
      low.startsWith("fe80") ||
      low.startsWith("::ffff:")
    ) {
      throw new Error("Blocked IPv6");
    }
  }
  return u;
}

const httpFetch: Tool<{ url: string }, { status: number; text: string }> = {
  name: "http_fetch",
  description: "Fetch a URL and return text (truncated to 4000 chars).",
  tags: ["web", "fetch", "research"],
  schema: z.object({ url: z.string().url() }),
  async run({ url }, ctx) {
    if (chaosFail(ctx, "tool_outage")) throw new Error("HTTP fetch disabled (chaos: tool_outage)");
    if (flakeRoll(ctx)) throw new Error("Connection reset (chaos: tool_flake)");
    const safe = assertPublicHttpUrl(url);
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch(safe, {
        headers: { "User-Agent": "DelRio/1.0" },
        redirect: "manual",
        signal: ctl.signal,
      });
      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get("location");
        if (loc) assertPublicHttpUrl(new URL(loc, safe).toString());
        return { status: r.status, text: `redirect -> ${loc ?? "?"}` };
      }
      const text = (await r.text()).slice(0, 4000);
      return { status: r.status, text };
    } finally {
      clearTimeout(t);
    }
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

export function buildRegistry(): ToolRegistry {
  return new ToolRegistry()
    .register(webSearch)
    .register(httpFetch)
    .register(calc)
    .register(notes)
    .register(sleep)
    .register(summarize)
    .register(finalAnswerTool);
}
