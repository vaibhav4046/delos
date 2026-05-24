"use client";
import { useEffect, useMemo, useState, useRef } from "react";
import * as Icons from "lucide-react";
import { useTenantId } from "@/lib/useTenant";
import { MODEL_CATALOG, type ModelKey } from "@/lib/llm.catalog";
import { broadcastAgent } from "@/lib/intentBus";

// Cowork — autonomous task agent. Give it a goal; it plans, executes (MCP tools), reports.
// Examples: "draft email to X", "create Notion outline for Y", "find 5 YC startups hiring TypeScript devs".

type StepStatus = "pending" | "running" | "done" | "fail";
type Step = {
  id: string;
  label: string;
  tool?: string;
  args?: Record<string, string>;
  result?: string;
  status: StepStatus;
  ms?: number;
};

type Run = {
  id: string;
  goal: string;
  model: ModelKey;
  steps: Step[];
  startedAt: number;
  output?: string;
  status: "planning" | "running" | "done" | "stopped" | "fail";
};

const RECENT_KEY = "delos.cowork.recent.v1";

function loadRecent(): Run[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as Run[]) : [];
  } catch {
    return [];
  }
}

function saveRecent(runs: Run[]) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(runs.slice(0, 12))); } catch {}
}

const PRESETS: Array<{ label: string; goal: string; icon: string }> = [
  { label: "Draft email", goal: "Draft a polite cold email to a recruiter at a Series B startup, mentioning my 5 years of TypeScript + Next.js + AI agent experience. Keep under 120 words.", icon: "Mail" },
  { label: "Notion outline", goal: "Create an outline for a Notion page documenting a multi-agent system architecture: planner, executor, critic, memory layer, tool registry, MCP integration.", icon: "FileText" },
  { label: "Job search", goal: "Search for 5 currently-hiring YC W26 AI startups that need TypeScript engineers. For each: company, role, key tech, why fit.", icon: "Briefcase" },
  { label: "Research brief", goal: "Write a one-page research brief on the differences between graph databases and vector databases for AI agent memory. Cite at least 3 sources.", icon: "Search" },
  { label: "Tweet thread", goal: "Write a 5-tweet thread explaining how multi-agent orchestration with memory + recovery beats single-prompt LLMs. Hooky first tweet.", icon: "Send" },
  { label: "Standup summary", goal: "Summarize the last 7 days of GitHub commits into a clean Monday standup update with bullet points + 3 blockers + 3 next steps.", icon: "Calendar" },
];

export function CoworkApp() {
  const [goal, setGoal] = useState("");
  const [running, setRunning] = useState(false);
  const [currentRun, setCurrentRun] = useState<Run | null>(null);
  const [recent, setRecent] = useState<Run[]>([]);
  const [model, setModel] = useState<ModelKey>("groq:moonshotai/kimi-k2-instruct-0905");
  const [tenant, setTenant] = useTenantId();
  const [draft, setDraft] = useState(tenant);
  const [showShare, setShowShare] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const ctrlRef = useRef<AbortController | null>(null);

  useEffect(() => { setDraft(tenant); }, [tenant]);
  useEffect(() => { setRecent(loadRecent()); }, []);
  useEffect(() => { saveRecent(recent); }, [recent]);

  // Auto-pick up ?cowork= from URL
  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URL(window.location.href).searchParams.get("cowork");
    if (p && !tenant) setTenant(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined" || !tenant) return "";
    const u = new URL(window.location.origin + "/os");
    u.searchParams.set("cowork", tenant);
    return u.toString();
  }, [tenant]);

  type Domain = "email" | "notion" | "jobs" | "research" | "tweet" | "standup" | "code" | "generic";

  function detectDomain(g: string): Domain {
    const lower = g.toLowerCase();
    if (/(email|message|outreach|cold|recruiter|inquiry|reply)/.test(lower)) return "email";
    if (/(notion|outline|wiki|doc|markdown|spec|page)/.test(lower)) return "notion";
    if (/(job|apply|position|role|hiring|recruit|career)/.test(lower)) return "jobs";
    if (/(research|find|sources|cite|paper|study|brief)/.test(lower)) return "research";
    if (/(tweet|thread|twitter|x post|hooky)/.test(lower)) return "tweet";
    if (/(standup|status|update|recap|summary of (work|commits))/.test(lower)) return "standup";
    if (/(code|function|script|component|sql|api)/.test(lower)) return "code";
    return "generic";
  }

  const DOMAIN_PLANS: Record<Domain, string[]> = {
    email: [
      "Identify recipient context (role, company stage, recent news)",
      "Define the core ask in one sentence",
      "Draft subject line + opener",
      "Write body — concrete, specific, no fluff",
      "Polish + add clear next step CTA",
    ],
    notion: [
      "Extract topic + scope of page",
      "Outline H1/H2/H3 hierarchy",
      "Draft introduction + table of contents",
      "Flesh out each section with bullets + examples",
      "Add 'next steps' + cross-reference links",
    ],
    jobs: [
      "Search hiring companies matching criteria",
      "Filter by stack, stage, geography",
      "Extract role title + key responsibilities",
      "Score fit against profile (1-10 with reason)",
      "Format application-ready summary for top 5",
    ],
    research: [
      "Decompose research question into 3 sub-questions",
      "Search authoritative sources per sub-question",
      "Synthesize findings with inline citations",
      "Identify open questions + counterarguments",
      "Compose final brief with sources list",
    ],
    tweet: [
      "Identify hook angle (controversy, insight, story)",
      "Draft tweet 1 — hook in <240 chars",
      "Tweets 2-4: meat (one idea each)",
      "Tweet 5: call-to-action / clincher",
      "Tighten language, remove filler",
    ],
    standup: [
      "List concrete deliverables done last week",
      "Identify in-progress items + percent",
      "Surface blockers + dependencies",
      "Define this-week priorities (top 3)",
      "Compose in Yesterday / Today / Blockers format",
    ],
    code: [
      "Clarify inputs + outputs + edge cases",
      "Choose language + minimal dependencies",
      "Draft core logic",
      "Add error handling + types",
      "Write 2-3 test cases inline",
    ],
    generic: [
      "Understand the goal precisely",
      "Gather necessary context",
      "Draft initial output",
      "Refine for accuracy + tone",
      "Deliver final result",
    ],
  };

  const DOMAIN_COMPILE_PROMPT: Record<Domain, string> = {
    email: "Output a complete, ready-to-send email. Format exactly:\nSubject: <subject>\n\n<body>\n\n--\n<sign-off>\n\nNo prose around it, no meta-commentary. Tone: professional, warm, specific.",
    notion: "Output as clean Markdown ready to paste into Notion. Use # H1, ## H2, ### H3, bullets, numbered lists. Include a TOC at top. No commentary.",
    jobs: "Output a structured list. For each company:\n- **Company** · stage · funding\n- Role: <title>\n- Stack: <tech>\n- Why fit: <1 line>\n- Apply: <url-or-instructions>\n\nNo intro/outro.",
    research: "Output a structured research brief. Sections: TL;DR (3 bullets), Key Findings (with [1][2] inline cites), Counter-points, Open Questions, Sources (numbered list). No commentary outside this structure.",
    tweet: "Output exactly 5 tweets, each numbered 1/5, 2/5… Each tweet < 270 chars. Separate with blank lines. No commentary.",
    standup: "Output in this exact Markdown format:\n## Yesterday\n- bullet\n## Today\n- bullet\n## Blockers\n- bullet\n\nKeep bullets concrete, with file paths or PR refs when relevant. No commentary.",
    code: "Output a single code block with the requested language. Above the code, 1-2 sentence note. After the code, 2 bullets explaining key decisions. Nothing else.",
    generic: "Output the requested deliverable. Match the implicit format of the goal. Direct. No meta-commentary.",
  };

  async function planTask(g: string): Promise<Step[]> {
    const domain = detectDomain(g);
    // Try LLM-tailored plan; fallback to domain template
    try {
      const r = await fetch("/api/quick-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `You are an autonomous agent planner. The user wants:
"${g}"

Domain detected: ${domain}.

Break this into 4-6 concrete, ordered steps an AI can actually execute. Each step must be specific to THIS user's goal (not generic).

Return ONLY valid JSON array, each item:
- "label": short imperative starting with a verb (max 8 words, specific)
- "tool": one of "web_search" / "write" / "fetch" / "none"

Example for "draft email to YC recruiter":
[
  {"label":"Find recruiter's recent posts on X/LinkedIn","tool":"web_search"},
  {"label":"Identify their company's latest funding/news","tool":"web_search"},
  {"label":"Draft subject + warm 2-sentence opener","tool":"write"},
  {"label":"Write 3-sentence body with concrete experience","tool":"write"},
  {"label":"Add specific CTA and polish","tool":"write"}
]

Now for the user's goal. JSON only:`,
        }),
      });
      const j = (await r.json()) as { text?: string };
      const match = (j.text ?? "").match(/\[[\s\S]*\]/);
      if (match) {
        const arr = JSON.parse(match[0]) as Array<{ label: string; tool?: string }>;
        if (arr.length >= 2) {
          return arr.slice(0, 6).map((s, i) => ({
            id: `s-${Date.now()}-${i}`,
            label: s.label,
            tool: s.tool,
            status: "pending" as StepStatus,
          }));
        }
      }
    } catch {}
    // Domain-aware fallback
    return DOMAIN_PLANS[domain].map((label, i) => ({
      id: `s-${Date.now()}-${i}`,
      label,
      tool: /search|find|gather|sources/i.test(label) ? "web_search" : "write",
      status: "pending" as StepStatus,
    }));
  }

  async function executeStep(step: Step, goalCtx: string, prevResults: string[], domain: Domain): Promise<string> {
    // Real web search via MCP wiki/news/hn tools
    if (step.tool === "web_search") {
      const query = step.label.replace(/^(search|find|gather|look up|research)\s+/i, "");
      // Try MCP wiki_search first
      try {
        const r = await fetch("/api/mcp/demo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: "wiki_search", arguments: { query } },
          }),
        });
        const j = (await r.json()) as { result?: { content?: Array<{ text?: string }> } };
        const text = j.result?.content?.[0]?.text;
        if (text) return text.slice(0, 800);
      } catch {}
      // Fallback to /api/tool
      try {
        const r = await fetch("/api/tool", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tool: "web_search", args: { query } }),
        });
        const j = (await r.json()) as { ok: boolean; data?: unknown };
        if (j.ok) return typeof j.data === "string" ? j.data.slice(0, 800) : JSON.stringify(j.data).slice(0, 600);
      } catch {}
    }
    // LLM step — domain-aware system prompt
    const ctx = prevResults.length > 0 ? `\n\nPrior step results:\n${prevResults.slice(-3).join("\n\n---\n\n")}` : "";
    const r = await fetch("/api/quick-agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: `You are an autonomous ${domain} agent. The end-goal is:
"${goalCtx}"

Your current sub-task: ${step.label}
${ctx}

Execute ONLY this sub-task. Be specific, concrete, factual. No filler. Max 220 words.`,
      }),
    });
    const j = (await r.json()) as { text?: string };
    return (j.text ?? "(no output)").trim();
  }

  async function compileOutput(g: string, results: string[], domain: Domain): Promise<string> {
    const r = await fetch("/api/quick-agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: `User's goal: ${g}

Step-by-step research and drafts:
${results.join("\n\n---\n\n")}

${DOMAIN_COMPILE_PROMPT[domain]}

Produce the final deliverable now.`,
      }),
    });
    const j = (await r.json()) as { text?: string };
    return (j.text ?? "").trim();
  }

  async function run() {
    const g = goal.trim();
    if (!g || running) return;
    setRunning(true);
    const run: Run = {
      id: `r-${Date.now()}`,
      goal: g,
      model,
      steps: [],
      startedAt: Date.now(),
      status: "planning",
    };
    setCurrentRun(run);
    broadcastAgent("planner", "thinking");

    try {
      const domain = detectDomain(g);
      const steps = await planTask(g);
      run.steps = steps;
      run.status = "running";
      setCurrentRun({ ...run });
      broadcastAgent("executor", "tool");

      const results: string[] = [];
      for (let i = 0; i < steps.length; i++) {
        steps[i].status = "running";
        setCurrentRun({ ...run, steps: [...steps] });
        const t0 = performance.now();
        try {
          let result = await executeStep(steps[i], g, results, domain);
          // Retry once on empty/very-short output
          if (!result || result.length < 20) {
            result = await executeStep(steps[i], g, results, domain);
          }
          steps[i].result = result;
          steps[i].ms = Math.round(performance.now() - t0);
          steps[i].status = "done";
          results.push(`Step ${i + 1}: ${steps[i].label}\n${result}`);
        } catch (e) {
          steps[i].status = "fail";
          steps[i].result = `error: ${(e as Error).message}`;
        }
        setCurrentRun({ ...run, steps: [...steps] });
      }

      broadcastAgent("critic", "thinking");
      const output = await compileOutput(g, results, domain);
      run.output = output;
      run.status = "done";
      setCurrentRun({ ...run });
      setRecent((p) => [{ ...run }, ...p].slice(0, 12));
    } catch (e) {
      run.status = "fail";
      run.output = `error: ${(e as Error).message}`;
      setCurrentRun({ ...run });
    } finally {
      setRunning(false);
      broadcastAgent("planner", "done");
      broadcastAgent("executor", "done");
      broadcastAgent("critic", "done");
      setTimeout(() => {
        broadcastAgent("planner", "idle");
        broadcastAgent("executor", "idle");
        broadcastAgent("critic", "idle");
      }, 1500);
    }
  }

  function stop() {
    ctrlRef.current?.abort();
    setRunning(false);
    if (currentRun) setCurrentRun({ ...currentRun, status: "stopped" });
  }

  function copy(text: string) {
    if (!navigator.clipboard?.writeText) {
      window.prompt("Copy:", text);
      return;
    }
    navigator.clipboard.writeText(text).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    });
  }

  const All = Icons as unknown as Record<string, React.ComponentType<{ size?: number; color?: string }>>;

  return (
    <div className="p-3 space-y-3 text-xs">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Icons.Bot size={14} color="var(--accent)" />
          <span className="font-pixel text-sm tracking-widest" style={{ color: "var(--accent)" }}>★ COWORK · AUTONOMOUS AGENT</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setShowShare((s) => !s)} className="pill pill-muted" style={{ cursor: "pointer", fontSize: 9 }}>
            <Icons.Users size={10} /> SHARE
          </button>
        </div>
      </div>
      <p className="text-[color:var(--muted)] font-mono">
        Give a goal. Agent plans → executes (MCP + LLM) → delivers. Drafts emails, builds outlines, applies to jobs, researches anything.
      </p>

      {/* Optional tenant sharing */}
      {showShare && (
        <div className="card-pixel space-y-2" style={{ borderColor: "var(--surface-2)" }}>
          <div className="font-pixel text-[11px] tracking-widest" style={{ color: "var(--accent)" }}>TEAM TENANT</div>
          <div className="flex gap-2">
            <input
              className="input-pixel"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setTenant(draft)}
              placeholder="team_friday_demo"
            />
            <button onClick={() => setTenant(draft)} className="btn-pixel ghost" style={{ padding: "4px 8px", fontSize: 10 }}>JOIN</button>
          </div>
          {tenant && (
            <div className="flex gap-2 items-center">
              <code className="font-mono text-[10px] flex-1 truncate" style={{ background: "var(--bg)", padding: "4px 6px", border: "1px solid var(--surface-2)" }}>{shareUrl}</code>
              <button onClick={() => copy(shareUrl)} className="btn-pixel ghost" style={{ padding: "4px 8px", fontSize: 10 }}>
                {linkCopied ? <Icons.Check size={11} color="var(--success)" /> : <Icons.Copy size={11} />}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Goal input */}
      <div className="card-pixel space-y-2" style={{ background: "rgba(var(--surface-rgb), 0.5)", backdropFilter: "blur(8px)" }}>
        <textarea
          className="input-pixel"
          rows={3}
          placeholder="describe what you want me to do autonomously…"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          disabled={running}
        />
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value as ModelKey)}
            className="font-mono text-[10px]"
            style={{
              background: "var(--surface)",
              color: "var(--fg)",
              border: "1px solid var(--surface-2)",
              padding: "3px 6px",
            }}
            disabled={running}
          >
            {MODEL_CATALOG.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <div className="flex gap-1">
            {running ? (
              <button onClick={stop} className="btn-pixel danger" style={{ padding: "6px 12px", fontSize: 11 }}>■ STOP</button>
            ) : (
              <button onClick={run} className="btn-pixel success" disabled={!goal.trim()} style={{ padding: "6px 12px", fontSize: 11 }}>
                ▶ RUN AUTONOMOUS
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((p) => {
            const I = All[p.icon] ?? Icons.Zap;
            return (
              <button
                key={p.label}
                onClick={() => !running && setGoal(p.goal)}
                disabled={running}
                className="pill pill-muted"
                style={{ cursor: running ? "not-allowed" : "pointer", fontSize: 9 }}
              >
                <I size={9} /> {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Current run progress */}
      {currentRun && (
        <div className="card-pixel space-y-2" style={{ borderColor: currentRun.status === "done" ? "var(--success)" : "var(--accent)" }}>
          <div className="flex items-center justify-between">
            <span className="font-pixel text-[11px] tracking-widest" style={{ color: "var(--accent)" }}>
              {currentRun.status === "done" ? "✓ DELIVERED" : currentRun.status === "fail" ? "✗ FAILED" : currentRun.status === "stopped" ? "■ STOPPED" : `▶ ${currentRun.status.toUpperCase()}`}
            </span>
            <span className="font-mono text-[9px]" style={{ color: "var(--muted)" }}>
              {currentRun.steps.filter((s) => s.status === "done").length}/{currentRun.steps.length} steps
            </span>
          </div>
          <p className="font-mono text-[10px]" style={{ color: "var(--muted)" }}>{currentRun.goal}</p>
          <ul className="space-y-1">
            {currentRun.steps.map((s, i) => (
              <li key={s.id} className="flex items-start gap-2 font-mono text-[10px]">
                <span
                  className="flex-shrink-0 inline-flex items-center justify-center"
                  style={{
                    width: 18,
                    height: 18,
                    background:
                      s.status === "done"
                        ? "var(--success)"
                        : s.status === "running"
                          ? "var(--accent)"
                          : s.status === "fail"
                            ? "var(--danger)"
                            : "var(--surface-2)",
                    color: "var(--on-accent)",
                    fontSize: 9,
                  }}
                >
                  {s.status === "done" ? "✓" : s.status === "fail" ? "✗" : s.status === "running" ? "▶" : i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div style={{ color: "var(--fg)" }}>{s.label}{s.tool && <span style={{ color: "var(--muted)" }}> · {s.tool}</span>}</div>
                  {s.result && s.status === "done" && (
                    <details>
                      <summary className="cursor-pointer text-[9px]" style={{ color: "var(--muted)" }}>result {s.ms}ms</summary>
                      <div className="mt-1 p-1.5 whitespace-pre-wrap" style={{ background: "var(--bg)", color: "var(--fg)", fontSize: 10, maxHeight: 100, overflowY: "auto" }}>{s.result.slice(0, 600)}</div>
                    </details>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {currentRun.output && (
            <div className="mt-2 pt-2 border-t border-[color:var(--surface-2)]">
              <div className="flex items-center justify-between mb-1">
                <span className="font-pixel text-[10px] tracking-widest" style={{ color: "var(--success)" }}>★ OUTPUT</span>
                <button onClick={() => copy(currentRun.output!)} className="pill pill-muted" style={{ cursor: "pointer", fontSize: 9 }}>
                  <Icons.Copy size={9} /> COPY
                </button>
              </div>
              <div className="font-mono text-[11px] whitespace-pre-wrap leading-relaxed" style={{ color: "var(--fg)", background: "var(--bg)", padding: 8, maxHeight: 240, overflowY: "auto" }}>
                {currentRun.output}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Recent runs */}
      {recent.length > 0 && !currentRun && (
        <div className="card-pixel">
          <div className="font-pixel text-[10px] tracking-widest mb-2" style={{ color: "var(--muted)" }}>RECENT TASKS</div>
          <ul className="space-y-1">
            {recent.slice(0, 5).map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => setCurrentRun(r)}
                  className="w-full text-left font-mono text-[10px] flex items-center gap-2 py-1"
                  style={{ color: "var(--fg)", cursor: "pointer" }}
                >
                  <span style={{ color: r.status === "done" ? "var(--success)" : "var(--danger)" }}>{r.status === "done" ? "✓" : "✗"}</span>
                  <span className="truncate flex-1">{r.goal.slice(0, 60)}…</span>
                  <span style={{ color: "var(--muted)" }}>{new Date(r.startedAt).toLocaleTimeString()}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
