"use client";
import { useMemo, useState } from "react";
import * as Icons from "lucide-react";

// OSS Library — curated grid of open-source projects DelOS ships alongside.
// Each card is a launcher: click "OPEN REPO" to view the GitHub source in the
// in-OS Browser, or click "WIRE TO AGENT" to ask Del Assistant to integrate
// the project into the current run.

type OssCategory = "ai" | "education" | "finance" | "security" | "productivity" | "games";

type OssProject = {
  id: string;
  name: string;
  tagline: string;
  url: string;
  category: OssCategory;
  tags: string[];
  why: string; // one-liner: what DelOS uses it for / how it plugs into the agent stack
};

const CATEGORY_LABEL: Record<OssCategory, string> = {
  ai: "AI · AGENTS",
  education: "EDUCATION",
  finance: "FINANCE",
  security: "SECURITY",
  productivity: "PRODUCTIVITY",
  games: "GAMES",
};

const PROJECTS: OssProject[] = [
  {
    id: "pi",
    name: "Pi · earendil-works",
    tagline: "A tiny coding agent kit — plug-in tools, plans, runs on free LLMs.",
    url: "https://github.com/earendil-works/pi",
    category: "ai",
    tags: ["agent-kit", "tools", "free-llm"],
    why: "Reference architecture DelOS code-builder + Cowork + voice agents lean on for plan-execute-critique-memory loops. Imported into the Codebase Builder's planning prompt.",
  },
  {
    id: "understand-anything",
    name: "Understand Anything · Lum1104",
    tagline: "Vision-LM QA — point at any image, ask anything.",
    url: "https://github.com/Lum1104/Understand-Anything",
    category: "ai",
    tags: ["vision", "multimodal", "vqa"],
    why: "Wired into the voice agent so judges can drop an image into ingest and ask 'what is this' — voice runs the VQA pass autonomously.",
  },
  {
    id: "codegraph",
    name: "CodeGraph · colbymchenry",
    tagline: "LLM-built dependency graphs across your codebase.",
    url: "https://github.com/colbymchenry/codegraph",
    category: "ai",
    tags: ["graph", "code-search", "dev-tools"],
    why: "Powers the Codebase app's symbol-aware traversal: jump from any function to every place it's called, with LLM-narrated edges.",
  },
  {
    id: "karpathy-skills",
    name: "Andrej Karpathy Skills · multica-ai",
    tagline: "Curated agent skills modeled on Karpathy's bootstrap lessons.",
    url: "https://github.com/multica-ai/andrej-karpathy-skills",
    category: "ai",
    tags: ["skills", "agent-recipes", "curriculum"],
    why: "Skill library that the Cohort + Cowork apps draw from when a goal matches a known Karpathy recipe (tokenizer-from-scratch, micrograd, etc.).",
  },
  {
    id: "cybersec-skills",
    name: "Anthropic Cybersec Skills · mukul975",
    tagline: "Claude skills for offensive + defensive security workflows.",
    url: "https://github.com/mukul975/Anthropic-Cybersecurity-Skills",
    category: "security",
    tags: ["security", "skills", "claude"],
    why: "Loaded as a high-risk-tier skill manifest. ApprovalGate fires before any of these run.",
  },
  {
    id: "multica",
    name: "Multica · multi-agent",
    tagline: "Lightweight multi-agent orchestrator.",
    url: "https://github.com/multica-ai/multica",
    category: "ai",
    tags: ["multi-agent", "orchestration"],
    why: "DelOS's Cohort race shares an evaluation rubric with Multica so judges can compare verdicts head-to-head.",
  },
  {
    id: "ai-eng",
    name: "AI Engineering from Scratch · rohitg00",
    tagline: "Build the full AI stack from primitives — tokenizer to RAG.",
    url: "https://github.com/rohitg00/ai-engineering-from-scratch",
    category: "education",
    tags: ["curriculum", "from-scratch"],
    why: "DelOS Wiki articles cite these notebooks when explaining 'why graph DBs beat vectors' or 'how a planner-executor loop works'.",
  },
  {
    id: "fincept",
    name: "Fincept Terminal · Fincept-Corporation",
    tagline: "Open-source Bloomberg-style terminal in your browser.",
    url: "https://github.com/Fincept-Corporation/FinceptTerminal",
    category: "finance",
    tags: ["finance", "terminal", "markets"],
    why: "Cowork's 'book me a flight / check the markets' flow uses the Fincept feed shape as a contract — DelOS Browser opens the live Fincept view for prices.",
  },
  {
    id: "presenton",
    name: "Presenton · presenton",
    tagline: "Generate decks from a prompt — slide-by-slide.",
    url: "https://github.com/presenton/presenton",
    category: "productivity",
    tags: ["slides", "deck-gen"],
    why: "Drives the 'Pitch' flow — voice → autonomous agent → Presenton-shaped output → renders in the DelOS pitch slideshow.",
  },
  {
    id: "odoo",
    name: "Odoo · odoo",
    tagline: "Full ERP — CRM, sales, accounting, inventory.",
    url: "https://github.com/odoo/odoo",
    category: "productivity",
    tags: ["erp", "crm", "business"],
    why: "Cowork's 'create a CRM entry' / 'log an expense' actions write to an Odoo-shape JSON contract any self-hosted Odoo instance can ingest.",
  },
  {
    id: "secret-knowledge",
    name: "Book of Secret Knowledge",
    tagline: "Ops + security + dev cheatsheet, deep.",
    url: "https://github.com/trimstray/the-book-of-secret-knowledge",
    category: "education",
    tags: ["cheatsheet", "ops"],
    why: "Indexed into DelOS Memory so Del Assistant can quote the right Linux/security trick when an agent asks how to do a thing.",
  },
  {
    id: "longlive",
    name: "NVlabs LongLive",
    tagline: "Long-context LLM serving on commodity GPUs.",
    url: "https://github.com/NVlabs/LongLive",
    category: "ai",
    tags: ["serving", "long-context"],
    why: "Reference for the 'context-flood' chaos mode — DelOS critic compresses runs so they stay under LongLive-shape windows.",
  },
  {
    id: "contra",
    name: "Contra · clear-code-projects",
    tagline: "Side-scrolling run-n-gun in Python — DelOS Arcade entry.",
    url: "https://github.com/clear-code-projects/Contra",
    category: "games",
    tags: ["game", "pygame", "arcade"],
    why: "Listed in DelOS Arcade — runs natively when judges export the Tauri build. Web port queued behind DelDoom.",
  },
];

export function OssLibraryApp() {
  const [filter, setFilter] = useState<OssCategory | "all">("all");
  const [q, setQ] = useState("");
  const All = Icons as unknown as Record<string, React.ComponentType<{ size?: number; color?: string }>>;

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return PROJECTS.filter((p) => filter === "all" || p.category === filter).filter(
      (p) => !term || p.name.toLowerCase().includes(term) || p.tagline.toLowerCase().includes(term) || p.tags.some((t) => t.includes(term)),
    );
  }, [filter, q]);

  function openRepo(url: string) {
    // Hand off to in-OS Browser. Same-tab path → opens browser app, then
    // dispatches a navigate intent.
    window.dispatchEvent(new CustomEvent("delos-launch-app", { detail: { id: "browser" } }));
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("delos-intent", { detail: { kind: "browser.search", query: url } }));
    }, 300);
  }

  function wireToAgent(p: OssProject) {
    // Push the prompt into the App Builder via its existing builder.build
    // intent — the builder already plans + drafts a spec. Also stash on the
    // clipboard so the user can paste into Del Assistant / Cowork instead.
    const goal = `Integrate ${p.name} (${p.url}) into DelOS. Read the README, list the public API, and propose 3 touch points: (1) which DelOS app or agent imports it, (2) what data shape we pass, (3) a 5-line code sketch of the call site.`;
    try {
      navigator.clipboard?.writeText(goal).catch(() => {});
    } catch {}
    window.dispatchEvent(new CustomEvent("delos-launch-app", { detail: { id: "builder" } }));
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("delos-intent", { detail: { kind: "builder.build", prompt: goal } }));
      window.dispatchEvent(new CustomEvent("toast", { detail: { text: `wiring ${p.name} → builder · prompt copied`, tone: "ok" } }));
    }, 300);
  }

  return (
    <div className="p-3 space-y-3 text-xs">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Icons.LibraryBig size={14} color="var(--accent)" />
          <span className="font-pixel text-sm tracking-wider" style={{ color: "var(--accent)" }}>
            ★ OSS LIBRARY
          </span>
          <span className="pill pill-muted" style={{ fontSize: 9 }}>
            {PROJECTS.length} projects · curated for DelOS
          </span>
        </div>
        <input
          className="input-pixel"
          placeholder="filter…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ width: 160, fontSize: 11 }}
        />
      </div>

      <p className="font-mono text-[10px] leading-relaxed" style={{ color: "var(--muted)" }}>
        Real, public-source projects DelOS pulls from for code generation, multi-agent skills, finance feeds,
        long-context serving, and visual QA. Click OPEN REPO to read the source in-OS, or WIRE TO AGENT to ask
        Del Assistant for a concrete integration plan against the current run.
      </p>

      <div className="flex gap-1 flex-wrap">
        <button
          onClick={() => setFilter("all")}
          className={`pill ${filter === "all" ? "pill-info" : "pill-muted"} cursor-pointer`}
          style={{ fontSize: 9 }}
        >
          ALL
        </button>
        {(Object.keys(CATEGORY_LABEL) as OssCategory[]).map((c) => (
          <button
            key={c}
            onClick={() => setFilter(c)}
            className={`pill ${filter === c ? "pill-info" : "pill-muted"} cursor-pointer`}
            style={{ fontSize: 9 }}
          >
            {CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-2">
        {filtered.map((p) => {
          const Cmp = All[iconFor(p.category)] ?? Icons.Box;
          return (
            <div key={p.id} className="card-pixel space-y-1" style={{ borderColor: "var(--surface-2)" }}>
              <div className="flex items-start gap-2">
                <Cmp size={16} color="var(--accent)" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-pixel text-sm" style={{ color: "var(--accent)" }}>{p.name}</span>
                    <span className="pill pill-muted" style={{ fontSize: 8 }}>{CATEGORY_LABEL[p.category]}</span>
                  </div>
                  <p className="font-mono text-[11px] mt-0.5" style={{ color: "var(--fg)" }}>
                    {p.tagline}
                  </p>
                  <p className="font-mono text-[10px] mt-1" style={{ color: "var(--muted)" }}>
                    <span style={{ color: "var(--success)" }}>WHY DELOS: </span>
                    {p.why}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {p.tags.map((t) => (
                      <span key={t} className="pill pill-muted" style={{ fontSize: 8 }}>{t}</span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex gap-1 pt-1">
                <button onClick={() => openRepo(p.url)} className="btn-pixel" style={{ padding: "4px 10px", fontSize: 10 }}>
                  <Icons.ExternalLink size={10} /> OPEN REPO
                </button>
                <button onClick={() => wireToAgent(p)} className="btn-pixel success" style={{ padding: "4px 10px", fontSize: 10 }}>
                  <Icons.Wand2 size={10} /> WIRE TO AGENT
                </button>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="card-pixel font-mono text-[11px]" style={{ color: "var(--muted)" }}>
            No projects match. Reset filters or try a different keyword.
          </div>
        )}
      </div>
    </div>
  );
}

function iconFor(c: OssCategory): string {
  switch (c) {
    case "ai": return "Bot";
    case "education": return "BookOpen";
    case "finance": return "TrendingUp";
    case "security": return "ShieldCheck";
    case "productivity": return "Briefcase";
    case "games": return "Gamepad2";
  }
}
