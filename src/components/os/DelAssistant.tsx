"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import * as Icons from "lucide-react";
import { MODEL_CATALOG, type ModelKey } from "@/lib/llm.catalog";
import { broadcastAgent } from "@/lib/intentBus";
import { DelOSIcon } from "@/components/BrandIcons";
import { useSpeechToText } from "@/lib/useSpeech";

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
  memRecall?: number; // how many memory hits informed this answer
  steps?: number;     // tool calls / agent steps taken
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
    const convs = JSON.parse(raw) as Conversation[];
    // Reconcile orphaned in-flight turns · an assistant message persisted with
    // empty content means its stream was interrupted by a reload/close before
    // any delta arrived. The original send()'s finally-block (which would have
    // swapped in a retry notice) lives in a now-dead JS context, so without
    // this every such bubble renders as "thinking…" forever. loadConvs runs
    // only at mount, where no stream can be active, so every empty assistant
    // bubble here is definitively orphaned → give it a clear interrupted state.
    return convs.map((c) => ({
      ...c,
      messages: Array.isArray(c.messages)
        ? c.messages.map((m) =>
            m.role === "assistant" && !m.content?.trim()
              ? { ...m, content: "(interrupted — a reload cleared this in-flight reply. Ask again to retry.)" }
              : m,
          )
        : [],
    }));
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

// Default model for new conversations. Groq's free tier is the fastest
// (~110-180ms first token) and most generous of the keyed providers, so new
// chats start there and serve directly — the picker label matches reality. If
// Groq's quota is ever hit, /api/chat cascades to Mistral then Gemini, so the
// default is resilient without being a guaranteed-cascade pick (Gemini's
// 20-req/day free tier would always fall through).
const DEFAULT_MODEL: ModelKey = "groq:openai/gpt-oss-120b";

export function DelAssistant() {
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Ref mirror of convs so the voice "continue last thread" intent (fired from
  // the OS bus, []-deps effect) always resumes the freshest conversation.
  const convsRef = useRef<Conversation[]>([]);
  const [input, setInput] = useState("");
  // Voice mic · Whisper-large-v3 STT for autonomous MCP actions
  // (Gmail draft / Notion create / GitHub list / GDrive list). On
  // transcript arrival we drop it into the input and auto-send so the
  // user can ask "draft email to anna@acme.com about Q3 roadmap" with
  // their voice and the assistant fires the MCP call.
  const chatStt = useSpeechToText();
  useEffect(() => {
    if (chatStt.transcript && !streaming) {
      const text = chatStt.transcript.trim();
      chatStt.setTranscript("");
      if (text) {
        setInput(text);
        // Defer the actual send so React commits the input update first
        // (otherwise the empty-input guard in send() fires before
        // controlled state catches up).
        setTimeout(() => {
          setInput("");
          void actuallySend(text);
        }, 60);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatStt.transcript]);
  const chatMicActive = chatStt.state === "listening" || chatStt.state === "recording";
  const [streaming, setStreaming] = useState(false);
  // Voice / OS bus integration · external code (voice handler in os/page,
  // assistant.ask intent) drops a fully-formed user turn into the chat
  // via the `delos-intent` event. Skips the input box so the autonomous
  // MCP path is one hop instead of two. 2026-05-25 judge finding.
  useEffect(() => {
    function onIntent(e: Event) {
      const d = (e as CustomEvent).detail as { kind?: string; text?: string };
      if (d?.kind === "assistant.ask" && typeof d.text === "string" && d.text.trim()) {
        // Defer one tick so any concurrent spawn / focus reducer settles.
        setTimeout(() => {
          void actuallySend(d.text!.trim());
        }, 80);
      } else if (d?.kind === "assistant.resumeLast") {
        // Voice "continue last thread" · resume the most-recently-updated
        // conversation into a fresh thread seeded with recalled swarm context.
        const latest = [...convsRef.current].sort((a, b) => b.updatedAt - a.updatedAt)[0];
        if (latest) setTimeout(() => void resumeFrom(latest), 80);
      }
    }
    window.addEventListener("delos-intent", onIntent as EventListener);
    return () => window.removeEventListener("delos-intent", onIntent as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [showSidebar, setShowSidebar] = useState(true);
  // Cross-thread recall · search the recursive swarm-context window across ALL
  // of this user's threads/runs. Powers "continue anywhere" and the sidebar
  // recall box.
  const [recallQ, setRecallQ] = useState("");
  const [recallHits, setRecallHits] = useState<Array<{ source: string; text: string; threadId?: string; at: number }> | null>(null);
  const [recallBusy, setRecallBusy] = useState(false);
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
      const fresh = newConv("chat", DEFAULT_MODEL);
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
  useEffect(() => { convsRef.current = convs; }, [convs]);

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
    const fresh = newConv(mode, active?.model ?? DEFAULT_MODEL);
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

  // Continue-anywhere · spin up a BRAND NEW thread seeded with the recursive
  // context recalled from a past conversation. The new thread owns its own id
  // going forward, but starts with a recap so the user (and the model, via the
  // server-side recall on the next turn) picks up exactly where they left off.
  async function resumeFrom(conv: Conversation) {
    const fresh = newConv(conv.mode, conv.model);
    fresh.title = `↪ ${conv.title}`.slice(0, 60);
    const noteId = `m-${Date.now()}-resume`;
    fresh.messages = [{ id: noteId, role: "system", content: "Recalling where we left off…", ts: Date.now(), mode: conv.mode }];
    setConvs((p) => [fresh, ...p]);
    setActiveId(fresh.id);
    setInput("");
    setPendingClarify(null);
    const anchorQuery =
      [...conv.messages].reverse().find((m) => m.role === "user")?.content?.slice(0, 400) || conv.title;
    try {
      const r = await fetch("/api/context/recall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: anchorQuery, threadId: conv.id, tokenBudget: 1600, maxDepth: 8 }),
      });
      const data = (await r.json().catch(() => null)) as { hints?: string[]; items?: unknown[]; memoryHits?: number } | null;
      const hints = (data?.hints ?? []).slice(0, 10);
      const body = hints.length
        ? `↪ Resuming from "${conv.title}" — recalled ${hints.length} context item${hints.length === 1 ? "" : "s"} from the swarm window:\n\n${hints.map((h) => `• ${h}`).join("\n")}\n\nAsk your next question and I'll continue with this context.`
        : `↪ Resuming from "${conv.title}" — no prior context was found to recall. Start typing and I'll pick it up from here.`;
      setConvs((p) => p.map((c) => (c.id === fresh.id ? { ...c, messages: c.messages.map((m) => (m.id === noteId ? { ...m, content: body } : m)) } : c)));
    } catch {
      setConvs((p) => p.map((c) => (c.id === fresh.id ? { ...c, messages: c.messages.map((m) => (m.id === noteId ? { ...m, content: `↪ Resuming from "${conv.title}" — context recall failed; continuing fresh.` } : m)) } : c)));
    }
  }

  // Cross-thread recall search · query the recursive window across every thread
  // and run this user owns. Results are clickable → drop into the composer.
  async function runRecallSearch() {
    const q = recallQ.trim();
    if (!q) {
      setRecallHits(null);
      return;
    }
    setRecallBusy(true);
    try {
      const r = await fetch("/api/context/recall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, tokenBudget: 1200 }),
      });
      const data = (await r.json().catch(() => null)) as { items?: Array<{ source: string; text: string; threadId?: string; at: number }> } | null;
      setRecallHits(data?.items ?? []);
    } catch {
      setRecallHits([]);
    } finally {
      setRecallBusy(false);
    }
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

  // Detect autonomous MCP actions BEFORE hitting the LLM. Lets Del do
  // Gmail / Notion / GitHub things without the user opening a separate
  // app. Replaces the dedicated Cowork window (now removed from dock).
  async function tryMcpAction(text: string): Promise<string | null> {
    const s = text.trim();
    // Gmail · DRAFT (safe — saves to user's drafts, never auto-sends)
    let m = s.match(/^(?:please\s+)?(?:draft|compose|write)\s+(?:an?\s+)?email\s+to\s+([\w._+-]+@[\w.-]+\.\w+)\s+(?:saying|about|with|that|re:?)\s+(.+)$/i);
    if (m) {
      const to = m[1];
      const body = m[2];
      const subject = body.slice(0, 60);
      try {
        const r = await fetch("/api/connectors/gmail/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to, subject, body }),
        });
        const j = (await r.json()) as { ok?: boolean; draftId?: string; error?: string };
        if (!r.ok || !j.ok) return `Could not draft email — ${j.error ?? `HTTP ${r.status}`}. Connect Gmail in Settings → Connectors.`;
        return `✓ Gmail draft saved · to: ${to} · subject: "${subject}" · review it in your Drafts folder before sending.`;
      } catch (e) {
        return `Gmail draft failed: ${(e as Error).message}`;
      }
    }
    // Gmail · LIST (read-only)
    m = s.match(/^(?:show|read|check|list)\s+(?:my\s+)?(?:gmail|inbox|emails?)(?:\s+(?:for\s+|about\s+|matching\s+)?(.+))?$/i);
    if (m) {
      const q = m[1]?.trim() ?? "";
      try {
        const r = await fetch("/api/connectors/gmail/list", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q, limit: 10 }),
        });
        const j = (await r.json()) as { ok?: boolean; messages?: Array<{ subject: string; from: string; snippet?: string }>; error?: string };
        if (!r.ok || !j.ok) return `Could not read inbox — ${j.error ?? `HTTP ${r.status}`}. Connect Gmail in Settings → Connectors.`;
        const lines = (j.messages ?? []).slice(0, 10).map((x, i) => `${i + 1}. ${x.subject} — ${x.from}`);
        return lines.length > 0 ? `★ Inbox (${lines.length})\n${lines.join("\n")}` : "Inbox is empty for that query.";
      } catch (e) {
        return `Gmail list failed: ${(e as Error).message}`;
      }
    }
    // Notion · CREATE PAGE
    m = s.match(/^(?:create|make|add)\s+(?:a\s+)?notion\s+(?:page|doc|note)\s+(?:titled|called|named|about|on)\s+["']?([^"']{2,120}?)["']?(?:\s+(?:with|saying|containing)\s+(.{2,2000}))?$/i);
    if (m) {
      const title = m[1].trim();
      const content = m[2]?.trim() ?? title;
      try {
        const r = await fetch("/api/connectors/notion/create-page", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, content }),
        });
        const j = (await r.json()) as { ok?: boolean; url?: string; pageId?: string; error?: string };
        if (!r.ok || !j.ok) return `Could not create Notion page — ${j.error ?? `HTTP ${r.status}`}. Connect Notion in Settings → Connectors.`;
        return j.url ? `✓ Notion page created · ${title}\n${j.url}` : `✓ Notion page created · ${title}`;
      } catch (e) {
        return `Notion create failed: ${(e as Error).message}`;
      }
    }
    // GitHub · LIST REPOS (read-only). Uses an unauthenticated GH search
    // when no token is configured; with GITHUB_TOKEN it lists the user's
    // private repos too.
    m = s.match(/^(?:show|list|what(?:'s| is)?)\s+(?:my\s+)?(?:github\s+)?repos?(?:itories)?(?:\s+for\s+([\w.-]+))?$/i);
    if (m) {
      const user = m[1]?.trim();
      try {
        // Always proxy through our server route — never hit api.github.com
        // from the browser (leaks client IP, can't attach GITHUB_TOKEN). The
        // route takes an optional `username` to list a specific user's repos.
        const r = await fetch("/api/connectors/github/list", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(user ? { username: user } : {}),
        });
        if (!r.ok) return `Could not list GitHub repos — HTTP ${r.status}.`;
        const j = (await r.json()) as { ok?: boolean; repos?: Array<{ full_name: string; description?: string }>; error?: string };
        const list = j.repos ?? [];
        if (list.length === 0) return "No repos found.";
        const lines = list.slice(0, 10).map((x, i) => `${i + 1}. ${x.full_name}${x.description ? " — " + x.description.slice(0, 80) : ""}`);
        return `★ GitHub repos (${lines.length})\n${lines.join("\n")}`;
      } catch (e) {
        return `GitHub list failed: ${(e as Error).message}`;
      }
    }
    // GDrive · LIST FILES (read-only). Triggered by "list my drive",
    // "show my recent drive files", "find my drive doc about X".
    m = s.match(/^(?:show|list|find|search|open)\s+(?:my\s+)?(?:google\s+)?drive(?:\s+(?:doc(?:s|ument(?:s)?)?|files?))?(?:\s+(?:for|about|matching|named|with|containing)\s+(.+))?$/i);
    if (m) {
      const q = m[1]?.trim() ?? "";
      try {
        const r = await fetch("/api/connectors/gdrive/list", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q, limit: 10 }),
        });
        const j = (await r.json()) as {
          ok?: boolean;
          files?: Array<{ name: string; type: string; modifiedAt?: string | null; url?: string | null }>;
          error?: string;
          hint?: string;
        };
        if (!r.ok || !j.ok) {
          return `Could not list Drive — ${j.error ?? `HTTP ${r.status}`}${j.hint ? ` · ${j.hint}` : ""}.`;
        }
        const list = j.files ?? [];
        if (list.length === 0) return q ? `No Drive files match "${q}".` : "Drive is empty.";
        const lines = list.slice(0, 10).map((x, i) => `${i + 1}. ${x.name}${x.url ? ` · ${x.url}` : ""}`);
        return `★ Drive files (${lines.length}${q ? ` matching "${q}"` : ""})\n${lines.join("\n")}`;
      } catch (e) {
        return `GDrive list failed: ${(e as Error).message}`;
      }
    }
    return null;
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
      // Autonomous MCP path · Gmail draft / inbox list / Notion create /
      // GitHub repo list. Short-circuits the LLM when the user asked for
      // a specific platform action. Replaces the old Cowork window.
      const mcpReply = await tryMcpAction(text);
      if (mcpReply !== null) {
        updateActive((c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === assistId ? { ...m, content: mcpReply } : m,
          ),
        }));
        setSubagentStatus([]);
        return;
      }
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
      // Aborted stream (user navigated away, sent a new message, or hit
      // Stop) was leaving an empty assistant bubble in history that
      // rendered as "no response — agent stream was interrupted" forever.
      // Drop the placeholder so the conversation history stays clean.
      if ((e as Error).name === "AbortError") {
        updateActive((c) => ({
          ...c,
          messages: c.messages.filter((m) => !(m.id === assistId && !m.content)),
        }));
        return;
      }
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
      // Post-stream cleanup · if the assistant placeholder is STILL empty
      // here (stream closed without any delta + no error fired — e.g.
      // server returned 200 but immediately closed) replace it with a
      // friendly retry message so the UI never strands a blank "no
      // response" bubble. Was the bug visible in the 2026-05-25 screenshot.
      updateActive((c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === assistId && !m.content.trim()
            ? { ...m, content: "(retry — the model returned nothing. Try again or pick a different mode.)" }
            : m
        ),
      }));
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
        // Swarm context · the conversation id is a stable thread key. The server
        // recalls this thread's recursive context window (plus cross-thread
        // memory) into the system prompt and persists both turns. This is what
        // lets a chat "remember" across threads and seed continue-anywhere.
        threadId: active.id,
        mode: active.mode,
      }),
      signal: ctrl.signal,
    });
    if (!r.body) throw new Error("no stream");
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let acc = "";
    // Stall watchdog: a dead upstream (provider hangs mid-stream, proxy drops
    // the connection without FIN) leaves reader.read() pending forever and the
    // UI stuck in "streaming". Re-arm a 30s inactivity timer on every chunk; if
    // nothing arrives in that window, mark an empty bubble and abort so the
    // catch in sendMessage runs and streaming state clears. First-token latency
    // on cold free tiers is well under 30s, and each delta resets the timer, so
    // a slow-but-alive stream never trips it.
    const STALL_MS = 30_000;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const armStall = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        updateActive((c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === assistId && !m.content.trim()
              ? { ...m, content: "(no response — the stream stalled. Try again.)" }
              : m
          ),
        }));
        ctrl.abort();
      }, STALL_MS);
    };
    armStall();
    try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      armStall(); // got bytes — reset the inactivity timer
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
                  // ev.model is the model that ACTUALLY served — after a
                  // cascade (keyless/failed provider → next candidate) it
                  // differs from active.model, so record it here to keep the
                  // "why this answer" footer honest instead of showing the
                  // requested-but-skipped model.
                  ? { ...m, content: finalContent, ms: ev.ms, tokens: ev.completionTokens, model: ev.model ?? m.model }
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
    } finally {
      if (watchdog) clearTimeout(watchdog);
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
    // BUG-5 fix · defensive empty-input guard. Caller already trims + bails
    // in send(), but autonomous mode also fires off agent broadcasts that
    // bump the counter strip — keep the early-return here too.
    if (!text || !text.trim() || !active) return;
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

  // MCP autonomous-pattern detector · returns true for verbs that
  // tryMcpAction handles (Gmail / Notion / GitHub / GDrive). Used to
  // short-circuit the needsClarify heuristic which was intercepting
  // these and showing a "pick one of: quick prototype / production
  // ready / detailed plan / just explain how" picker for prompts like
  // "create notion page titled X". 2026-05-25 E2E test bug.
  function isMcpPattern(text: string): boolean {
    const s = text.trim().toLowerCase();
    return (
      /^(?:please\s+)?(?:draft|compose|write|send)\s+(?:an?\s+)?email\b/i.test(s) ||
      /^(?:show|read|check|list)\s+(?:my\s+)?(?:gmail|inbox|emails?)\b/i.test(s) ||
      /^(?:create|make|add)\s+(?:a\s+)?notion\s+(?:page|doc|note)\b/i.test(s) ||
      /^(?:write|save)\s+(?:this\s+)?to\s+notion\b/i.test(s) ||
      /^(?:show|list|what(?:'s| is)?)\s+(?:my\s+)?(?:github\s+)?repos?(?:itories)?\b/i.test(s) ||
      /^(?:show|list|find|search|open)\s+(?:my\s+)?(?:google\s+)?drive\b/i.test(s)
    );
  }

  function send() {
    const text = input.trim();
    if (!text || streaming) return;
    if (!active) return;

    if (autonomous) {
      void sendAutonomous(text);
      return;
    }

    // MCP autonomous patterns must reach actuallySend → tryMcpAction
    // directly, NEVER the clarify picker. Without this short-circuit
    // "create notion page titled X" got intercepted and showed code-
    // style clarify options.
    if (isMcpPattern(text)) {
      void actuallySend(text);
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
  const SRC_DOT: Record<string, string> = {
    user: "var(--accent)",
    assistant: "var(--accent-2)",
    agent: "#7CE3B0",
    subagent: "#9AD0FF",
    tool: "#C9A8FF",
    memory: "#FFC76B",
    system: "var(--muted)",
  };

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

          {/* Cross-thread recall · search the recursive swarm window across every thread */}
          <div className="font-pixel text-[9px] tracking-widest mt-2 mb-1 px-1" style={{ color: "var(--muted)" }}>
            RECALL · ALL THREADS
          </div>
          <div className="flex items-center gap-1">
            <div className="flex-1 flex items-center gap-1 px-1.5 py-1" style={{ background: "var(--surface)", border: "1px solid var(--surface-2)" }}>
              <Icons.Search size={10} color="var(--muted)" />
              <input
                value={recallQ}
                onChange={(e) => setRecallQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void runRecallSearch(); } }}
                placeholder="search every thread + memory…"
                aria-label="Search across all threads and memory"
                className="flex-1 bg-transparent outline-none font-mono text-[10px]"
                style={{ color: "var(--fg)", minWidth: 0 }}
              />
              {recallQ && (
                <button
                  onClick={() => { setRecallQ(""); setRecallHits(null); }}
                  style={{ cursor: "pointer", lineHeight: 0 }}
                  title="Clear"
                >
                  <Icons.X size={10} color="var(--muted)" />
                </button>
              )}
            </div>
          </div>
          {recallBusy && (
            <div className="text-[10px] font-mono px-1 py-0.5" style={{ color: "var(--muted)" }}>
              searching swarm…
            </div>
          )}
          {recallHits && !recallBusy && (
            <div className="flex flex-col gap-0.5 mt-0.5 mb-1">
              {recallHits.length === 0 && (
                <div className="text-[10px] font-mono px-1" style={{ color: "var(--muted)" }}>no matches</div>
              )}
              {recallHits.slice(0, 12).map((h, i) => (
                <button
                  key={`${h.at}-${i}`}
                  onClick={() => { setInput(h.text); setRecallHits(null); setRecallQ(""); }}
                  className="w-full text-left flex items-start gap-1 px-1.5 py-1 transition-colors hover:bg-[color:var(--surface-2)]"
                  style={{ cursor: "pointer", borderLeft: `2px solid ${SRC_DOT[h.source] ?? "var(--muted)"}` }}
                  title={`${h.source}${h.threadId ? ` · ${h.threadId.slice(0, 8)}` : ""} — click to reuse`}
                >
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: SRC_DOT[h.source] ?? "var(--muted)", marginTop: 4, flexShrink: 0 }} />
                  <span className="font-mono text-[10px] flex-1" style={{ color: "var(--muted)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {h.text}
                  </span>
                </button>
              ))}
            </div>
          )}

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
                <div
                  className="absolute right-0 top-0 bottom-0 flex items-stretch opacity-70 group-hover:opacity-100 transition-opacity"
                  style={{ background: "var(--surface-2)" }}
                >
                  <button
                    onClick={() => void resumeFrom(c)}
                    className="px-1.5 flex items-center"
                    style={{ cursor: "pointer" }}
                    title="Resume · continue in a new thread with recalled context"
                    aria-label="Resume this conversation in a new thread with recalled context"
                  >
                    <Icons.CornerDownLeft size={10} color="var(--accent)" />
                  </button>
                  <button
                    onClick={() => deleteConv(c.id)}
                    className="px-1.5 flex items-center"
                    style={{ cursor: "pointer" }}
                    title="Delete"
                    aria-label="Delete this conversation"
                  >
                    <Icons.Trash2 size={9} color="var(--danger)" />
                  </button>
                </div>
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
              maxLength={8000}
              onChange={(e) => setInput(e.target.value.slice(0, 8000))}
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
            {/* SEND is the dominant primary (tall, wide); MIC is a compact
                secondary tucked beneath with a clear gap so a click aimed at
                SEND can't land on the mic toggle (was: equal-size buttons 4px
                apart → frequent misclicks that silently toggled dictation). */}
            <div className="flex flex-col gap-2">
              {streaming ? (
                <button
                  onClick={stop}
                  className="btn-pixel danger"
                  style={{ padding: "12px 14px", fontSize: 12, minWidth: 76 }}
                >
                  ■ STOP
                </button>
              ) : (
                <button
                  onClick={send}
                  disabled={!input.trim()}
                  className="btn-pixel success"
                  style={{ padding: "12px 14px", fontSize: 12, minWidth: 76, fontWeight: 700 }}
                >
                  ▶ SEND
                </button>
              )}
              <button
                onClick={() => {
                  if (chatMicActive) chatStt.stop();
                  else chatStt.start();
                }}
                disabled={streaming}
                className={`btn-pixel ${chatMicActive ? "danger" : "ghost"}`}
                title={chatMicActive ? "stop dictation" : "dictate · say 'draft email to X', 'create notion page', 'list my repos', 'list my drive'"}
                style={{ padding: "5px 10px", fontSize: 10, opacity: chatMicActive ? 1 : 0.75 }}
              >
                {chatStt.state === "transcribing" ? "… listening" : chatMicActive ? "■ stop mic" : "🎙 dictate"}
              </button>
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
        {!isUser && msg.content.trim() && (
          <AssistWhyFooter msg={msg} />
        )}
      </div>
    </div>
  );
}

function AssistWhyFooter({ msg }: { msg: Msg }) {
  const [open, setOpen] = useState(false);
  const modeLabel = msg.mode ? { chat: "Chat", code: "Code", cohort: "Cohort race", research: "Research + search" }[msg.mode] : "Chat";
  const modelShort = msg.model ? msg.model.split(":").pop() ?? msg.model : null;
  return (
    <div className="mt-1.5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="font-mono text-[9px] flex items-center gap-1"
        style={{ color: "var(--muted)", background: "none", border: "none", padding: 0, cursor: "pointer" }}
      >
        {open ? "▾" : "▸"} why this answer
      </button>
      {open && (
        <div
          className="mt-1 p-2 font-mono text-[9px] space-y-0.5"
          style={{ background: "var(--bg)", border: "1px solid var(--surface-2)", color: "var(--muted)" }}
        >
          <div><span style={{ color: "var(--fg)" }}>mode</span> {modeLabel}</div>
          {modelShort && <div><span style={{ color: "var(--fg)" }}>model</span> {modelShort}</div>}
          {msg.ms !== undefined && <div><span style={{ color: "var(--fg)" }}>latency</span> {msg.ms}ms</div>}
          {msg.tokens !== undefined && <div><span style={{ color: "var(--fg)" }}>tokens</span> {msg.tokens}</div>}
          {msg.memRecall !== undefined && <div><span style={{ color: "var(--fg)" }}>memory hits</span> {msg.memRecall} prior runs recalled</div>}
          {msg.steps !== undefined && <div><span style={{ color: "var(--fg)" }}>steps</span> {msg.steps} tool calls</div>}
        </div>
      )}
    </div>
  );
}

// Render inline [1], [2] etc as styled citation badges (Perplexity-style trust)
function renderCitations(text: string): React.ReactNode[] {
  const parts = text.split(/(\[\d+\])/g);
  return parts.map((p, i) => {
    const m = p.match(/^\[(\d+)\]$/);
    if (m) {
      return (
        <span
          key={i}
          className="inline-flex items-center justify-center"
          style={{
            background: "var(--accent)",
            color: "var(--on-accent)",
            fontSize: 8,
            fontWeight: 700,
            borderRadius: 3,
            padding: "0 4px",
            marginInline: 2,
            verticalAlign: "super",
            lineHeight: "14px",
            minWidth: 14,
            textAlign: "center",
          }}
          title={`Source ${m[1]}`}
        >
          {m[1]}
        </span>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

function MessageContent({ content }: { content: string }) {
  // Empty bubble usually means a stream is still warming up (placeholder
  // inserted before first delta arrives). Render a soft thinking hint —
  // the post-stream cleanup in actuallySend() replaces the bubble with a
  // friendly retry message if the model truly returned nothing, so this
  // path should only flash during the first ~200ms of a normal send.
  if (!content || !content.trim()) {
    return (
      <p className="font-mono text-[10px] italic flex items-center gap-1.5" style={{ color: "var(--muted)" }}>
        <span className="accent-pulse w-2 h-2" style={{ background: "var(--accent)" }} />
        thinking…
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
        // Render citation badges [1] [2] etc in plain text segments
        return <span key={i}>{renderCitations(p)}</span>;
      })}
    </div>
  );
}
