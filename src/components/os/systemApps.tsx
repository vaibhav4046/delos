"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import * as Icons from "lucide-react";
import type { RunEvent } from "@/lib/types";
import type { AppSpec } from "@/lib/appSpec";
import { AgentConstellation } from "@/components/AgentConstellation";
import { getModelOverrides } from "@/lib/useModelOverrides";
import { getTemperature } from "@/lib/useTemperature";
import { getIdentity, renderIdentityPreamble } from "@/lib/useIdentity";
import { getMcpServers } from "@/lib/useMcpServers";
import { getTenantId } from "@/lib/useTenant";
import { estimateCost } from "@/lib/cost";
import { processEventsForAchievements, awardAppBuilt } from "@/lib/achievements";
import { useSpeechToText, speak, getVoicePrefs, speechSupported } from "@/lib/useSpeech";
import { onIntent, broadcastAgent } from "@/lib/intentBus";
import { bumpCounters } from "@/components/os/CounterStrip";

function totals(events: RunEvent[]) {
  let pin = 0;
  let pout = 0;
  let calls = 0;
  let llmMs = 0;
  let cost = 0;
  for (const e of events) {
    if (e.t === "usage") {
      pin += e.promptTokens;
      pout += e.completionTokens;
      llmMs += e.ms;
      calls += 1;
      cost += estimateCost(e.model, e.promptTokens, e.completionTokens);
    }
  }
  return { pin, pout, calls, llmMs, cost };
}

export function Terminal({ onAnswer }: { onAnswer?: (text: string) => void }) {
  const [goal, setGoal] = useState("What is the capital of Japan? Be brief.");
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [steerText, setSteerText] = useState("");
  const ctrlRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const [base, setBase] = useState<number>(Date.now());
  const stt = useSpeechToText();
  const sup = speechSupported();

  // Sync STT transcript into goal input
  useEffect(() => {
    if (stt.transcript) setGoal(stt.transcript);
  }, [stt.transcript]);

  // Voice-action / intent bus subscription. Passes goal explicitly so run()
  // doesn't fire with the stale state captured in this effect's closure.
  useEffect(() => {
    return onIntent("terminal.run", (i) => {
      setGoal(i.goal);
      setTimeout(() => run(i.goal), 50);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events.length]);

  const t = useMemo(() => totals(events), [events]);

  async function sendSteer() {
    if (!runId || !steerText.trim()) return;
    try {
      await fetch("/api/steer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, instruction: steerText.trim() }),
      });
      setSteerText("");
    } catch {}
  }

  async function run(overrideGoal?: string) {
    if (running) return;
    const useGoal = overrideGoal ?? goal;
    // Easter-egg shortcut: goals starting with ":" are intercepted before /api/run
    const trimmed = useGoal.trim();
    if (trimmed.startsWith(":") && trimmed.length < 30) {
      window.dispatchEvent(new CustomEvent("delos-terminal-cmd", { detail: { cmd: trimmed } }));
      window.dispatchEvent(new CustomEvent("toast", { detail: { text: `easter egg fired: ${trimmed}`, tone: "ok" } }));
      return;
    }
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setEvents([]);
    setBase(Date.now());
    setRunId(null);
    setRunning(true);
    broadcastAgent("planner", "thinking");
    broadcastAgent("executor", "tool");
    broadcastAgent("critic", "thinking");
    broadcastAgent("memory", "thinking");
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: useGoal, chaos: [], maxSteps: 4, models: getModelOverrides(), mcpServers: getMcpServers(), tenantId: getTenantId(), temperature: getTemperature(), identity: renderIdentityPreamble(getIdentity()) || undefined }),
        signal: ctrl.signal,
      });
      if (!res.body) throw new Error("no stream");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
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
            const ev = JSON.parse(line.slice(6)) as RunEvent;
            setEvents((prev) => [...prev, ev]);
            if (ev.t === "meta") {
              setRunId(ev.runId);
              bumpCounters({ agents: 1 });
            }
            if (ev.t === "usage") {
              bumpCounters({
                requests: 1,
                tokens: ev.promptTokens + ev.completionTokens,
                usd: estimateCost(ev.model, ev.promptTokens, ev.completionTokens),
              });
            }
            if (ev.t === "answer") {
              if (onAnswer) onAnswer(ev.text);
              const prefs = getVoicePrefs();
              if (prefs.autoSpeak) speak(ev.text);
            }
          } catch {}
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setEvents((p) => [...p, { t: "error", message: (e as Error).message, at: Date.now() }]);
      }
    } finally {
      setRunning(false);
      broadcastAgent("planner", "done");
      broadcastAgent("executor", "done");
      broadcastAgent("critic", "done");
      broadcastAgent("memory", "done");
      setTimeout(() => {
        broadcastAgent("planner", "idle");
        broadcastAgent("executor", "idle");
        broadcastAgent("critic", "idle");
        broadcastAgent("memory", "idle");
      }, 1500);
      // Process achievements at end of run
      setEvents((all) => {
        const fresh = processEventsForAchievements(all);
        for (const a of fresh) {
          window.dispatchEvent(
            new CustomEvent("toast", { detail: { text: `🏆 ${a.label}`, tone: "ok" } }),
          );
        }
        return all;
      });
    }
  }

  return (
    <div className="p-3 h-full flex flex-col gap-2 text-xs">
      <div className="flex gap-2 items-center">
        <span className="font-pixel text-sm" style={{ color: "var(--accent)" }}>$</span>
        <input
          className="input-pixel flex-1"
          value={stt.state === "listening" ? goal + " " + stt.interim : goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          disabled={running}
          placeholder="give the agent a mission… (or click 🎤)"
        />
        {sup.stt && (
          <button
            type="button"
            onClick={() => (stt.state === "listening" ? stt.stop() : stt.start({ continuous: false }))}
            className={`btn-pixel ${stt.state === "listening" ? "danger" : "ghost"}`}
            style={{ padding: "8px 10px", fontSize: 11 }}
            title="Voice input"
          >
            {stt.state === "listening" ? <Icons.MicOff size={12} /> : <Icons.Mic size={12} />}
          </button>
        )}
        <button className="btn-pixel" style={{ padding: "8px 12px", fontSize: 11 }} onClick={() => run()} disabled={running}>
          {running ? "…" : "RUN"}
        </button>
      </div>

      <AgentConstellation events={events} compact />

      {running && runId && (
        <div className="card-pixel flex items-center gap-2" style={{ borderColor: "var(--warn)", boxShadow: "0 4px 0 0 #7a5e2a" }}>
          <Icons.Navigation size={14} color="var(--warn)" />
          <input
            className="input-pixel flex-1"
            style={{ padding: "6px 8px" }}
            placeholder="steer the running agent…"
            value={steerText}
            onChange={(e) => setSteerText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendSteer()}
          />
          <button onClick={sendSteer} className="btn-pixel" style={{ padding: "6px 10px", fontSize: 10, background: "var(--warn)" }}>
            ★ STEER
          </button>
        </div>
      )}

      <div className="grid grid-cols-5 gap-1 text-center">
        <Stat label="tok in" value={t.pin.toLocaleString()} />
        <Stat label="tok out" value={t.pout.toLocaleString()} />
        <Stat label="calls" value={String(t.calls)} />
        <Stat label="llm ms" value={t.llmMs.toLocaleString()} />
        <Stat label="cost" value={t.cost < 0.0001 ? "<$0.0001" : `$${t.cost.toFixed(4)}`} />
      </div>

      <div ref={logRef} className="flex-1 overflow-y-auto border-2 border-[color:var(--surface-2)] p-2 space-y-0.5 font-mono">
        {events.length === 0 && <div className="text-[color:var(--muted)]">terminal ready <span className="cursor" /></div>}
        {events.map((e, i) => <TermLine key={i} ev={e} base={base} />)}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-pixel py-1 px-2">
      <div className="font-pixel text-sm" style={{ color: "var(--accent)" }}>{value}</div>
      <div className="text-[10px] text-[color:var(--muted)] uppercase tracking-wider">{label}</div>
    </div>
  );
}

function TermLine({ ev, base }: { ev: RunEvent; base: number }) {
  const ts = ((ev.at - base) / 1000).toFixed(2) + "s";
  const tag = (cls: string, label: string) => (
    <span className={`pill ${cls} mr-1`} style={{ fontSize: 9, padding: "0 4px" }}>{label}</span>
  );
  switch (ev.t) {
    case "phase": return <div><span className="text-[color:var(--muted)]">{ts} </span>{tag("pill-info", ev.phase)} <span className="text-[color:var(--muted)]">{ev.note ?? ""}</span></div>;
    case "thought": return <div><span className="text-[color:var(--muted)]">{ts} </span>{tag("pill-muted", ev.agent)} {ev.text}</div>;
    case "tool_call": return <div><span className="text-[color:var(--muted)]">{ts} </span>{tag("pill-info", "→")} <span style={{ color: "var(--accent)" }}>{ev.name}</span></div>;
    case "tool_result": return <div><span className="text-[color:var(--muted)]">{ts} </span>{tag(ev.ok ? "pill-ok" : "pill-bad", ev.ok ? "✓" : "✗")} {ev.name}</div>;
    case "recover": return <div><span className="text-[color:var(--muted)]">{ts} </span>{tag("pill-ok", "1-UP")} {ev.strategy}</div>;
    case "adapt": return <div><span className="text-[color:var(--muted)]">{ts} </span>{tag("pill-warn", "WARP")} {ev.reason}</div>;
    case "subagent": return <div><span className="text-[color:var(--muted)]">{ts} </span>{tag(ev.status === "done" ? "pill-ok" : ev.status === "fail" ? "pill-bad" : "pill-warn", `sub ${ev.status}`)} <span style={{ color: "var(--accent)" }}>{ev.id.slice(-5)}</span> <span className="text-[color:var(--muted)]">{ev.result ?? ev.goal.slice(0, 60)}</span></div>;
    case "usage": return <div><span className="text-[color:var(--muted)]">{ts} </span>{tag("pill-muted", "llm")} <span style={{ color: "var(--accent)" }}>{ev.role}</span> <span className="text-[color:var(--muted)]">{ev.model}</span> <span style={{ color: "var(--fg)" }}>{ev.promptTokens}→{ev.completionTokens}t</span> <span className="text-[color:var(--muted)]">{ev.ms}ms</span></div>;
    case "answer": return <div className="my-1 pl-2 border-l-2" style={{ borderColor: "var(--accent)", color: "var(--fg)" }}>{tag("pill-info", "answer")} {ev.text}</div>;
    case "memory_write": return <div><span className="text-[color:var(--muted)]">{ts} </span>{tag("pill-info", "★")} save-state</div>;
    case "memory_recall": return <div><span className="text-[color:var(--muted)]">{ts} </span>{tag("pill-info", "recall")} {ev.hits} hits</div>;
    case "metric": return <div className="text-[color:var(--muted)]"><span>{ts} </span>{tag("pill-muted", "m")} {ev.key}={ev.value}</div>;
    case "error": return <div><span className="text-[color:var(--muted)]">{ts} </span>{tag("pill-bad", "ERR")} <span style={{ color: "var(--danger)" }}>{ev.message}</span></div>;
    default: return null;
  }
}

export function MissionControl() {
  const [runs, setRuns] = useState<Array<{ text: string; createdAt: number }>>([]);
  const [osbRunning, setOsbRunning] = useState(false);
  const [osbProgress, setOsbProgress] = useState<{ materialized: number; agents: number; tokens: number; usd: number; lastEvent: string } | null>(null);

  useEffect(() => {
    const tid = getTenantId();
    const url = `/api/memory?q=${encodeURIComponent("Run completed")}${tid ? `&tenantId=${encodeURIComponent(tid)}` : ""}`;
    fetch(url)
      .then((r) => r.json())
      .then((j: { local?: Array<{ text: string; createdAt: number }> }) => setRuns(j.local ?? []))
      .catch(() => {});
  }, []);

  async function launchOsBuilder() {
    if (osbRunning) return;
    setOsbRunning(true);
    setOsbProgress({ materialized: 0, agents: 0, tokens: 0, usd: 0, lastEvent: "starting…" });
    try {
      const res = await fetch("/api/os-builder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: getTenantId() }),
      });
      if (!res.body) throw new Error("no stream");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
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
            // App materialize → dispatch event for DelOS to spawn window
            if (ev.t === "tool_result" && ev.name === "app_materialize" && ev.result?.spec) {
              window.dispatchEvent(new CustomEvent("spawn-spec", { detail: ev.result.spec }));
              window.dispatchEvent(new CustomEvent("toast", { detail: { text: `★ app materialized: ${ev.result.spec.name}`, tone: "ok" } }));
              bumpCounters({ agents: 1 });
            }
            if (ev.t === "tool_result" && ev.name === "launch_app" && ev.result?.app === "doom") {
              window.dispatchEvent(new CustomEvent("delos-voice-action", { detail: { intent: "open_app", app: "doom" } }));
              window.dispatchEvent(new CustomEvent("toast", { detail: { text: "★ DOOM launched on new OS", tone: "ok" } }));
            }
            if (ev.t === "metric") {
              setOsbProgress((prev) => {
                if (!prev) return prev;
                const next = { ...prev };
                if (ev.key === "materialized") next.materialized = ev.value;
                if (ev.key === "agents") next.agents = ev.value;
                if (ev.key === "tokens") next.tokens = ev.value;
                if (ev.key === "usd") next.usd = ev.value;
                return next;
              });
              if (ev.key === "tokens") bumpCounters({ tokens: ev.value });
              if (ev.key === "usd") bumpCounters({ usd: ev.value });
              if (ev.key === "requests") bumpCounters({ requests: ev.value });
            }
            if (ev.t === "thought" || ev.t === "subagent") {
              const msg = ev.text ?? `${ev.goal?.slice(0, 50)} · ${ev.status}`;
              setOsbProgress((p) => (p ? { ...p, lastEvent: msg.slice(0, 80) } : p));
            }
            if (ev.t === "answer") {
              setOsbProgress((p) => (p ? { ...p, lastEvent: ev.text.slice(0, 120) } : p));
            }
          } catch {}
        }
      }
    } catch (e) {
      window.dispatchEvent(new CustomEvent("toast", { detail: { text: `os-builder failed: ${(e as Error).message}`, tone: "bad" } }));
    } finally {
      setOsbRunning(false);
    }
  }

  return (
    <div className="p-3 space-y-3 text-xs">
      <div className="card-pixel" style={{ borderColor: "var(--accent)", background: "rgba(var(--surface-rgb), 0.6)", backdropFilter: "blur(8px)" }}>
        <div className="font-pixel text-sm tracking-widest mb-1" style={{ color: "var(--accent)" }}>★ OS-BUILDER MISSION</div>
        <p className="text-[color:var(--muted)] text-[11px] mb-2">
          Spawn 5 sub-agents in parallel. Each builds one app via /api/build-app. Apps materialize as DelOS windows live. Final beat: Doom auto-launches on the new OS.
        </p>
        <button onClick={launchOsBuilder} disabled={osbRunning} className="btn-pixel success" style={{ padding: "6px 12px", fontSize: 11 }}>
          {osbRunning ? "BUILDING…" : "▶ LAUNCH MISSION"}
        </button>
        {osbProgress && (
          <div className="mt-2 font-mono text-[10px]" style={{ color: "var(--fg)" }}>
            <div className="flex gap-2 flex-wrap">
              <span className="pill pill-info" style={{ fontSize: 9 }}>{osbProgress.materialized} apps</span>
              <span className="pill pill-info" style={{ fontSize: 9 }}>{osbProgress.agents} agents</span>
              <span className="pill pill-muted" style={{ fontSize: 9 }}>{osbProgress.tokens.toLocaleString()} tok</span>
              <span className="pill pill-ok" style={{ fontSize: 9 }}>${osbProgress.usd.toFixed(4)}</span>
            </div>
            <div className="mt-1 truncate" style={{ color: "var(--muted)" }}>{osbProgress.lastEvent}</div>
          </div>
        )}
      </div>

      <div className="font-pixel text-sm tracking-wider mb-2" style={{ color: "var(--accent)" }}>RECENT MISSIONS</div>
      {runs.length === 0 && (
        <div className="text-[color:var(--muted)] font-mono">no missions yet — open the terminal and run one.</div>
      )}
      <ul className="space-y-2">
        {runs.slice().reverse().map((r, i) => (
          <li key={i} className="card-pixel">
            <div className="flex items-center justify-between mb-1">
              <span className="pill pill-info">#{runs.length - i}</span>
              <span className="text-[color:var(--muted)] font-mono">{new Date(r.createdAt).toLocaleTimeString()}</span>
            </div>
            <div className="font-mono text-xs leading-relaxed">{r.text}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function NotesApp() {
  const [items, setItems] = useState<string[]>([]);
  const [text, setText] = useState("");
  useEffect(() => {
    try {
      const raw = localStorage.getItem("delos.notes");
      if (raw) setItems(JSON.parse(raw));
    } catch {}
  }, []);
  function save(next: string[]) {
    setItems(next);
    try { localStorage.setItem("delos.notes", JSON.stringify(next)); } catch {}
  }
  return (
    <div className="p-3 space-y-2 text-xs">
      <div className="flex gap-2">
        <input
          className="input-pixel"
          placeholder="write a note…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) { save([text.trim(), ...items]); setText(""); } }}
        />
        <button
          className="btn-pixel"
          style={{ padding: "8px 12px", fontSize: 11 }}
          onClick={() => { if (text.trim()) { save([text.trim(), ...items]); setText(""); } }}
        >
          ADD
        </button>
      </div>
      <ul className="space-y-1">
        {items.length === 0 && <li className="text-[color:var(--muted)] font-mono">no notes yet.</li>}
        {items.map((n, i) => (
          <li key={i} className="card-pixel flex items-center justify-between gap-2">
            <span className="text-sm">{n}</span>
            <button onClick={() => save(items.filter((_, j) => j !== i))} aria-label="remove">
              <Icons.X size={14} color="var(--danger)" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AppBuilder({ onBuilt }: { onBuilt: (spec: AppSpec) => void }) {
  const [prompt, setPrompt] = useState("Build me a stopwatch with start/stop/reset.");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [stage, setStage] = useState<"idle" | "plan" | "spec" | "validate" | "mount" | "done">("idle");
  const [builtins, setBuiltins] = useState<Array<{ id: string; name: string; icon: string }>>([]);
  const [installingId, setInstallingId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/builtin-apps")
      .then((r) => r.json())
      .then((j: { ok: boolean; apps?: Array<{ id: string; name: string; icon: string }> }) => {
        if (alive && j.ok && j.apps) setBuiltins(j.apps);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  async function installBuiltin(id: string) {
    setInstallingId(id);
    setErr(null);
    try {
      const r = await fetch(`/api/builtin-apps?id=${encodeURIComponent(id)}`);
      const j = (await r.json()) as { ok: boolean; app?: AppSpec; reason?: string };
      if (!j.ok || !j.app) throw new Error(j.reason ?? `HTTP ${r.status}`);
      onBuilt(j.app);
      const ach = awardAppBuilt();
      if (ach) window.dispatchEvent(new CustomEvent("toast", { detail: { text: `🏆 ${ach.label}`, tone: "ok" } }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setInstallingId(null);
    }
  }

  useEffect(() => {
    return onIntent("builder.build", (i) => {
      setPrompt(i.prompt);
      // Pass prompt EXPLICITLY — React state update is async, build() reading
      // from closure would race and pick up the stale default ("stopwatch").
      // Was: setTimeout(() => build(), 50)
      setTimeout(() => build(i.prompt), 50);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const presets = [
    "Build me a stopwatch with start/stop/reset.",
    "Build a sticky-note board where I can add and remove notes.",
    "Build a haiku generator that uses the agent to write a haiku about a topic.",
    "Build a calculator that does +,-,*,/ using the calc tool.",
    "Build a habit tracker for the week with checkboxes.",
    "Build a tip calculator: bill amount + tip % → total per person.",
  ];

  // Curated production-grade templates — picked by judges/users for polish
  const TEMPLATES: Array<{ id: string; label: string; icon: string; prompt: string; tag: string }> = [
    { id: "dashboard", label: "Analytics Dashboard", icon: "BarChart3", tag: "BUSINESS", prompt: "Build an analytics dashboard with 4 KPI cards (revenue, users, conversion, churn), a line chart placeholder, and a top-5 sortable list. Each KPI fetches from /api/stats. Use the calc tool for derived metrics." },
    { id: "landing", label: "Product Landing Page", icon: "Globe", tag: "MARKETING", prompt: "Build a product landing page with hero, 3-feature grid, pricing table (3 tiers), and a CTA email-capture form that uses notes_append to save submissions. Bold typography, glassmorphism." },
    { id: "blog", label: "Markdown Blog", icon: "BookOpen", tag: "CONTENT", prompt: "Build a markdown blog reader with sidebar post list, main content pane that renders markdown via summarize tool, and a 'new post' button that uses the agent to draft 3 paragraphs on a topic." },
    { id: "saas-billing", label: "SaaS Billing Console", icon: "CreditCard", tag: "BUSINESS", prompt: "Build a SaaS billing console with current-plan card, usage meter (tokens this month), 5 recent invoice rows, upgrade button, and a downgrade-confirm modal. Persist plan choice." },
    { id: "kanban", label: "Kanban Board", icon: "Columns", tag: "PRODUCTIVITY", prompt: "Build a kanban board with 3 columns (Todo, Doing, Done), drag-free flow via buttons that move a card between columns. Each card has title + 2 tags. Persist to state." },
    { id: "ai-chat", label: "Multi-LLM Chat", icon: "MessageSquare", tag: "AI", prompt: "Build a multi-LLM chat where the same prompt fires the agent tool 3 times with different model overrides, and displays answers side-by-side in a 3-col grid with model labels and timing." },
    { id: "form-builder", label: "Form Builder", icon: "FileText", tag: "PRODUCTIVITY", prompt: "Build a no-code form builder: add text/number/textarea fields with labels, preview the form live, submit captures all field values into a submissions list. Export-to-JSON button." },
    { id: "recipe", label: "AI Recipe Card", icon: "Utensils", tag: "LIFESTYLE", prompt: "Build a recipe card generator: enter ingredient list + cuisine, agent returns a 3-step recipe + ingredient quantities. Save favorites locally. Toggle metric/imperial units." },
    { id: "timer", label: "Pomodoro Timer", icon: "Timer", tag: "PRODUCTIVITY", prompt: "Build a pomodoro timer with 25min work / 5min break cycles, start/pause/skip, session count, daily streak counter. Notification on cycle end." },
    { id: "search", label: "Web Search Console", icon: "Search", tag: "AI", prompt: "Build a web search console: input query, fire web_search tool, render top 5 results as cards with title/url/snippet, click-to-open. History sidebar." },
    { id: "polls", label: "Poll Booth", icon: "BarChartHorizontal", tag: "SOCIAL", prompt: "Build a poll booth: question input + 4 options, voters click an option, live bar chart of vote counts. 'New poll' resets. Persist active poll across reloads." },
    { id: "habit", label: "Habit Tracker", icon: "Calendar", tag: "LIFESTYLE", prompt: "Build a 7-day habit tracker grid: 5 habits × 7 days. Click cell to toggle done/not-done. Show weekly completion %. Add new habit button." },
  ];
  async function build(overridePrompt?: string) {
    const usePrompt = overridePrompt ?? prompt;
    setBusy(true);
    setErr(null);
    setStage("plan");
    broadcastAgent("planner", "thinking");
    broadcastAgent("executor", "thinking");
    // Tick stages on a soft timer so user sees progress before real fetch resolves
    const tStage1 = setTimeout(() => setStage("spec"), 700);
    const tStage2 = setTimeout(() => setStage("validate"), 1600);
    try {
      const r = await fetch("/api/build-app", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: usePrompt, models: getModelOverrides(), tenantId: getTenantId(), temperature: getTemperature(), identity: renderIdentityPreamble(getIdentity()) || undefined }),
      });
      const j = (await r.json()) as { spec?: AppSpec; error?: string };
      if (!r.ok || !j.spec) throw new Error(j.error ?? `HTTP ${r.status}`);
      setStage("mount");
      broadcastAgent("critic", "thinking");
      onBuilt(j.spec);
      setStage("done");
      broadcastAgent("planner", "done");
      broadcastAgent("executor", "done");
      broadcastAgent("critic", "done");
      broadcastAgent("memory", "done");
      const ach = awardAppBuilt();
      if (ach) {
        window.dispatchEvent(new CustomEvent("toast", { detail: { text: `🏆 ${ach.label}`, tone: "ok" } }));
      }
      setTimeout(() => {
        setStage("idle");
        broadcastAgent("planner", "idle");
        broadcastAgent("executor", "idle");
        broadcastAgent("critic", "idle");
        broadcastAgent("memory", "idle");
      }, 1200);
    } catch (e) {
      setErr((e as Error).message);
      setStage("idle");
      broadcastAgent("planner", "idle");
      broadcastAgent("executor", "idle");
    } finally {
      clearTimeout(tStage1);
      clearTimeout(tStage2);
      setBusy(false);
    }
  }
  const STAGES: Array<{ key: "plan" | "spec" | "validate" | "mount" | "done"; label: string }> = [
    { key: "plan", label: "plan" },
    { key: "spec", label: "spec" },
    { key: "validate", label: "validate" },
    { key: "mount", label: "mount" },
    { key: "done", label: "done" },
  ];
  return (
    <div className="p-3 space-y-3 text-xs">
      <div className="font-pixel text-sm tracking-wider" style={{ color: "var(--accent)" }}>★ AGENT APP BUILDER</div>
      <p className="text-[color:var(--muted)] font-mono">
        Describe an app. DelOS agents will generate the spec, validate it, mount it as a window. Saves to HydraDB so judges can recall it.
      </p>
      <textarea
        className="input-pixel"
        rows={3}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        disabled={busy}
      />
      <div className="flex flex-wrap gap-1">
        {presets.map((p) => (
          <button
            key={p}
            disabled={busy}
            onClick={() => setPrompt(p)}
            className="pill pill-muted"
            style={{ cursor: busy ? "not-allowed" : "pointer", fontSize: 9 }}
          >
            {p.slice(0, 24)}…
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-pixel text-[10px] tracking-widest" style={{ color: "var(--accent)" }}>★ PUBLISHABLE TEMPLATES</span>
          <span className="text-[9px] font-mono" style={{ color: "var(--muted)" }}>click to fill prompt</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {TEMPLATES.map((t) => {
            const TIcon = (Icons as unknown as Record<string, React.ComponentType<{ size?: number; color?: string }>>)[t.icon] ?? Icons.Box;
            return (
              <button
                key={t.id}
                disabled={busy}
                onClick={() => setPrompt(t.prompt)}
                className="card-pixel text-left flex flex-col gap-1"
                style={{
                  padding: 6,
                  cursor: busy ? "not-allowed" : "pointer",
                  background: prompt === t.prompt ? "var(--surface-2)" : "var(--surface)",
                  borderColor: prompt === t.prompt ? "var(--accent)" : "var(--surface-2)",
                  opacity: busy ? 0.5 : 1,
                  fontSize: 10,
                }}
                title={t.prompt}
              >
                <div className="flex items-center gap-1.5">
                  <TIcon size={11} color="var(--accent)" />
                  <span className="font-pixel text-[10px] tracking-wider truncate" style={{ color: "var(--fg)" }}>{t.label}</span>
                </div>
                <span className="pill pill-muted" style={{ fontSize: 8, padding: "1px 4px", alignSelf: "flex-start" }}>{t.tag}</span>
              </button>
            );
          })}
        </div>
      </div>
      {builtins.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-pixel text-[10px] tracking-widest" style={{ color: "var(--success)" }}>⚡ INSTANT INSTALL (no LLM)</span>
            <span className="text-[9px] font-mono" style={{ color: "var(--muted)" }}>{builtins.length} pre-built apps</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {builtins.map((b) => {
              const BIcon = (Icons as unknown as Record<string, React.ComponentType<{ size?: number; color?: string }>>)[b.icon] ?? Icons.Box;
              const installing = installingId === b.id;
              return (
                <button
                  key={b.id}
                  disabled={busy || installing}
                  onClick={() => installBuiltin(b.id)}
                  className="card-pixel text-left flex items-center gap-1.5"
                  style={{
                    padding: 8,
                    cursor: busy || installing ? "wait" : "pointer",
                    background: "var(--surface)",
                    borderColor: "var(--success)",
                    opacity: busy ? 0.4 : 1,
                    fontSize: 10,
                  }}
                  title={`Install ${b.name} instantly`}
                >
                  <BIcon size={12} color="var(--success)" />
                  <span className="font-pixel text-[10px] tracking-wider truncate" style={{ color: "var(--fg)" }}>
                    {installing ? "…installing" : b.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="flex gap-2 items-center">
        <button className="btn-pixel success" onClick={() => build()} disabled={busy} style={{ padding: "8px 14px", fontSize: 12 }}>
          {busy ? "BUILDING…" : "▶ BUILD APP"}
        </button>
        {busy && (
          <div className="text-[color:var(--muted)] font-mono flex items-center gap-1.5">
            <Icons.Loader2 size={14} className="animate-spin" />
            <span>agents at work</span>
          </div>
        )}
      </div>
      {/* Pipeline stages */}
      {(busy || stage === "done") && (
        <div className="flex items-center gap-1 mt-2 flex-wrap">
          {STAGES.map((s, i) => {
            const idx = STAGES.findIndex((x) => x.key === stage);
            const isActive = stage === s.key;
            const isDone = idx > i || stage === "done";
            return (
              <div key={s.key} className="flex items-center gap-1">
                <span
                  className={`pill ${isActive ? "pill-info" : isDone ? "pill-ok" : "pill-muted"}`}
                  style={{
                    fontSize: 9,
                    padding: "2px 6px",
                    transition: "all 200ms ease",
                  }}
                >
                  {isDone ? "✓" : isActive ? "▶" : "·"} {s.label}
                </span>
                {i < STAGES.length - 1 && (
                  <span className="font-pixel text-[10px]" style={{ color: isDone ? "var(--success)" : "var(--muted)" }}>
                    →
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {err && <div className="pill pill-bad">err: {err}</div>}
    </div>
  );
}

export function AboutApp() {
  return (
    <div className="p-4 space-y-2 text-sm">
      <div className="font-pixel text-xl tracking-wider" style={{ color: "var(--accent)" }}>DELOS v2.1</div>
      <p className="font-mono text-[color:var(--muted)] text-xs">
        A browser-OS where multi-agent orchestration is a first-class citizen. Built for the HydraDB &quot;Agents
        Under Pressure&quot; 48h hackathon.
      </p>
      <div className="grid grid-cols-2 gap-2 mt-2">
        <div className="card-pixel"><div className="font-pixel text-sm" style={{ color: "var(--accent)" }}>SAVE STATE</div><div className="text-xs text-[color:var(--muted)]">memory in HydraDB</div></div>
        <div className="card-pixel"><div className="font-pixel text-sm" style={{ color: "var(--accent)" }}>POWER-UPS</div><div className="text-xs text-[color:var(--muted)]">typed tools</div></div>
        <div className="card-pixel"><div className="font-pixel text-sm" style={{ color: "var(--accent)" }}>1-UP</div><div className="text-xs text-[color:var(--muted)]">cockatiel recovery</div></div>
        <div className="card-pixel"><div className="font-pixel text-sm" style={{ color: "var(--accent)" }}>WARP ZONE</div><div className="text-xs text-[color:var(--muted)]">drift + interrupt</div></div>
      </div>
      <div className="flex gap-1 mt-2 flex-wrap">
        <span className="pill pill-muted">Next 16</span>
        <span className="pill pill-muted">Groq</span>
        <span className="pill pill-muted">Mistral</span>
        <span className="pill pill-muted">HydraDB</span>
      </div>
    </div>
  );
}
