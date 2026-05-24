"use client";
import { useEffect, useMemo, useState } from "react";
import * as Icons from "lucide-react";
import { useMcpServers } from "@/lib/useMcpServers";
import { listTools } from "@/lib/mcp/client";

type ToolInfo = {
  name: string;
  description: string;
  tags: string[];
  fields: Array<{ name: string; type: string; optional: boolean }>;
  origin: "local" | string; // "local" or MCP server name
};

const ICONS: Record<string, string> = {
  web_search: "Search",
  http_fetch: "Globe",
  calc: "Calculator",
  notes_append: "FilePlus",
  wait: "Hourglass",
  summarize: "FileText",
  wiki_search: "BookOpen",
  world_time: "Clock",
  random_fact: "Lightbulb",
};

export function MarketplaceApp() {
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "local" | "mcp">("all");
  const [mcp] = useMcpServers();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const out: ToolInfo[] = [];
      try {
        const r = await fetch("/api/tools/list");
        const j = (await r.json()) as { tools: Omit<ToolInfo, "origin">[] };
        for (const t of j.tools) out.push({ ...t, origin: "local" });
      } catch {}
      for (const srv of mcp.filter((s) => s.enabled)) {
        try {
          const specs = await listTools(srv.url);
          for (const spec of specs) {
            const fields = Object.entries(spec.inputSchema?.properties ?? {}).map(([n, v]) => ({
              name: n,
              type: (v as { type?: string }).type ?? "string",
              optional: !(spec.inputSchema?.required ?? []).includes(n),
            }));
            out.push({
              name: spec.name,
              description: spec.description,
              tags: ["mcp", srv.id],
              fields,
              origin: srv.name,
            });
          }
        } catch {
          // MCP server unreachable — silent skip, user sees toolset without it
        }
      }
      if (!cancelled) {
        setTools(out);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mcp]);

  const filtered = useMemo(() => {
    if (filter === "all") return tools;
    if (filter === "local") return tools.filter((t) => t.origin === "local");
    return tools.filter((t) => t.origin !== "local");
  }, [tools, filter]);

  const sel = tools.find((t) => t.name === selected);
  const All = Icons as unknown as Record<string, React.ComponentType<{ size?: number; color?: string }>>;

  return (
    <div className="p-3 space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <div className="font-pixel text-sm tracking-wider" style={{ color: "var(--accent)" }}>★ POWER-UPS MARKETPLACE</div>
        <div className="flex gap-1">
          {(["all", "local", "mcp"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`pill ${filter === f ? "pill-info" : "pill-muted"} cursor-pointer`}>{f.toUpperCase()}</button>
          ))}
        </div>
      </div>
      <p className="text-[color:var(--muted)] font-mono">
        {tools.length} tools registered ({tools.filter((t) => t.origin === "local").length} local + {tools.filter((t) => t.origin !== "local").length} MCP). Capability-tagged for sibling fallback.
      </p>
      {loading && (
        <ul className="grid grid-cols-2 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i}>
              <div
                className="card-pixel"
                style={{
                  height: 88,
                  opacity: 0.4,
                  background:
                    "linear-gradient(90deg, var(--surface) 0%, var(--surface-2) 50%, var(--surface) 100%)",
                  backgroundSize: "200% 100%",
                  animation: "shimmer 1.4s linear infinite",
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <ul className="grid grid-cols-2 gap-2">
        {filtered.map((t) => {
          const name = ICONS[t.name] ?? (t.origin === "local" ? "Wrench" : "Plug");
          const Cmp = All[name] ?? Icons.Wrench;
          const active = selected === t.name;
          return (
            <li key={`${t.origin}:${t.name}`}>
              <button
                onClick={() => setSelected(active ? null : t.name)}
                className="card-pixel w-full text-left"
                style={{
                  borderColor: active ? "var(--accent)" : "var(--surface-2)",
                  boxShadow: active ? "0 4px 0 0 var(--accent-shadow)" : undefined,
                }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Cmp size={16} color="var(--accent)" />
                  <span className="font-pixel text-sm tracking-wider">{t.name}</span>
                  {t.origin !== "local" && <span className="pill pill-warn ml-auto" style={{ fontSize: 9 }}>MCP</span>}
                </div>
                <p className="text-[color:var(--muted)] text-[11px] leading-snug">{t.description}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {t.tags.map((tag) => (
                    <span key={tag} className="pill pill-muted" style={{ fontSize: 9 }}>{tag}</span>
                  ))}
                </div>
                <div className="mt-1 text-[9px] text-[color:var(--muted)] font-mono">{t.origin === "local" ? "built-in" : `from: ${t.origin}`}</div>
              </button>
            </li>
          );
        })}
      </ul>

      {sel && (
        <div className="card-pixel" style={{ borderColor: "var(--accent)" }}>
          <div className="font-pixel text-sm tracking-wider mb-2" style={{ color: "var(--accent)" }}>{sel.name} — schema</div>
          {sel.fields.length === 0 && <div className="text-[color:var(--muted)]">no fields</div>}
          <ul className="space-y-1 font-mono text-[11px]">
            {sel.fields.map((f) => (
              <li key={f.name} className="flex gap-2">
                <span style={{ color: "var(--accent)" }}>{f.name}{f.optional ? "?" : ""}</span>
                <span className="text-[color:var(--muted)]">: {f.type}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
