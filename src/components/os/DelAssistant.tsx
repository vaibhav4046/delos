"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import * as Icons from "lucide-react";
import { MODEL_CATALOG, type ModelKey } from "@/lib/llm.catalog";
import { broadcastAgent } from "@/lib/intentBus";
import { DelOSIcon } from "@/components/BrandIcons";

// Del Assistant — single AI app with Chat / Code / Cohort / Research modes,
// conversation sidebar, model selector, subagent fanout, clarifying-question orchestration.

type Mode = "chat" | "code" | "cohort" | "research";

type Msg = {
  id: string;
  role: "user" | "assistant" | "system" | "clarify";
  content: string;
  ts: number;
  ms?: number;
  tokens?: number;
  model?: string;
  mode?: Mode;
  options?: string[]; // for clarify role
};

type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  mode: Mode;
  model: ModelKey;
  messages: Msg[];
};

const STORE_KEY_BASE = "delos.assistant.v1";
const MAX_CONVS = 30;

// Per-user localStorage key. Falls back to a `_guest` namespace when no tenant is set
// (preserves anon history without ever surfacing it to a signed-in user).
function storeKey(): string {
  if (typeof window === "undefined") return STORE_KEY_BASE;
  try {
    const t = localStorage.getItem("delos.tenantId.v1");
    return `${STORE_KEY_BASE}.${t ?? "_guest"}`;
  } catch {
    return `${STORE_KEY_BASE}._guest`;
  }
}

function loadConvs(): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(storeKey());
    if (!raw) return [];
    return JSON.parse(raw) as Conversation[];
  } catch {
    return [];
  }
}

function saveConvs(convs: Conversation[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(storeKey(), JSON.stringify(convs.slice(0, MAX_CONVS)));
  } catch {}
}

function newConv(mode: Mode, model: ModelKey): Conversation {
  return {
    id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: "New conversation",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    mode,
    model,
    messages: [],
  };
}

const MODE_INFO: Record<Mode, { label: string; icon: string; hint: string; color: string }> = {
  chat: { label: "Chat", icon: "MessageSquare", hint: "Conversational replies", color: "var(--accent)" },
  code: { label: "Code", icon: "Code2", hint: "Code generation + spec apps", color: "var(--success)" },
  cohort: { label: "Cohort", icon: "Users", hint: "3-model race + judge merge", color: "var(--warn)" },
  research: { label: "Research", icon: "Search", hint: "Web-grounded answers", color: "var(--pipe)" },
};

const SYSTEM_PROMPTS: Record<Mode, string> = {
  chat:
    "You are Del Assistant, a helpful AI built on DelOS's multi-agent orchestration. Be concise, thoughtful, and direct. Use code blocks for code. Never hedge unnecessarily.",
  code:
    "You are a senior staff engineer. Write production-quality code. Default to TypeScript / Next.js unless asked otherwise. Wrap code in triple backticks with language. Explain decisions briefly above the code.",
  cohort:
    "Synthesize the strongest answer from multiple model perspectives. Be direct and structured.",
  research:
    "You are a research assistant. Cite sources inline like [1]. Be factual and current. If you're unsure, say so.",
};

export function DelAssistant() {
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  // Autonomous mode: when on, every user turn first hits /api/coordinator. The plan's
  // open_app actions dispatch into the OS intent bus; remaining actions are summarized
  // back to chat so the user sees what was done without lifting a finger.
  const [autonomous, setAutonomous] = useState(false);
  const [pendingClarify, setPendingClarify] = useState<{ original: string; options: string[] } | null>(null);
  const [subagentStatus, setSubagentStatus] = useState<Array<{ name: string; status: "idle" | "active" | "done" }>>([]);
  const ctrlRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  // Load on mount
  useEffect(() => {
    const c = loadConvs();
    setConvs(c);
    if (c.length > 0) setActiveId(c[0].id);
    else {
      const fresh = newConv("chat", "groq:openai/gpt-oss-120b");
      setConvs([fresh]);
      setActiveId(fresh.id);
    }
  }, []);

  const active = convs.find((c) => c.id === activeId) ?? null;

  // Ref mirror so async callbacks (stream readers) always see the latest activeId
  // without relying on stale closures — fixes the "empty assistant bubble" P0 bug
  // where deltas arrived but updateActive matched against a stale conv id.
  const activeIdRef = useRef<string | null>(null);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  // Persist convs whenever they change
  useEffect(() => {
    if (convs.length > 0) saveConvs(convs);
  }, [convs]);

  // Scroll to bottom on new message
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [active?.messages.length, streaming]);

  const updateActive = useCallback((mut: (c: Conversation) => Conversation) => {
    setConvs((prev) => prev.map((c) => (c.id === activeIdRef.current ? mut(c) : c)));
  }, []);

  function startNew(mode: Mode = "chat") {
    const fresh = newConv(mode, active?.model ?? "groq:openai/gpt-oss-120b");
    setConvs((p) => [fresh, ...p]);
    setActiveId(fresh.id);
    setInput("");
    setPendingClarify(null);
  }

  function deleteConv(id: string) {
    setConvs((p) => {
      const next = p.filter((c) => c.id !== id);
      if (id === activeId) setActiveId(next[0]?.id ?? null);
      return next;
    });
  }

  function setMode(mode: Mode) {
    updateActive((c) => ({ ...c, mode, updatedAt: Date.now() }));
  }

  function setModel(model: ModelKey) {
    updateActive((c) => ({ ...c, model, updatedAt: Date.now() }));
  }

  function summarizeTitle(prompt: string): string {
    const trim = prompt.trim().slice(0, 60);
    return trim.length < prompt.trim().length ? trim + "…" : trim;
  }

  // Decide if input needs clarifying question — heuristic.
  // Short ambiguous prompts trigger clarify; specific multi-clause ones skip.
  function needsClarify(text: string, mode: Mode): { options: string[] } | null {
    const t = text.trim();
    const words = t.split(/\s+/).length;
    // Skip clarify if very specific (long, has technical signals) or if user already clarified
    if (words > 15) return null;
    if (pendingClarify) return null;
    if (mode === "cohort" || mode === "research") return null;
    const lower = t.toLowerCase();
    // Common ambiguous phrases trigger clarify
    if (/^(build|make|create|write)\s+(me\s+)?(a|an|the)?\s*\w+/i.test(t) && words < 8) {
      return {
        options: [
          "Quick prototype — minimum viable code",
          "Production-ready — with error handling + tests",
          "Detailed plan first — design before code",
          "Just explain how — no code yet",
        ],
      };
    }
    if (/^(help|i need|how|what)/i.test(lower) && words < 6) {
      return {
        options: [
          "Step-by-step tutorial",
          "Brief overview",
          "Code example with comments",
          "Recommend a tool/library",
        ],
      };
    }
    if (mode === "code" && words < 6) {
      return {
        options: [
          "TypeScript / Next.js",
          "Python",
          "Rust / Go",
          "Plain JavaScript (no framework)",
        ],
      };
    }
    return null;
  }

  async function chooseClarifyOption(idx: number, customText?: string) {
    if (!pendingClarify) return;
    const choice = customText ?? pendingClarify.options[idx];
    const combined = `${pendingClarify.original}\n\nClarification: ${choice}`;
    setPendingClarify(null);
    await actuallySend(combined, true);
  }

  async function actuallySend(text: string, skipUserAppend = false) {
    if (!active) return;
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;

    // Unique stamps — multiple sends in same millisecond would collide on Date.now() alone.
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const userMsg: Msg = { id: `m-${stamp}-u`, role: "user", content: text, ts: Date.now(), mode: active.mode };
    const assistMsg: Msg = { id: `m-${stamp}-a`, role: "assistant", content: "", ts: Date.now(), mode: active.mode, model: active.model };
    const assistId = assistMsg.id;

    if (!skipUserAppend) {
      updateActive((c) => ({
        ...c,
        messages: [...c.messages, userMsg, assistMsg],
        title: c.messages.length === 0 ? summarizeTitle(text) : c.title,
        updatedAt: Date.now(),
      }));
    } else {
      updateActive((c) => ({ ...c, messages: [...c.messages, assistMsg], updatedAt: Date.now() }));
    }
    setInput("");
    setStreaming(true);

    // Broadcast subagent activity
    broadcastAgent("planner", "thinking");
    setSubagentStatus([
      { name: "planner", status: "active" },
      { name: "executor", status: "idle" },
      { name: "critic", status: "idle" },
    ]);
    setTimeout(() => {
      broadcastAgent("executor", "tool");
      setSubagentStatus([
        { name: "planner", status: "done" },
        { name: "executor", status: "active" },
        { name: "critic", status: "idle" },
      ]);
    }, 400);

    try {
      // Mode routing — pass assistId so stream readers update the exact message
      // by id, not by "last in array" (which races when new messages get appended).
      if (active.mode === "cohort") {
        await runCohort(text, ctrl, assistId);
      } else {
        await runChat(text, ctrl, assistId);
      }
      setSubagentStatus([
        { name: "planner", status: "done" },
        { name: "executor", status: "done" },
        { name: "critic", status: "done" },
      ]);
      broadcastAgent("critic", "done");
      broadcastAgent("memory", "done");
      setTimeout(() => {
        broadcastAgent("planner", "idle");
        broadcastAgent("executor", "idle");
        broadcastAgent("critic", "idle");
        setSubagentStatus([]);
      }, 1500);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      updateActive((c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === assistId ? { ...m, content: `[error: ${(e as Error).message}]` } : m
        ),
      }));
      broadcastAgent("planner", "idle");
      broadcastAgent("executor", "idle");
      broadcastAgent("critic", "idle");
      setSubagentStatus([]);
    } finally {
      setStreaming(false);
    }
  }

  async function runChat(text: string, ctrl: AbortController, assistId: string) {
    if (!active) return;
    const messages = active.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
      .concat([{ role: "user", content: text }]);

    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        model: active.model,
        system: SYSTEM_PROMPTS[active.mode],
        withSearch: active.mode === "research",
        searchMcpUrl: active.mode === "research" && typeof window !== "undefined" ? `${window.location.origin}/api/mcp/demo` : undefined,
      }),
      signal: ctrl.signal,
    });
    if (!r.body) throw new Error("no stream");
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let acc = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const p of parts) {
        const line = p.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        try {
          const ev = JSON.parse(line.slice(6));
          if (ev.t === "delta") {
            acc += ev.text;
            // Capture acc by value — closure inside map must not race with later deltas.
            const snapshot = acc;
            updateActive((c) => ({
              ...c,
              messages: c.messages.map((m) =>
                m.id === assistId ? { ...m, content: snapshot } : m
              ),
            }));
          } else if (ev.t === "done") {
            const finalContent = acc;
            updateActive((c) => ({
              ...c,
              messages: c.messages.map((m) =>
                m.id === assistId
                  ? { ...m, content: finalContent, ms: ev.ms, tokens: ev.completionTokens }
                  : m
              ),
            }));
          } else if (ev.t === "error") {
            // Server emitted an error event — surface the message so the bubble
            // isn't blank (otherwise UI falls into the "no response" fallback).
            const msg = `[error: ${ev.message ?? "agent stream failed"}]`;
            updateActive((c) => ({
              ...c,
              messages: c.messages.map((m) =>
                m.id === assistId ? { ...m, content: msg } : m
              ),
            }));
          }
        } catch {}
      }
    }
  }

  async function runCohort(text: string, ctrl: AbortController, assistId: string) {
    if (!active) return;
    // Use the three Groq models that are confirmed available on this
    // account's free tier. Gemini blows daily quota, Kimi K2 + Maverick
    // are paid-only and FAIL on cold call.
    const members: ModelKey[] = [
      "groq:openai/gpt-oss-120b",
      "groq:meta-llama/llama-4-scout-17b-16e-instruct",
      "groq:openai/gpt-oss-20b",
    ];
    const r = await fetch("/api/cohort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        goal: text,
        members,
        judge: "mistral:mistral-large-latest",
      }),
      signal: ctrl.signal,
    });
    if (!r.body) throw new Error("no stream");
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let merged = "";
    const memberStatus = new Map<number, string>();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const p of parts) {
        const line = p.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        try {
          const ev = JSON.parse(line.slice(6));
          if (ev.t === "cohort_member") {
            memberStatus.set(ev.index, ev.status);
            const summary = `Cohort race: ${[...memberStatus.entries()]
              .map(([i, s]) => `[${i}] ${s}`)
              .join(" · ")}`;
            if (!merged) {
              updateActive((c) => ({
                ...c,
                messages: c.messages.map((m) =>
                  m.id === assistId ? { ...m, content: summary } : m
                ),
              }));
            }
          } else if (ev.t === "cohort_verdict") {
            merged = `**Cohort verdict** — winner [${ev.winnerIndex}]\n\n${ev.merged}\n\n_${ev.rationale}_`;
            const finalMerged = merged;
            updateActive((c) => ({
              ...c,
              messages: c.messages.map((m) =>
                m.id === assistId ? { ...m, content: finalMerged } : m
              ),
            }));
          }
        } catch {}
      }
    }
  }

  async function sendAutonomous(text: string) {
    if (!active) return;
    const userMsg: Msg = { id: `m-${Date.now()}-u`, role: "user", content: text, ts: Date.now(), mode: active.mode };
    updateActive((c) => ({
      ...c,
      messages: [...c.messages, userMsg],
      title: c.messages.length === 0 ? summarizeTitle(text) : c.title,
      updatedAt: Date.now(),
    }));
    setInput("");
    setStreaming(true);
    try {
      const r = await fetch("/api/coordinator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: text }),
      });
      const j = (await r.json()) as { ok?: boolean; plan?: { summary: string; rationale: string; actions: Array<{ kind: string; target?: string; detail: string }> } };
      if (j.ok && j.plan) {
        // Dispatch any open_app actions onto the OS intent bus.
        const launched: string[] = [];
        for (const a of j.plan.actions) {
          if (a.kind === "open_app" && a.target) {
            try {
              window.dispatchEvent(new CustomEvent("delos-launch-app", { detail: { id: a.target } }));
              launched.push(a.target);
            } catch {}
          }
        }
        const summary = [
          `★ AUTONOMOUS PLAN`,
          j.plan.summary,
          ``,
          j.plan.rationale,
          ``,
          ...j.plan.actions.map((a) => `· [${a.kind}${a.target ? ":" + a.target : ""}] ${a.detail}`),
          launched.length > 0 ? `\n✓ launched: ${launched.join(", ")}` : "",
        ].filter(Boolean).join("\n");
        const reply: Msg = { id: `m-${Date.now()}-a`, role: "assistant", content: summary, ts: Date.now(), mode: active.mode };
        updateActive((c) => ({ ...c, messages: [...c.messages, reply], updatedAt: Date.now() }));
      } else {
        const err: Msg = { id: `m-${Date.now()}-a`, role: "assistant", content: "Coordinator failed — falling back to chat. Try toggling autonomous off.", ts: Date.now(), mode: active.mode };
        updateActive((c) => ({ ...c, messages: [...c.messages, err], updatedAt: Date.now() }));
      }
    } catch (e) {
      const err: Msg = { id: `m-${Date.now()}-a`, role: "assistant", content: (e as Error).message, ts: Date.now(), mode: active.mode };
      updateActive((c) => ({ ...c, messages: [...c.messages, err], updatedAt: Date.now() }));
    } finally {
      setStreaming(false);
    }
  }

  function send() {
    const text = input.trim();
    if (!text || streaming) return;
    if (!active) return;

    if (autonomous) {
      void sendAutonomous(text);
      return;
    }

    const cl = needsClarify(text, active.mode);
    if (cl && !pendingClarify) {
      // Insert clarify-bubble in conversation
      const userMsg: Msg = { id: `m-${Date.now()}-u`, role: "user", content: text, ts: Date.now(), mode: active.mode };
      const clarifyMsg: Msg = {
        id: `m-${Date.now()}-cl`,
        role: "clarify",
        content: "Quick question to nail the answer — pick one or write your own:",
        ts: Date.now(),
        options: cl.options,
      };
      updateActive((c) => ({
        ...c,
        messages: [...c.messages, userMsg, clarifyMsg],
        title: c.messages.length === 0 ? summarizeTitle(text) : c.title,
        updatedAt: Date.now(),
      }));
      setPendingClarify({ original: text, options: cl.options });
      setInput("");
      return;
    }
    actuallySend(text);
  }

  function stop() {
    ctrlRef.current?.abort();
    setStreaming(false);
  }

  const All = Icons as unknown as Record<string, React.ComponentType<{ size?: number; color?: string }>>;
  const sortedConvs = [...convs].sort((a, b) => b.updatedAt - a.updatedAt);

  if (!active) {
    return <div className="p-4 text-xs text-[color:var(--muted)]">Loading…</div>;
  }

  return (
    <div className="flex h-full text-xs" style={{ minHeight: 480 }}>
      {/* Sidebar */}
      {showSidebar && (
        <aside
          className="flex flex-col gap-1 p-2 overflow-y-auto"
          style={{
            width: 200,
            borderRight: "2px solid var(--surface-2)",
            background: "rgba(var(--surface-rgb), 0.4)",
            backdropFilter: "blur(8px)",
          }}
        >
          <button
            onClick={() => startNew(active.mode)}
            className="btn-pixel success"
            style={{ padding: "8px 10px", fontSize: 11 }}
          >
            <Icons.Plus size={12} /> NEW CHAT
          </button>
          <div className="font-pixel text-[9px] tracking-widest mt-2 mb-1 px-1" style={{ color: "var(--muted)" }}>
            RECENT
          </div>
          {sortedConvs.length === 0 && (
            <div className="text-[10px] font-mono text-[color:var(--muted)] px-1">no chats yet</div>
          )}
          {sortedConvs.map((c) => {
            const Mc = All[MODE_INFO[c.mode].icon] ?? Icons.MessageSquare;
            const isActive = c.id === activeId;
            return (
              <div key={c.id} className="group relative">
                <button
                  onClick={() => setActiveId(c.id)}
                  className="w-full text-left flex items-center gap-1.5 px-1.5 py-1 transition-colors"
                  style={{
                    background: isActive ? "var(--surface-2)" : "transparent",
                    borderLeft: `2px solid ${isActive ? MODE_INFO[c.mode].color : "transparent"}`,
                    cursor: "pointer",
                  }}
                >
                  <Mc size={10} color={MODE_INFO[c.mode].color} />
                  <span className="font-mono text-[10px] truncate flex-1" style={{ color: isActive ? "var(--fg)" : "var(--muted)" }}>
                    {c.title}
                  </span>
                </button>
                <button
                  onClick={() => deleteConv(c.id)}
                  className="absolute right-0 top-0 bottom-0 px-1.5 opacity-0 group-hover:opacity-100"
                  style={{ background: "var(--surface-2)", cursor: "pointer" }}
                  title="Delete"
                >
                  <Icons.Trash2 size={9} color="var(--danger)" />
                </button>
              </div>
            );
          })}
        </aside>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar — mode + model selector */}
        <div
          className="flex items-center justify-between gap-2 p-2 flex-wrap"
          style={{
            borderBottom: "2px solid var(--surface-2)",
            background: "rgba(var(--surface-rgb), 0.4)",
            backdropFilter: "blur(8px)",
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => setShowSidebar((s) => !s)}
              className="pill pill-muted"
              style={{ cursor: "pointer", fontSize: 9 }}
              title="Toggle sidebar"
            >
              <Icons.PanelLeft size={10} />
            </button>
            <DelOSIcon size={16} color="var(--accent)" />
            <span className="font-pixel text-sm tracking-widest" style={{ color: "var(--fg)" }}>
              DEL ASSISTANT
            </span>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {(["chat", "code", "cohort", "research"] as Mode[]).map((m) => {
              const I = All[MODE_INFO[m].icon] ?? Icons.MessageSquare;
              const on = active.mode === m;
              return (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className="pill"
                  style={{
                    fontSize: 9,
                    padding: "3px 8px",
                    cursor: "pointer",
                    background: on ? MODE_INFO[m].color : "var(--surface)",
                    color: on ? "var(--on-accent)" : "var(--fg)",
                    border: `1px solid ${on ? MODE_INFO[m].color : "var(--surface-2)"}`,
                  }}
                  title={MODE_INFO[m].hint}
                >
                  <I size={10} /> {MODE_INFO[m].label.toUpperCase()}
                </button>
              );
            })}
            <select
              value={active.model}
              onChange={(e) => setModel(e.target.value as ModelKey)}
              className="font-mono text-[10px]"
              style={{
                background: "var(--surface)",
                color: "var(--fg)",
                border: "1px solid var(--surface-2)",
                padding: "3px 4px",
                marginLeft: 4,
              }}
            >
              {MODEL_CATALOG.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Subagent strip — visible while running */}
        {subagentStatus.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5" style={{ background: "rgba(var(--bg-rgb), 0.4)", borderBottom: "1px solid var(--surface-2)" }}>
            <span className="font-pixel text-[9px] tracking-widest" style={{ color: "var(--accent)" }}>★ AGENTS</span>
            {subagentStatus.map((s, i) => (
              <span key={i} className="font-mono text-[9px] flex items-center gap-1">
                <span
                  style={{
                    width: 5,
                    height: 5,
                    display: "inline-block",
                    background: s.status === "active" ? "var(--accent)" : s.status === "done" ? "var(--success)" : "var(--surface-2)",
                  }}
                  className={s.status === "active" ? "accent-pulse" : ""}
                />
                <span style={{ color: "var(--muted)" }}>{s.name}</span>
                {i < subagentStatus.length - 1 && <span style={{ color: "var(--muted)" }}>→</span>}
              </span>
            ))}
          </div>
        )}

        {/* Conversation log */}
        <div ref={logRef} className="flex-1 overflow-y-auto p-3 space-y-3">
          {active.messages.length === 0 && (
            <EmptyState
              mode={active.mode}
              onPick={(p) => {
                // Fill input AND auto-send so suggestions feel like one-tap starters
                // (previously they only set input and required a second click on SEND).
                setInput(p);
                setTimeout(() => {
                  if (!streaming && active) {
                    actuallySend(p);
                  }
                }, 30);
              }}
            />
          )}
          {active.messages.map((m) => (
            <MsgBubble key={m.id} msg={m} onClarifyPick={chooseClarifyOption} pendingClarify={pendingClarify} />
          ))}
          {streaming && active.messages[active.messages.length - 1]?.content === "" && (
            <div className="flex items-center gap-2 text-[10px] font-mono" style={{ color: "var(--muted)" }}>
              <Icons.Loader2 size={11} className="animate-spin" />
              <span>thinking with {active.model.split(":").pop()}…</span>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="p-2 border-t-2 border-[color:var(--surface-2)]" style={{ background: "rgba(var(--surface-rgb), 0.5)", backdropFilter: "blur(8px)" }}>
          {pendingClarify && (
            <div className="mb-2 text-[10px] font-mono" style={{ color: "var(--muted)" }}>
              clarifying ↑ — pick option above or type below
            </div>
          )}
          <div className="mb-2 flex items-center justify-between">
            <button
              onClick={() => setAutonomous((v) => !v)}
              className={`pill cursor-pointer ${autonomous ? "pill-ok" : "pill-muted"}`}
              style={{ fontSize: 9, padding: "2px 8px" }}
              title="When on, your input routes through the coordinator and the OS launches apps automatically."
            >
              {autonomous ? "● AUTONOMOUS · ON" : "○ autonomous · off"}
            </button>
            <span className="font-mono" style={{ fontSize: 9, color: "var(--muted)" }}>
              {autonomous ? "agent acts on apps + memory" : "chat mode"}
            </span>
          </div>
          <div className="flex gap-2 items-end">
            <textarea
              className="input-pixel flex-1 resize-none"
              rows={2}
              placeholder={pendingClarify ? "Or write your own answer…" : "Ask anything…  (Shift+Enter = newline)"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (pendingClarify) {
                    chooseClarifyOption(-1, input.trim());
                  } else {
                    send();
                  }
                }
              }}
              disabled={streaming}
              style={{ minHeight: 40, fontSize: 12 }}
            />
            <div className="flex flex-col gap-1">
              {streaming ? (
                <button onClick={stop} className="btn-pixel danger" style={{ padding: "6px 10px", fontSize: 11 }}>
                  ■ STOP
                </button>
              ) : (
                <button
                  onClick={send}
                  disabled={!input.trim()}
                  className="btn-pixel success"
                  style={{ padding: "6px 10px", fontSize: 11 }}
                >
                  ▶ SEND
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between mt-1.5 text-[9px] font-mono" style={{ color: "var(--muted)" }}>
            <span>
              mode <strong style={{ color: MODE_INFO[active.mode].color }}>{active.mode.toUpperCase()}</strong> · {active.messages.filter((m) => m.role !== "clarify").length} msgs
            </span>
            <span>↵ send · ⇧↵ newline</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ mode, onPick }: { mode: Mode; onPick: (p: string) => void }) {
  const presets: Record<Mode, string[]> = {
    chat: [
      "Explain why graph databases beat vector DBs for agent memory in 3 bullets.",
      "What's the difference between RAG and fine-tuning?",
      "Write a one-paragraph elevator pitch for a multi-agent OS.",
    ],
    code: [
      "Build a stopwatch React component in TypeScript.",
      "Write a Python script that scrapes Hacker News top 10.",
      "Create a SQL query for monthly active users from a 'events' table.",
    ],
    cohort: [
      "Compare 3 LLMs on this: explain quantum entanglement in 4 lines.",
      "Which framework should I pick: Next.js / Astro / SvelteKit? Race + merge.",
      "Best name for a sleep-tracking app — race 3 models.",
    ],
    research: [
      "Latest news on the HydraDB hackathon.",
      "What is the bitcoin price right now?",
      "Find 3 recent papers on agent memory architectures.",
    ],
  };
  return (
    <div className="text-center py-8">
      <div className="font-pixel text-lg tracking-widest mb-2" style={{ color: MODE_INFO[mode].color }}>
        {MODE_INFO[mode].label.toUpperCase()} MODE
      </div>
      <p className="text-[color:var(--muted)] font-mono text-[11px] mb-4">{MODE_INFO[mode].hint}</p>
      <div className="grid sm:grid-cols-1 gap-2 max-w-md mx-auto">
        {presets[mode].map((p) => (
          <button
            key={p}
            onClick={() => onPick(p)}
            className="card-pixel text-left"
            style={{ padding: "8px 10px", cursor: "pointer", fontSize: 11 }}
          >
            <span className="font-mono" style={{ color: "var(--fg)" }}>{p}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function MsgBubble({
  msg,
  onClarifyPick,
  pendingClarify,
}: {
  msg: Msg;
  onClarifyPick: (idx: number, custom?: string) => void;
  pendingClarify: { original: string; options: string[] } | null;
}) {
  if (msg.role === "clarify") {
    return (
      <div
        className="card-pixel space-y-2"
        style={{ borderColor: "var(--accent)", background: "rgba(var(--surface-rgb), 0.6)", backdropFilter: "blur(8px)" }}
      >
        <div className="flex items-center gap-2">
          <Icons.HelpCircle size={12} color="var(--accent)" />
          <span className="font-pixel text-[10px] tracking-widest" style={{ color: "var(--accent)" }}>
            CLARIFY
          </span>
        </div>
        <p className="font-mono text-[11px]" style={{ color: "var(--fg)" }}>{msg.content}</p>
        <div className="grid sm:grid-cols-2 gap-1.5">
          {(msg.options ?? []).map((o, i) => (
            <button
              key={i}
              onClick={() => onClarifyPick(i)}
              disabled={!pendingClarify}
              className="card-pixel text-left"
              style={{
                padding: "6px 8px",
                cursor: pendingClarify ? "pointer" : "not-allowed",
                opacity: pendingClarify ? 1 : 0.6,
                fontSize: 10,
              }}
            >
              <span className="font-pixel mr-1.5" style={{ color: "var(--accent)" }}>{i + 1}</span>
              <span style={{ color: "var(--fg)" }}>{o}</span>
            </button>
          ))}
          <div
            className="font-mono text-[10px] flex items-center"
            style={{ color: "var(--muted)", padding: "0 8px" }}
          >
            5. Other → type below
          </div>
        </div>
      </div>
    );
  }
  const isUser = msg.role === "user";
  return (
    <div className="flex gap-2 items-start" style={{ flexDirection: isUser ? "row-reverse" : "row" }}>
      <div
        className="font-pixel text-[9px] tracking-widest flex items-center justify-center flex-shrink-0"
        style={{
          width: 26,
          height: 26,
          background: isUser ? "var(--surface-2)" : MODE_INFO[msg.mode ?? "chat"].color,
          color: isUser ? "var(--fg)" : "var(--on-accent)",
          border: `2px solid ${isUser ? "var(--surface-2)" : MODE_INFO[msg.mode ?? "chat"].color}`,
        }}
      >
        {isUser ? "YOU" : "DEL"}
      </div>
      <div
        className="flex-1 min-w-0 card-pixel"
        style={{
          padding: "8px 10px",
          background: isUser ? "rgba(var(--surface-rgb), 0.5)" : "var(--surface)",
          backdropFilter: isUser ? "blur(6px)" : undefined,
          borderColor: isUser ? "var(--surface-2)" : MODE_INFO[msg.mode ?? "chat"].color,
        }}
      >
        <MessageContent content={msg.content} />
        {msg.ms !== undefined && (
          <div className="mt-1.5 flex gap-2 text-[9px] font-mono" style={{ color: "var(--muted)" }}>
            <span>{msg.ms}ms</span>
            {msg.tokens !== undefined && <span>· {msg.tokens} tok</span>}
            {msg.model && <span>· {msg.model.split(":").pop()}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function MessageContent({ content }: { content: string }) {
  // Empty or whitespace-only content means a send failed or was interrupted.
  // Render a clear hint instead of a blank bubble.
  if (!content || !content.trim()) {
    return (
      <p className="font-mono text-[10px] italic" style={{ color: "var(--warn)" }}>
        ⚠ no response — agent stream was interrupted. tap RUN again or send a new message.
      </p>
    );
  }
  // Render code blocks (```lang\n…\n```) as styled <pre>
  const parts = content.split(/(```[\s\S]*?```)/);
  return (
    <div className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words" style={{ color: "var(--fg)" }}>
      {parts.map((p, i) => {
        if (p.startsWith("```")) {
          const code = p.replace(/^```\w*\n?/, "").replace(/```$/, "");
          return (
            <pre
              key={i}
              className="my-2 p-2 overflow-x-auto"
              style={{
                background: "var(--bg)",
                border: "1px solid var(--surface-2)",
                fontSize: 10,
                color: "var(--accent)",
              }}
            >
              {code}
            </pre>
          );
        }
        return <span key={i}>{p}</span>;
      })}
    </div>
  );
}
