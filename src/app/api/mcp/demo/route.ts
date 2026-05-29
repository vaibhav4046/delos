import { NextRequest } from "next/server";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";

type RpcReq = { jsonrpc: "2.0"; id: number | string; method: string; params?: Record<string, unknown> };

const TOOLS = [
  {
    name: "wiki_search",
    description: "Search Wikipedia for a topic and return the first paragraph of the top result.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Search topic" } }, required: ["query"] },
  },
  {
    name: "world_time",
    description: "Get current local time for an IANA timezone (e.g., 'Asia/Tokyo', 'America/Los_Angeles').",
    inputSchema: { type: "object", properties: { tz: { type: "string", description: "IANA timezone" } }, required: ["tz"] },
  },
  {
    name: "random_fact",
    description: "Return a random interesting fact.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "crypto_price",
    description: "Get the current USD price of a cryptocurrency by symbol (e.g., 'btc', 'eth', 'sol').",
    inputSchema: { type: "object", properties: { symbol: { type: "string", description: "Crypto ticker" } }, required: ["symbol"] },
  },
  {
    name: "exchange_rate",
    description: "Get the current exchange rate between two currencies (e.g., 'USD' to 'EUR').",
    inputSchema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"] },
  },
  {
    name: "dictionary",
    description: "Define an English word using Free Dictionary API.",
    inputSchema: { type: "object", properties: { word: { type: "string" } }, required: ["word"] },
  },
  {
    name: "dad_joke",
    description: "Return a random dad joke from icanhazdadjoke.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "weather",
    description: "Current weather + 3-day outlook for a city (uses Open-Meteo geocoding + forecast, no API key).",
    inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  },
  {
    name: "github_trending",
    description: "Top GitHub repos by recent stars (uses GitHub search API, no key needed, anonymous rate limit).",
    inputSchema: { type: "object", properties: { lang: { type: "string", description: "Language filter, e.g. typescript" }, days: { type: "integer", description: "Window in days, default 7" } } },
  },
  {
    name: "hn_top",
    description: "Hacker News top stories (uses Firebase HN API, free, no key).",
    inputSchema: { type: "object", properties: { limit: { type: "integer", description: "How many headlines, default 5" } } },
  },
  {
    name: "ip_geo",
    description: "Lookup geo + ASN for an IPv4/IPv6 (uses ip-api.com free tier).",
    inputSchema: { type: "object", properties: { ip: { type: "string" } }, required: ["ip"] },
  },
];

function ok(id: number | string, result: unknown) {
  return Response.json({ jsonrpc: "2.0", id, result });
}
function err(id: number | string, code: number, message: string) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } });
}

export async function GET() {
  return Response.json({ name: "DelOS Demo MCP", tools: TOOLS.map((t) => t.name) });
}

export async function POST(req: NextRequest) {
  // tools/call makes outbound fetches (wiki, crypto, weather, ip-geo…) — same
  // egress-amplification surface as /api/tool. Cap to 30/min per IP.
  const lim = rateLimit(`mcpdemo:ip:${clientIp(req)}`, 30, 60_000);
  if (!lim.ok) {
    return Response.json(
      { jsonrpc: "2.0", id: 0, error: { code: -32029, message: "rate limited" } },
      { status: 429, headers: lim.headers },
    );
  }
  let body: RpcReq;
  try {
    body = (await req.json()) as RpcReq;
  } catch {
    return Response.json({ jsonrpc: "2.0", id: 0, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  // literal `null`/array/primitive bodies parse without throwing — reject before destructure (was a 500)
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ jsonrpc: "2.0", id: 0, error: { code: -32600, message: "Invalid Request" } }, { status: 400 });
  }
  const { id, method, params } = body;
  if (method === "initialize") {
    return ok(id, { protocolVersion: "2024-11-05", serverInfo: { name: "DelOS Demo MCP", version: "0.2.0" }, capabilities: { tools: {} } });
  }
  if (method === "tools/list") {
    return ok(id, { tools: TOOLS });
  }
  if (method === "tools/call") {
    const p = (params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
    try {
      const result = await callTool(p.name ?? "", p.arguments ?? {});
      return ok(id, result);
    } catch (e) {
      return ok(id, { isError: true, content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }] });
    }
  }
  return err(id, -32601, `Method not found: ${method}`);
}

async function callTool(name: string, args: Record<string, unknown>) {
  if (name === "wiki_search") {
    const q = String(args.query ?? "").trim();
    if (!q) throw new Error("query required");
    const headers = { "User-Agent": "DelRio/1.0 (https://delrio.vercel.app)", Accept: "application/json" };

    // Attempt 1: REST summary endpoint with the raw query as title
    const summary = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q.replace(/\s+/g, "_"))}`,
      { headers },
    ).catch(() => null);
    if (summary && summary.ok) {
      const j = (await summary.json()) as { title?: string; extract?: string; content_urls?: { desktop?: { page?: string } } };
      const text = `${j.title ?? q}: ${j.extract ?? "no summary"}\nsource: ${j.content_urls?.desktop?.page ?? ""}`;
      return { content: [{ type: "text", text: text.slice(0, 1200) }] };
    }

    // Attempt 2: opensearch to resolve closest title, then re-fetch summary
    const open = await fetch(
      `https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=1&search=${encodeURIComponent(q)}&origin=*`,
      { headers },
    ).catch(() => null);
    if (open && open.ok) {
      const body = await open.text().catch(() => "");
      const trimmed = body.trim();
      if (!trimmed) {
        // Empty body — skip JSON parse, fall through to DDG
      } else {
        let arr: [string, string[], string[], string[]] | null = null;
        try {
          arr = JSON.parse(trimmed) as [string, string[], string[], string[]];
        } catch {
          arr = null;
        }
        if (arr) {
      const title = arr?.[1]?.[0];
      const desc = arr?.[2]?.[0];
      const url = arr?.[3]?.[0];
      if (title) {
        const s2 = await fetch(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/\s+/g, "_"))}`,
          { headers },
        ).catch(() => null);
        if (s2 && s2.ok) {
          const j = (await s2.json()) as { title?: string; extract?: string; content_urls?: { desktop?: { page?: string } } };
          const text = `${j.title ?? title}: ${j.extract ?? desc ?? "no summary"}\nsource: ${j.content_urls?.desktop?.page ?? url ?? ""}`;
          return { content: [{ type: "text", text: text.slice(0, 1200) }] };
        }
        // Use opensearch description as final fallback
        if (desc || url) {
          return { content: [{ type: "text", text: `${title}: ${desc ?? "no extract"}\nsource: ${url ?? ""}`.slice(0, 1200) }] };
        }
      }
        }
      }
    }

    // Attempt 3: DuckDuckGo Instant Answer fallback
    const ddg = await fetch(
      `https://api.duckduckgo.com/?format=json&no_html=1&q=${encodeURIComponent(q)}`,
      { headers: { "User-Agent": "DelRio/1.0" } },
    ).catch(() => null);
    if (ddg && ddg.ok) {
      const j = (await ddg.json()) as { Heading?: string; AbstractText?: string; AbstractURL?: string };
      if (j.AbstractText) {
        return { content: [{ type: "text", text: `${j.Heading ?? q}: ${j.AbstractText}\nsource: ${j.AbstractURL ?? ""}`.slice(0, 1200) }] };
      }
    }

    return { content: [{ type: "text", text: `No wiki entry found for "${q}". All sources returned empty.` }] };
  }
  if (name === "world_time") {
    const tz = String(args.tz ?? "UTC");
    try {
      const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, dateStyle: "full", timeStyle: "long" });
      const now = fmt.format(new Date());
      return { content: [{ type: "text", text: `${tz}: ${now}` }] };
    } catch {
      throw new Error(`invalid timezone: ${tz}`);
    }
  }
  if (name === "random_fact") {
    const facts = [
      "Octopuses have three hearts and blue blood.",
      "Honey never spoils — edible after 3,000 years in tombs.",
      "Bananas are berries; strawberries are not.",
      "Sharks predate trees by about 100 million years.",
      "A day on Venus is longer than its year.",
      "Wombats produce cube-shaped poop.",
      "There are more synapses in the human brain than stars in the Milky Way.",
      "The shortest war in history lasted 38 minutes (UK vs. Zanzibar, 1896).",
    ];
    return { content: [{ type: "text", text: facts[Math.floor(Math.random() * facts.length)] }] };
  }
  if (name === "crypto_price") {
    const sym = String(args.symbol ?? "btc").toLowerCase();
    const map: Record<string, string> = { btc: "bitcoin", eth: "ethereum", sol: "solana", doge: "dogecoin", ada: "cardano", xrp: "ripple", bnb: "binancecoin", ltc: "litecoin", matic: "matic-network", link: "chainlink" };
    const id = map[sym] ?? sym;
    // Provider chain · CoinGecko free tier is the most accurate but 429s
    // aggressively. Fall through to Binance public, Coinbase, CoinPaprika
    // before surfacing an error.
    async function tryGecko(): Promise<{ usd: number; chg?: number } | null> {
      try {
        const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd&include_24hr_change=true`);
        if (!r.ok) return null;
        const j = (await r.json()) as Record<string, { usd?: number; usd_24h_change?: number }>;
        const row = j[id];
        if (!row?.usd) return null;
        return { usd: row.usd, chg: row.usd_24h_change };
      } catch { return null; }
    }
    async function tryBinance(): Promise<{ usd: number } | null> {
      try {
        const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${sym.toUpperCase()}USDT`);
        if (!r.ok) return null;
        const j = (await r.json()) as { price?: string };
        const usd = Number(j.price);
        return Number.isFinite(usd) && usd > 0 ? { usd } : null;
      } catch { return null; }
    }
    async function tryCoinbase(): Promise<{ usd: number } | null> {
      try {
        const r = await fetch(`https://api.coinbase.com/v2/prices/${sym.toUpperCase()}-USD/spot`);
        if (!r.ok) return null;
        const j = (await r.json()) as { data?: { amount?: string } };
        const usd = Number(j.data?.amount);
        return Number.isFinite(usd) && usd > 0 ? { usd } : null;
      } catch { return null; }
    }
    async function tryPaprika(): Promise<{ usd: number; chg?: number } | null> {
      try {
        const r = await fetch(`https://api.coinpaprika.com/v1/tickers/${sym}-${id}`);
        if (!r.ok) return null;
        const j = (await r.json()) as { quotes?: { USD?: { price?: number; percent_change_24h?: number } } };
        const usd = j.quotes?.USD?.price;
        return typeof usd === "number" && usd > 0 ? { usd, chg: j.quotes?.USD?.percent_change_24h } : null;
      } catch { return null; }
    }
    const price: { usd: number; chg?: number } | null =
      (await tryGecko()) || (await tryBinance()) || (await tryCoinbase()) || (await tryPaprika());
    if (!price) {
      const FALLBACK_USD: Record<string, number> = { btc: 77000, eth: 2100, sol: 165, doge: 0.16, ada: 0.78, xrp: 2.18, bnb: 590, ltc: 95, matic: 0.55, link: 14.2 };
      const fb = FALLBACK_USD[sym];
      if (fb) return { content: [{ type: "text", text: `${sym.toUpperCase()}: ~$${fb.toLocaleString()} (cached fallback · all live providers throttled)` }] };
      throw new Error(`no price for ${sym} · all providers unavailable`);
    }
    const chgTxt = price.chg != null ? `${price.chg.toFixed(2)}%` : "?";
    return { content: [{ type: "text", text: `${sym.toUpperCase()}: $${price.usd.toLocaleString()} (24h ${chgTxt})` }] };
  }
  if (name === "exchange_rate") {
    const from = String(args.from ?? "USD").toUpperCase();
    const to = String(args.to ?? "EUR").toUpperCase();
    const r = await fetch(`https://api.frankfurter.app/latest?from=${from}&to=${to}`);
    if (!r.ok) throw new Error(`frankfurter ${r.status}`);
    const j = (await r.json()) as { rates?: Record<string, number>; date?: string };
    const rate = j.rates?.[to];
    if (!rate) throw new Error(`no rate for ${from}->${to}`);
    return { content: [{ type: "text", text: `1 ${from} = ${rate} ${to} (as of ${j.date})` }] };
  }
  if (name === "dictionary") {
    const word = String(args.word ?? "").trim();
    if (!word) throw new Error("word required");
    const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
    if (!r.ok) throw new Error(`no entry for ${word}`);
    const j = (await r.json()) as Array<{ word: string; phonetics?: Array<{ text?: string }>; meanings?: Array<{ partOfSpeech?: string; definitions?: Array<{ definition?: string }> }> }>;
    const entry = j[0];
    if (!entry) throw new Error(`no entry for ${word}`);
    const phon = entry.phonetics?.find((p) => p.text)?.text;
    const lines = [`${entry.word}${phon ? " " + phon : ""}`];
    for (const m of entry.meanings ?? []) {
      lines.push(`  (${m.partOfSpeech ?? ""}) ${m.definitions?.[0]?.definition ?? ""}`);
    }
    return { content: [{ type: "text", text: lines.join("\n").slice(0, 1000) }] };
  }
  if (name === "dad_joke") {
    const r = await fetch("https://icanhazdadjoke.com/", { headers: { Accept: "application/json", "User-Agent": "DelRio/1.0" } });
    if (!r.ok) throw new Error(`dadjoke ${r.status}`);
    const j = (await r.json()) as { joke?: string };
    return { content: [{ type: "text", text: j.joke ?? "(no joke)" }] };
  }
  if (name === "weather") {
    const city = String(args.city ?? "").trim();
    if (!city) throw new Error("city required");
    const g = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`);
    if (!g.ok) throw new Error(`geocode ${g.status}`);
    const gj = (await g.json()) as { results?: Array<{ name: string; latitude: number; longitude: number; country: string }> };
    const place = gj.results?.[0];
    if (!place) throw new Error(`no city found for ${city}`);
    const w = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&forecast_days=3&timezone=auto`);
    if (!w.ok) throw new Error(`weather ${w.status}`);
    const wj = (await w.json()) as { current?: { temperature_2m?: number; weather_code?: number }; daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[]; time?: string[] } };
    const now = wj.current?.temperature_2m;
    const days = (wj.daily?.time ?? []).map((d, i) => `${d}: ${wj.daily?.temperature_2m_min?.[i]}°–${wj.daily?.temperature_2m_max?.[i]}°C`).join(", ");
    return { content: [{ type: "text", text: `${place.name}, ${place.country}: now ${now}°C. Outlook: ${days}` }] };
  }
  if (name === "github_trending") {
    const lang = String(args.lang ?? "").trim();
    const days = Math.max(1, Math.min(30, Number(args.days ?? 7)));
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const q = `created:>${since}${lang ? ` language:${encodeURIComponent(lang)}` : ""}`;
    const r = await fetch(`https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=5`, {
      headers: { "User-Agent": "DelRio/1.0", Accept: "application/vnd.github.v3+json" },
    });
    if (!r.ok) throw new Error(`github ${r.status}`);
    const j = (await r.json()) as { items?: Array<{ full_name: string; stargazers_count: number; description?: string; html_url: string }> };
    const lines = (j.items ?? []).map((it) => `★ ${it.stargazers_count.toLocaleString()} — ${it.full_name}\n  ${it.description ?? ""}\n  ${it.html_url}`);
    return { content: [{ type: "text", text: lines.join("\n\n").slice(0, 1500) }] };
  }
  if (name === "hn_top") {
    const limit = Math.max(1, Math.min(20, Number(args.limit ?? 5)));
    const r = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json");
    if (!r.ok) throw new Error(`hn ${r.status}`);
    const ids = (await r.json()) as number[];
    const stories = await Promise.all(
      ids.slice(0, limit).map(async (id) => {
        const sr = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
        return (await sr.json()) as { title?: string; url?: string; score?: number; by?: string };
      }),
    );
    const lines = stories.map((s, i) => `${i + 1}. (${s.score ?? "?"}) ${s.title ?? "?"} — ${s.url ?? "(self)"} · ${s.by ?? "?"}`);
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
  if (name === "ip_geo") {
    const ip = String(args.ip ?? "").trim();
    if (!ip) throw new Error("ip required");
    const r = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,regionName,city,isp,org,as,query`);
    if (!r.ok) throw new Error(`ip-api ${r.status}`);
    const j = (await r.json()) as { status?: string; country?: string; regionName?: string; city?: string; isp?: string; as?: string; query?: string };
    if (j.status !== "success") throw new Error("lookup failed");
    return { content: [{ type: "text", text: `${j.query}: ${j.city}, ${j.regionName}, ${j.country}\nISP: ${j.isp}\nASN: ${j.as}` }] };
  }
  throw new Error(`unknown tool: ${name}`);
}
