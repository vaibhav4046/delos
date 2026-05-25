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
import { enhanceBuildPrompt } from "@/lib/appPromptEnhancer";

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

// del-terminal — CRT-style CLI shell. Black background, phosphor-green
// text, blinking cursor, ASCII banner, command history (↑↓), tab-complete.
// Built-in commands: help, clear, ls, apps, launch <app>, ai <prompt>,
// run <goal>, echo, date, whoami, pwd, neofetch, history, theme, exit.
// `ai <prompt>` / `run <goal>` still hit the real /api/run streaming
// pipeline. Easter-egg `:matrix` / `:doom` / `:varun` still work.
type TermOut =
  | { kind: "input"; prompt: string; cmd: string }
  | { kind: "stdout"; text: string }
  | { kind: "stderr"; text: string }
  | { kind: "ascii"; text: string }
  | { kind: "event"; ev: RunEvent };

const BUILTIN_HELP = [
  "Built-in commands:",
  "  help                show this message",
  "  clear / cls         wipe screen",
  "  ls / apps           list installed DelOS apps",
  "  launch <app>        open an app by id (e.g. launch builder)",
  "  ai <prompt>         ask the multi-agent loop a question",
  "  run <goal>          alias for `ai` (full agent run)",
  "  whoami              print current tenant identity",
  "  pwd                 print virtual working directory",
  "  date                print current ISO datetime",
  "  echo <text>         print text",
  "  history             show command history",
  "  neofetch            ASCII system info splash",
  "  weather             NYC current temp (Open-Meteo, no key)",
  "  price <coin>        crypto price + 24h change (CoinGecko)",
  "  fx <FROM> <TO>      live currency rate (Frankfurter)",
  "  lookup <query>      DuckDuckGo instant answer",
  "  theme               cycle wallpaper",
  "  exit                close this terminal",
  "",
  "Easter eggs: :matrix · :doom · :varun · :konami",
];

const NEOFETCH = [
  "",
  "       ██████╗ ███████╗██╗      ██████╗ ███████╗",
  "       ██╔══██╗██╔════╝██║     ██╔═══██╗██╔════╝",
  "       ██║  ██║█████╗  ██║     ██║   ██║███████╗",
  "       ██║  ██║██╔══╝  ██║     ██║   ██║╚════██║",
  "       ██████╔╝███████╗███████╗╚██████╔╝███████║",
  "       ╚═════╝ ╚══════╝╚══════╝ ╚═════╝ ╚══════╝",
  "",
  "  os:      DelOS v2.1 (agents under pressure)",
  "  shell:   delos-terminal",
  "  kernel:  Next.js 16 / React 19",
  "  cpu:     multi-agent loop · planner→executor→critic→memory",
  "  memory:  HydraDB (tenant-scoped)",
  "  models:  Groq · Mistral · Gemini · OpenRouter · ElevenLabs",
  "  uptime:  see top bar",
  "",
];

const APP_IDS = [
  "assistant","identity","cohort","arena","voice","cowork",
  "builder","codebase","cores","mission",
  "ingest","terminal","browser","marketplace","analytics",
  "files","notes","calendar","calc","sysinfo",
  "snake","tictactoe","memory","minesweeper","game2048","doom",
  "settings","about",
];

export function Terminal({ onAnswer }: { onAnswer?: (text: string) => void }) {
  const [lines, setLines] = useState<TermOut[]>(() => [
    { kind: "ascii", text: NEOFETCH.join("\n") },
    { kind: "stdout", text: "Welcome to DelOS Terminal. Type `help` for commands. `ai hello` to query agents." },
  ]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [cwd, setCwd] = useState("~");
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [steerText, setSteerText] = useState("");
  const ctrlRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const baseRef = useRef<number>(Date.now());
  const stt = useSpeechToText();
  const sup = speechSupported();

  const tenant = (typeof window !== "undefined" && getTenantId()) || "guest";
  const prompt = `${tenant}@delos:${cwd}$ `;

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lines.length]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (stt.transcript && !running) setInput(stt.transcript);
  }, [stt.transcript, running]);

  useEffect(() => {
    return onIntent("terminal.run", (i) => {
      setInput(`ai ${i.goal}`);
      setTimeout(() => handleSubmit(`ai ${i.goal}`), 50);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function push(line: TermOut) {
    setLines((p) => [...p, line]);
  }

  function clearScreen() {
    setLines([]);
  }

  function tabComplete() {
    const v = input.trim();
    if (!v) return;
    const parts = v.split(/\s+/);
    if (parts.length === 1) {
      const builtins = ["help","clear","cls","ls","apps","launch","ai","run","whoami","pwd","date","echo","history","neofetch","theme","exit"];
      const matches = builtins.filter((b) => b.startsWith(parts[0]));
      if (matches.length === 1) setInput(matches[0] + " ");
      else if (matches.length > 1) push({ kind: "stdout", text: matches.join("  ") });
    } else if (parts[0] === "launch") {
      const matches = APP_IDS.filter((a) => a.startsWith(parts[1] ?? ""));
      if (matches.length === 1) setInput(`launch ${matches[0]}`);
      else if (matches.length > 1) push({ kind: "stdout", text: matches.join("  ") });
    }
  }

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

  async function runAgent(goal: string) {
    if (running) return;
    push({ kind: "stdout", text: `▶ launching agent loop for: ${goal}` });
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setRunId(null);
    setRunning(true);
    baseRef.current = Date.now();
    broadcastAgent("planner", "thinking");
    broadcastAgent("executor", "tool");
    broadcastAgent("critic", "thinking");
    broadcastAgent("memory", "thinking");
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal, chaos: [], maxSteps: 4, models: getModelOverrides(), mcpServers: getMcpServers(), tenantId: getTenantId(), temperature: getTemperature(), identity: renderIdentityPreamble(getIdentity()) || undefined }),
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
            push({ kind: "event", ev });
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
              push({ kind: "stdout", text: `◆ answer: ${ev.text}` });
              if (onAnswer) onAnswer(ev.text);
              const prefs = getVoicePrefs();
              if (prefs.autoSpeak) speak(ev.text);
            }
          } catch {}
        }
      }
      push({ kind: "stdout", text: "✓ agent loop complete." });
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        push({ kind: "stderr", text: `✗ ${(e as Error).message}` });
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
    }
  }

  async function handleSubmit(override?: string) {
    const raw = (override ?? input).trim();
    if (!raw) return;
    push({ kind: "input", prompt, cmd: raw });
    if (raw !== history[history.length - 1]) {
      setHistory((h) => [...h.slice(-49), raw]);
    }
    setInput("");
    setHistoryIdx(-1);

    // Easter eggs
    if (raw.startsWith(":") && raw.length < 30) {
      window.dispatchEvent(new CustomEvent("delos-terminal-cmd", { detail: { cmd: raw } }));
      push({ kind: "stdout", text: `🥚 easter egg dispatched: ${raw}` });
      return;
    }

    const [cmd, ...args] = raw.split(/\s+/);
    const rest = args.join(" ");

    switch (cmd) {
      case "help":
      case "?":
        push({ kind: "stdout", text: BUILTIN_HELP.join("\n") });
        break;
      case "clear":
      case "cls":
        clearScreen();
        break;
      case "ls":
      case "apps":
        push({ kind: "stdout", text: APP_IDS.join("  ") });
        break;
      case "launch":
      case "open": {
        if (!rest) { push({ kind: "stderr", text: "usage: launch <app>" }); break; }
        if (!APP_IDS.includes(rest)) { push({ kind: "stderr", text: `unknown app: ${rest}` }); break; }
        window.dispatchEvent(new CustomEvent("delos-launch-app", { detail: { app: rest } }));
        push({ kind: "stdout", text: `↗ launched ${rest}` });
        break;
      }
      case "ai":
      case "run":
        if (!rest) { push({ kind: "stderr", text: `usage: ${cmd} <prompt>` }); break; }
        await runAgent(rest);
        break;
      case "whoami":
        push({ kind: "stdout", text: tenant });
        break;
      case "pwd":
        push({ kind: "stdout", text: `/home/${tenant}` });
        break;
      case "cd":
        setCwd(rest || "~");
        break;
      case "date":
        push({ kind: "stdout", text: new Date().toISOString() });
        break;
      case "echo":
        push({ kind: "stdout", text: rest });
        break;
      case "history":
        push({ kind: "stdout", text: history.map((h, i) => `${String(i + 1).padStart(3)}  ${h}`).join("\n") });
        break;
      case "neofetch":
        push({ kind: "ascii", text: NEOFETCH.join("\n") });
        break;
      case "lookup":
      case "ddg": {
        if (!rest) { push({ kind: "stderr", text: `usage: ${cmd} <query>` }); break; }
        push({ kind: "stdout", text: `⌕ DuckDuckGo: ${rest}` });
        try {
          const r = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(rest)}&format=json&no_html=1&skip_disambig=1`);
          const j = await r.json();
          if (j.AbstractText) push({ kind: "stdout", text: j.AbstractText });
          else if (j.RelatedTopics?.[0]?.Text) push({ kind: "stdout", text: j.RelatedTopics[0].Text });
          else push({ kind: "stderr", text: "no instant answer. Try `ai " + rest + "` for agent fallback." });
          if (j.AbstractURL) push({ kind: "stdout", text: "↗ " + j.AbstractURL });
        } catch (e) {
          push({ kind: "stderr", text: `lookup failed: ${(e as Error).message}` });
        }
        break;
      }
      case "weather": {
        try {
          const r = await fetch("https://api.open-meteo.com/v1/forecast?latitude=40.7128&longitude=-74.006&current=temperature_2m,weather_code,wind_speed_10m");
          const j = await r.json();
          const c = j.current;
          push({ kind: "stdout", text: `NYC · ${Math.round(c.temperature_2m)}°C · code ${c.weather_code} · wind ${c.wind_speed_10m} km/h` });
        } catch {
          push({ kind: "stderr", text: "weather offline" });
        }
        break;
      }
      case "price":
      case "crypto": {
        const sym = (rest || "btc").toLowerCase();
        const id = sym === "btc" ? "bitcoin" : sym === "eth" ? "ethereum" : sym === "sol" ? "solana" : sym;
        try {
          const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true`);
          const j = await r.json();
          const k = j[id];
          if (!k) { push({ kind: "stderr", text: `unknown coin: ${sym}` }); break; }
          const chg = k.usd_24h_change ?? 0;
          push({ kind: "stdout", text: `${id.toUpperCase()} · $${k.usd.toLocaleString()} · ${chg > 0 ? "+" : ""}${chg.toFixed(2)}% (24h)` });
        } catch {
          push({ kind: "stderr", text: "coingecko offline" });
        }
        break;
      }
      case "fx": {
        const [from = "USD", to = "EUR"] = rest.split(/\s+/);
        try {
          const r = await fetch(`https://api.frankfurter.app/latest?from=${from.toUpperCase()}&to=${to.toUpperCase()}`);
          const j = await r.json();
          if (!j.rates) { push({ kind: "stderr", text: "fx pair not found" }); break; }
          const rate = Object.values(j.rates)[0] as number;
          push({ kind: "stdout", text: `1 ${from.toUpperCase()} = ${rate} ${to.toUpperCase()} (${j.date})` });
        } catch {
          push({ kind: "stderr", text: "frankfurter offline" });
        }
        break;
      }
      case "theme": {
        const next = (Math.floor(Math.random() * 15) + 1).toString();
        window.dispatchEvent(new CustomEvent("delos-cycle-wallpaper"));
        push({ kind: "stdout", text: `▒ wallpaper cycled (${next})` });
        break;
      }
      case "exit":
      case "quit":
        push({ kind: "stdout", text: "bye." });
        setTimeout(() => window.dispatchEvent(new CustomEvent("delos-close-focused")), 400);
        break;
      default:
        push({ kind: "stderr", text: `${cmd}: command not found. Try \`help\`. Maybe you meant \`ai ${raw}\`?` });
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); handleSubmit(); return; }
    if (e.key === "Tab")   { e.preventDefault(); tabComplete(); return; }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!history.length) return;
      const next = historyIdx < 0 ? history.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(next);
      setInput(history[next] ?? "");
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIdx < 0) return;
      const next = historyIdx + 1;
      if (next >= history.length) { setHistoryIdx(-1); setInput(""); }
      else { setHistoryIdx(next); setInput(history[next] ?? ""); }
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === "l") { e.preventDefault(); clearScreen(); return; }
    if (e.ctrlKey && e.key.toLowerCase() === "c" && running) { e.preventDefault(); ctrlRef.current?.abort(); push({ kind: "stderr", text: "^C" }); return; }
  }

  return (
    <div
      className="h-full flex flex-col font-mono"
      style={{
        background: "#050807",
        color: "#7fff8a",
        fontFamily: "ui-monospace, 'JetBrains Mono', 'Cascadia Code', Menlo, monospace",
      }}
      onClick={() => inputRef.current?.focus()}
    >
      {/* Tab bar / CRT header */}
      <div
        className="flex items-center justify-between px-3 py-1 text-[10px] flex-shrink-0"
        style={{ background: "#0a1410", color: "#5fc480", borderBottom: "1px solid #1a3422" }}
      >
        <div className="flex items-center gap-2">
          <Icons.TerminalSquare size={11} color="#7fff8a" />
          <span style={{ fontWeight: 600 }}>delos-terminal</span>
          <span style={{ color: "#3a6a45" }}>·</span>
          <span>{tenant}@delos</span>
          {running && (<>
            <span style={{ color: "#3a6a45" }}>·</span>
            <span style={{ color: "#fbc531" }}>● running</span>
          </>)}
        </div>
        <div className="flex items-center gap-2">
          {sup.stt && (
            <button
              onClick={() => (stt.state === "listening" ? stt.stop() : stt.start({ continuous: false }))}
              title="Voice input"
              style={{ background: "transparent", border: "1px solid #2a4030", color: stt.state === "listening" ? "#c0392b" : "#7fff8a", padding: "1px 6px", fontSize: 9, cursor: "pointer" }}
            >
              {stt.state === "listening" ? "■ STOP" : "🎤 MIC"}
            </button>
          )}
          <button
            onClick={clearScreen}
            style={{ background: "transparent", border: "1px solid #2a4030", color: "#7fff8a", padding: "1px 6px", fontSize: 9, cursor: "pointer" }}
            title="Clear (Ctrl+L)"
          >
            ⌧ CLR
          </button>
        </div>
      </div>

      {/* Output log */}
      <div
        ref={logRef}
        className="flex-1 overflow-y-auto px-3 py-2 text-[12px] leading-[1.45]"
        style={{
          background: "linear-gradient(180deg, #050807 0%, #060a08 100%)",
          // CRT scanlines overlay
          backgroundImage: "repeating-linear-gradient(0deg, rgba(127,255,138,0.02) 0px, rgba(127,255,138,0.02) 1px, transparent 1px, transparent 3px)",
        }}
      >
        {lines.map((l, i) => <TermOutput key={i} line={l} base={baseRef.current} />)}

        {/* Active prompt input — inline with the buffer like a real shell */}
        <div className="flex items-center" style={{ marginTop: 2 }}>
          <span style={{ color: "#5fc4e1" }}>{tenant}@delos</span>
          <span style={{ color: "#3a6a45" }}>:</span>
          <span style={{ color: "#fbc531" }}>{cwd}</span>
          <span style={{ color: "#5fc480" }}>$&nbsp;</span>
          <input
            ref={inputRef}
            value={stt.state === "listening" ? input + " " + stt.interim : input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoComplete="off"
            disabled={running}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "#7fff8a",
              fontFamily: "inherit",
              fontSize: "inherit",
              caretColor: "#7fff8a",
            }}
            placeholder={running ? "agent running… ctrl+c to abort" : "type a command, or `help`"}
          />
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 14,
              background: "#7fff8a",
              animation: "delosBlink 1.05s steps(2, end) infinite",
              marginLeft: 2,
            }}
          />
        </div>
      </div>

      {/* Inline steer bar (only while a run is active) */}
      {running && runId && (
        <div className="flex items-center gap-2 px-3 py-1.5 flex-shrink-0" style={{ background: "#1a1208", borderTop: "1px solid #7a5e2a" }}>
          <Icons.Navigation size={11} color="#fbc531" />
          <input
            value={steerText}
            onChange={(e) => setSteerText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendSteer()}
            placeholder="steer the running agent…"
            style={{ flex: 1, background: "transparent", border: "1px solid #7a5e2a", color: "#fbc531", padding: "2px 6px", fontSize: 11, fontFamily: "inherit" }}
          />
          <button onClick={sendSteer} style={{ background: "#fbc531", color: "#000", padding: "2px 8px", fontSize: 10, border: "none", cursor: "pointer", fontWeight: 700 }}>
            ★ STEER
          </button>
        </div>
      )}

      <style>{`
        @keyframes delosBlink {
          0%,100% { opacity: 1; }
          50%     { opacity: 0; }
        }
      `}</style>
    </div>
  );
}

function TermOutput({ line, base }: { line: TermOut; base: number }) {
  if (line.kind === "input") {
    const [user, host] = line.prompt.includes("@")
      ? line.prompt.split("@")
      : [line.prompt, ""];
    const hostBeforeColon = host.split(":")[0];
    const pwd = host.split(":")[1]?.replace(/\$ $/, "") ?? "";
    return (
      <div style={{ marginTop: 2 }}>
        <span style={{ color: "#5fc4e1" }}>{user}</span>
        <span style={{ color: "#3a6a45" }}>@</span>
        <span style={{ color: "#5fc4e1" }}>{hostBeforeColon}</span>
        <span style={{ color: "#3a6a45" }}>:</span>
        <span style={{ color: "#fbc531" }}>{pwd}</span>
        <span style={{ color: "#5fc480" }}>$&nbsp;</span>
        <span style={{ color: "#e0ffe5" }}>{line.cmd}</span>
      </div>
    );
  }
  if (line.kind === "stdout") {
    return <div style={{ color: "#a0ffaa", whiteSpace: "pre-wrap" }}>{line.text}</div>;
  }
  if (line.kind === "stderr") {
    return <div style={{ color: "#ff6b6b", whiteSpace: "pre-wrap" }}>{line.text}</div>;
  }
  if (line.kind === "ascii") {
    return <pre style={{ color: "#7fff8a", margin: 0, fontSize: 10, lineHeight: 1.1 }}>{line.text}</pre>;
  }
  // event line — matches RunEvent variants in src/lib/types.ts
  const ev = line.ev;
  const ms = ev.at - base;
  const tag = ev.t.padEnd(13, " ");
  let color = "#5fc480";
  let body = "";
  switch (ev.t) {
    case "meta":          color = "#5fc4e1"; body = `runId=${ev.runId}`; break;
    case "phase":         color = "#fbc531"; body = `phase=${ev.phase}${ev.note ? " · " + ev.note : ""}`; break;
    case "thought":       color = "#e1a95f"; body = `${ev.agent}: ${ev.text.slice(0, 240)}`; break;
    case "tool_call":     color = "#aef0ff"; body = `→ ${ev.name}(${JSON.stringify(ev.args).slice(0, 180)})`; break;
    case "tool_result":   color = ev.ok ? "#a0ffaa" : "#ff6b6b"; body = `← ${ev.name} ${ev.ok ? "ok" : `fail: ${ev.error ?? "?"}`}`; break;
    case "memory_write":  color = "#7a9aff"; body = `mem write ${ev.key} (${(ev.preview ?? "").slice(0, 80)})`; break;
    case "memory_recall": color = "#7a9aff"; body = `mem recall "${ev.query}" → ${ev.hits} hits`; break;
    case "recover":       color = "#c0c0ff"; body = `recover · ${ev.reason} → ${ev.strategy}`; break;
    case "adapt":         color = "#c0c0ff"; body = `adapt · ${ev.from} → ${ev.to} (${ev.reason})`; break;
    case "metric":        color = "#888";    body = `metric ${ev.key}=${ev.value}`; break;
    case "usage":         color = "#888";    body = `${ev.role}/${ev.model} · in=${ev.promptTokens} out=${ev.completionTokens} ${ev.ms}ms`; break;
    case "subagent":      color = "#fbc531"; body = `subagent ${ev.id} ${ev.status} — ${ev.goal.slice(0, 80)}`; break;
    case "answer":        color = "#a0ffaa"; body = `◆ answer · ${ev.text.slice(0, 200)}${ev.text.length > 200 ? "…" : ""}`; break;
    case "error":         color = "#ff6b6b"; body = `error · ${ev.message}`; break;
    default:              body = JSON.stringify(ev);
  }
  return (
    <div style={{ color, fontSize: 11, whiteSpace: "pre-wrap" }}>
      <span style={{ color: "#3a6a45" }}>[{String(ms).padStart(5, " ")}ms]</span>{" "}
      <span style={{ color: "#5fc480" }}>{tag}</span>{" "}
      <span>{body}</span>
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

// Strip run-log metric metadata from displayed text.
// Removes lines like "tokens=1247 drift=0.08 ms=520" that polluted
// MissionControl display in QA run 2026-05-25.
function cleanRunText(text: string): string {
  // If it's a User fact, format it cleanly
  const factMatch = text.match(/User fact\s*[·-]\s*(.+)$/i);
  if (factMatch) return `✓ ${factMatch[1].trim()}`;
  // For run summaries, keep up to first sentence-boundary before metric noise
  const clean = text
    .replace(/\b(tokens|drift|ms|wall_time_ms|replans|tool_calls|successes|elapsed_ms)\s*=\s*[\d.]+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  // Truncate at 120 chars
  return clean.length > 120 ? clean.slice(0, 117) + "…" : clean;
}

// Extract domain tag from text for citation badge
function extractDomainTag(text: string): string | null {
  if (/investor|crm|commitment|portfolio/i.test(text)) return "investor-crm";
  if (/sanctions|sar|aml|fincen|kyc|regulatory/i.test(text)) return "regulatory-fintech";
  if (/clinical|adverse|dosing|protocol|patient/i.test(text)) return "clinical-trial";
  if (/legal|contract|clause|redline|counsel/i.test(text)) return "legal-contracts";
  if (/tutor|lesson|curriculum|mastery|quiz/i.test(text)) return "ai-tutor";
  if (/incident|runbook|oncall|postmortem|severity/i.test(text)) return "ops-incident";
  return null;
}

export function MissionControl() {
  const [runs, setRuns] = useState<Array<{ text: string; createdAt?: number }>>([]);
  const [osbRunning, setOsbRunning] = useState(false);
  const [osbProgress, setOsbProgress] = useState<{ materialized: number; agents: number; tokens: number; usd: number; lastEvent: string } | null>(null);

  useEffect(() => {
    const tid = getTenantId();
    const url = `/api/memory?q=${encodeURIComponent("recent missions goals results")}${tid ? `&tenantId=${encodeURIComponent(tid)}` : ""}`;
    fetch(url)
      .then((r) => r.json())
      .then((j: { hits?: Array<{ text: string; score?: number }>; local?: Array<{ text: string; createdAt?: number }> }) => {
        // Prefer HydraDB hits (semantic recall) over raw local log
        if (j.hits && j.hits.length > 0) {
          setRuns(j.hits.map((h) => ({ text: h.text })));
        } else {
          setRuns((j.local ?? []).slice(-12).reverse());
        }
      })
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
        {runs.slice(0, 8).map((r, i) => {
          const display = cleanRunText(r.text);
          const domain = extractDomainTag(r.text);
          return (
            <li key={i} className="card-pixel">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="pill pill-info" style={{ fontSize: 9 }}>#{i + 1}</span>
                {domain && (
                  <span className="pill pill-muted" style={{ fontSize: 9, color: "var(--accent)" }} title="Domain detected from memory recall">
                    {domain}
                  </span>
                )}
                {r.createdAt && (
                  <span className="text-[color:var(--muted)] font-mono" style={{ fontSize: 9 }}>{new Date(r.createdAt).toLocaleTimeString()}</span>
                )}
              </div>
              <div className="font-mono text-xs leading-relaxed">{display}</div>
            </li>
          );
        })}
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

// 5 UI-style presets · user picks one before build. Pixel keeps the DelOS
// retro look. Modern is brand-neutral clean Material-ish. Glass is frosted
// neon. Console is terminal green. Brand uses whatever theme the clone
// template ships (Claude orange, ChatGPT green, etc — falls through).
const UI_STYLES: Array<{ id: string; label: string; icon: string; desc: string; theme: Partial<{ bg: string; surface: string; surface2: string; fg: string; muted: string; accent: string; onAccent: string; font: string }> | null }> = [
  { id: "pixel",   label: "Pixel",   icon: "Gamepad2", desc: "DelOS retro · pixel font, square cards, CRT yellow", theme: null },
  { id: "modern",  label: "Modern",  icon: "Square",   desc: "Clean cards, Inter, rounded 12px, subtle shadows", theme: {
    bg: "#fafafa", surface: "#ffffff", surface2: "#e5e5e5", fg: "#0a0a0a", muted: "#737373", accent: "#2563eb", onAccent: "#ffffff",
    font: "'Inter', ui-sans-serif, system-ui, sans-serif",
  }},
  { id: "brand",   label: "Brand",   icon: "Palette",  desc: "Whatever the clone ships · keeps native brand palette", theme: null },
  { id: "glass",   label: "Glass",   icon: "Layers",   desc: "Frosted dark, neon cyan accent, ultra-modern", theme: {
    bg: "#0a0a0f", surface: "#13131c", surface2: "#1f1f2e", fg: "#f0f0ff", muted: "#7a7a99", accent: "#22d3ee", onAccent: "#0a0a0f",
    font: "'Inter', ui-sans-serif, system-ui, sans-serif",
  }},
  { id: "console", label: "Console", icon: "TerminalSquare", desc: "Phosphor green on black, JetBrains Mono, hacker vibe", theme: {
    bg: "#0d0d0d", surface: "#151515", surface2: "#1f1f1f", fg: "#33ff66", muted: "#449944", accent: "#00ffaa", onAccent: "#0d0d0d",
    font: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
  }},
];

export function AppBuilder({ onBuilt }: { onBuilt: (spec: AppSpec) => void }) {
  const [prompt, setPrompt] = useState("Build me a stopwatch with start/stop/reset.");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [stage, setStage] = useState<"idle" | "plan" | "spec" | "validate" | "mount" | "done">("idle");
  const [builtins, setBuiltins] = useState<Array<{ id: string; name: string; icon: string }>>([]);
  const [installingId, setInstallingId] = useState<string | null>(null);
  // Last built spec — surfaced to user via schema viewer + refine textarea.
  const [lastSpec, setLastSpec] = useState<AppSpec | null>(null);
  const [showSchema, setShowSchema] = useState(false);
  const [refinePrompt, setRefinePrompt] = useState("");
  // Selected UI style · drives the theme override applied post-build.
  // Default "brand" preserves clone palettes (Claude orange etc); user
  // can flip to Modern/Glass/Console if they want a different look.
  const [uiStyle, setUiStyle] = useState<string>("brand");
  // Production mode · when on, ambitious prompts get routed to
  // /api/codegen-app-stream for a real multi-file React/Next project
  // streamed file-by-file into DelCode (user watches the agent code).
  // Off = legacy DSL widget. Matches the 2026-05-25 ask for "same-to-
  // same Claude-level production output + visible coding".
  const [productionMode, setProductionMode] = useState<boolean>(false);
  // Codegen wizard · UI style + scaffolding tier picked BEFORE build so
  // the same prompt can be rendered Modern SaaS, Editorial, Glass,
  // Brutalist, Linear-clean, Pixel-retro, or Minimal-mono. Tier drives
  // file count + complexity floor (prototype 5-7 / production 8-12 /
  // same-to-same 10-14).
  const [codeStyle, setCodeStyle] = useState<
    "modern-saas" | "editorial" | "glassmorphism" | "brutalist" | "linear-clean" | "pixel-retro" | "minimal-mono"
  >("modern-saas");
  // Default tier · "production" (6-8 files) was tripping Vercel's 90s
  // function ceiling on warehouse / notion clones. Prototype (4-6 files)
  // finishes reliably under deadline · user can manually upgrade to
  // production or same-to-same via wizard for richer output.
  const [codeTier, setCodeTier] = useState<"prototype" | "production" | "same-to-same">("prototype");
  // Last codegen project (for the follow-up error loop).
  const [lastProject, setLastProject] = useState<{ name: string; files: Array<{ path: string; content: string }> } | null>(null);
  // Follow-up error textarea content.
  const [errorFeedback, setErrorFeedback] = useState("");
  // Live coding progress · file index / total / current path for the
  // visible "agent is coding" UI between plan_done and project_done.
  const [codeProgress, setCodeProgress] = useState<{ index: number; total: number; path: string; status: string } | null>(null);
  // Per-file checklist rendered in the VibeCode panel · updated by SSE
  // events as the stream emits file_start / file_done / file_skip.
  // Lets the user see exactly which files landed and which retried/
  // failed, instead of just the current cursor.
  const [fileChecklist, setFileChecklist] = useState<Array<{ path: string; status: "queued" | "writing" | "done" | "retried" | "skipped"; bytes?: number; reason?: string }>>([]);
  // Active path in the inline DelCode preview pane · auto-tracks the
  // most recently landed file but the user can click a row in the
  // checklist to lock onto a specific file. 2026-05-25 ask: "DelCode
  // to be added in the route of VibeCode" → embed the IDE inline.
  const [activePreviewPath, setActivePreviewPath] = useState<string | null>(null);
  // Live mirror of accFiles · drives the inline preview pane during
  // streams. Persists after build done so the split-view stays useful.
  const [streamingFiles, setStreamingFiles] = useState<Array<{ path: string; content: string }>>([]);

  // ─── Voice-to-build mic ────────────────────────────────────────────────
  // User holds 🎙 → Whisper STT → transcript fills prompt textarea. Reuses
  // the same Whisper pipeline as the global Voice agent so far-field
  // capture + phonetic correction also work here.
  const builderStt = useSpeechToText();
  useEffect(() => {
    if (builderStt.transcript && !busy) {
      setPrompt(enhanceBuildPrompt(builderStt.transcript).slice(0, 1500));
      builderStt.setTranscript("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [builderStt.transcript]);
  const micActive = builderStt.state === "listening" || builderStt.state === "recording";
  // BUG-1 fix · only overwrite the textarea when it's empty, still on the
  // default seed, OR the user has explicitly tapped Apply on a confirm.
  // Was: chip clicks silently wiped a typed-out spec mid-scroll.
  const DEFAULT_SEED = "Build me a stopwatch with start/stop/reset.";
  function fillPromptSafe(next: string) {
    if (busy) return;
    const trimmed = prompt.trim();
    const seedEqualsDefault = trimmed === DEFAULT_SEED || trimmed === "";
    if (seedEqualsDefault) {
      setPrompt(next);
      return;
    }
    // Non-blocking confirm with native browser dialog — keeps the wipe rare
    // and intentional. Skips on mobile if window.confirm is missing.
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      const ok = window.confirm("Replace your current prompt with this template?");
      if (!ok) return;
    }
    setPrompt(next);
  }

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
      const enhanced = enhanceBuildPrompt(i.prompt).slice(0, 1500);
      setPrompt(enhanced);
      // Pass prompt EXPLICITLY — React state update is async, build() reading
      // from closure would race and pick up the stale default ("stopwatch").
      // Was: setTimeout(() => build(), 50)
      setTimeout(() => build(enhanced), 50);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Replaces the generic stopwatch/tip-calc presets. These prompts route
  // through the clone matcher → curated multi-card HTML templates with
  // sidebars, message lists, dashboards, payment flows. Each ships in
  // under 1s with brand-coherent palette + working state.
  const presets = [
    "Build me a Claude clone with sidebar, model picker, chat thread, and live compose",
    "Build a full GitHub repo dashboard with file tree, commits, stars, and language stats",
    "Build a Notion workspace with sidebar tree, page heading, status pills, and a database table",
    "Build a Linear issue tracker with cycles, projects, priorities, and assignees",
    "Build a Stripe billing dashboard with KPI cards, line chart, and recent payments table",
    "Build a Slack workspace with channels, DMs, threaded messages, and composer",
    "Build a YouTube clone with search bar, category chips, and a 6-video grid",
    "Build an AirBnB clone with search bar, category icons, and 8 listings",
    "Build me an Amazon clone with cart, checkout flow, and live total",
    "Build a Spotify clone with discover row, queue, and player controls",
    "Build a Tinder swipe app with profile card and like/dislike buttons",
    "Build a Discord server with channel sidebar, threaded chat, and voice rooms",
  ];

  // Curated production-grade templates — every entry maps to a curated
  // multi-card HTML clone via the clone matcher in appBuilder.ts. Mixed
  // categories so judges see a complete app gallery.
  const TEMPLATES: Array<{ id: string; label: string; icon: string; prompt: string; tag: string }> = [
    { id: "claude", label: "Claude Chat", icon: "Sparkles", tag: "AI", prompt: "Build me a Claude clone — sidebar with Recents, model picker (Opus/Sonnet/Haiku), conversation thread with user + assistant bubbles, compose with Send button, footer disclaimer." },
    { id: "chatgpt", label: "ChatGPT Console", icon: "MessageSquare", tag: "AI", prompt: "Build a ChatGPT clone — left sidebar (New chat / Search / Library / GPTs / Today / Previous 7 days), model dropdown header, chat thread, rounded composer with +/mic/Send." },
    { id: "perplexity", label: "Perplexity Search", icon: "Search", tag: "AI", prompt: "Build a Perplexity clone — left icon rail, hero 'Where knowledge begins', search bar with focus chips (Web/Academic/YouTube/Reddit), Answer block with [1][2][3] citations, source cards grid." },
    { id: "github", label: "GitHub Repo", icon: "Github", tag: "DEV", prompt: "Build a GitHub repo dashboard — top nav with search + tabs (Code/Issues/PRs/Actions/Security/Insights), file tree with last-commit messages, About sidebar with stars/forks/languages." },
    { id: "notion", label: "Notion Workspace", icon: "FileText", tag: "PRODUCTIVITY", prompt: "Build a Notion workspace — left sidebar with favorites + workspace pages, main page with emoji icon + title + status/owner/due cards, milestone checklist, database table with name/status/owner/updated columns." },
    { id: "linear", label: "Linear Tracker", icon: "CircleDot", tag: "DEV", prompt: "Build a Linear issue tracker — left sidebar with workspace + cycles + projects, header with cycle name + New issue button, filter chips (All/Active/Backlog/Done), issue list with ID/status/title/priority/assignee/date." },
    { id: "slack", label: "Slack Workspace", icon: "Hash", tag: "TEAM", prompt: "Build a Slack workspace — workspace rail + channel/DM sidebar with sections, channel header with member count, threaded messages with avatars, composer with formatting buttons." },
    { id: "stripe", label: "Stripe Dashboard", icon: "CreditCard", tag: "BUSINESS", prompt: "Build a Stripe billing dashboard — left nav (Home/Payments/Invoices/Customers/Products), 4 KPI cards (volume/payments/customers/churn), gross-volume SVG line chart, recent payments table with status badges." },
    { id: "youtube", label: "YouTube Clone", icon: "Youtube", tag: "MEDIA", prompt: "Build a YouTube clone — search bar with mic, category chips (All/Music/Hackathon/Coding/etc), 6-video grid with thumbnail gradients, durations, channel + view counts." },
    { id: "airbnb", label: "AirBnB Clone", icon: "Home", tag: "TRAVEL", prompt: "Build an AirBnB clone — Stays/Experiences nav, pill-shaped search bar (where/check in/check out/guests + search circle), category icons row (Beach/Mountains/etc), 8-listing grid with photos/title/rating/price." },
    { id: "tinder", label: "Tinder Swipe", icon: "Heart", tag: "SOCIAL", prompt: "Build a Tinder clone — phone-bezel card with profile gradient, name/age/bio/interests overlay, action button row (rewind/dislike/superlike/like/boost)." },
    { id: "discord", label: "Discord Server", icon: "MessageSquare", tag: "SOCIAL", prompt: "Build a Discord server — left server rail, channel sidebar (text + voice sections), main chat with avatars + bot tag, message composer with gift/GIF/emoji buttons." },
    { id: "snapchat", label: "Snapchat", icon: "Ghost", tag: "SOCIAL", prompt: "Build a Snapchat clone — phone bezel with status bar, camera viewfinder + streak pill, filter chips, big shutter button, 5-tab bottom nav (Map/Chat/Camera/Stories/Spotlight), side panel Stories feed." },
    { id: "uber", label: "Uber Ride", icon: "Car", tag: "TRAVEL", prompt: "Build an Uber clone — pickup + dropoff inputs, ride class picker (UberX/Comfort/Black) with live fare, surge/ETA pills, Request ride button, status card." },
    { id: "ubereats", label: "UberEats", icon: "UtensilsCrossed", tag: "FOOD", prompt: "Build an UberEats clone — restaurant picker, menu cards with add buttons, live cart total, Place order action." },
    { id: "amazon", label: "Amazon Shop", icon: "ShoppingCart", tag: "ECOM", prompt: "Build an Amazon clone — search bar, featured products grid (4 items) with ratings + add-to-cart, live cart list + subtotal, Place order + Clear cart actions." },
    { id: "netflix", label: "Netflix Stream", icon: "PlayCircle", tag: "MEDIA", prompt: "Build a Netflix clone — genre pill, Trending row, Documentaries row, My List with add/clear, now-playing pill." },
    { id: "spotify", label: "Spotify Music", icon: "Music", tag: "MEDIA", prompt: "Build a Spotify clone — Discover button row (tracks), Play/Pause/+Queue controls, current track pill, queue list." },
    { id: "macos", label: "macOS Desktop", icon: "Monitor", tag: "OS", prompt: "Build a macOS clone — top menu bar with apple + app menus + status icons + clock, aqua wallpaper, Finder window with traffic lights + Favorites sidebar + icon grid, glassy bottom dock with 10 app icons." },
    { id: "bookmyshow", label: "Movie Tickets", icon: "Ticket", tag: "TRAVEL", prompt: "Build a BookMyShow clone — Now Showing button row, Showtimes row, Seats row + selection list with ₹ total, Confirm booking action." },
    { id: "instagram", label: "Instagram Feed", icon: "Camera", tag: "SOCIAL", prompt: "Build an Instagram clone — caption textarea, Post action, scrollable feed with handle/caption/likes." },
    { id: "snake-pro", label: "Snake Pro", icon: "Worm", tag: "GAMES", prompt: "Build a Snake Pro launcher — hi-score / last-score pills, how-to-play card, score tracker with Save + Reset actions." },
  ];
  // Apply the selected UI style as a theme override on a freshly-built spec.
  // For "brand" we keep whatever the template ships. For "pixel" we strip
  // the theme so the OS retro look returns. For the others we set the
  // theme block which AppRuntime turns into CSS variables on the wrapper.
  function applyUiStyle(spec: AppSpec, styleId: string): AppSpec {
    if (styleId === "brand") return spec;
    if (styleId === "pixel") {
      const next = { ...(spec as unknown as Record<string, unknown>) } as AppSpec;
      delete (next as unknown as { theme?: unknown }).theme;
      return next;
    }
    const style = UI_STYLES.find((s) => s.id === styleId);
    if (!style?.theme) return spec;
    return { ...(spec as unknown as Record<string, unknown>), theme: style.theme } as unknown as AppSpec;
  }

  // Auto-detect production-worthy prompts. Returns true when the user
  // asked for something ambitious enough to deserve a real multi-file
  // React/Next project (codegen-app-stream) instead of the DSL widget
  // path. Triggers:
  //   • explicit "clone" / "same-to-same" keyword
  //   • named brand (ChatGPT, Notion, Linear, etc.)
  //   • ambition word (production-grade / complete / full / complex /
  //     comprehensive / operating system / real app / SaaS / platform)
  //   • prompt length ≥ 12 words (long prompts ≈ serious asks)
  // Light prompts ("build me a stopwatch") still hit the DSL fast path.
  // 2026-05-25 ask · "should auto build apps from scratch to give
  // production level result".
  function shouldAutoProduction(p: string): boolean {
    const s = p.toLowerCase();
    if (/\bclone\b|\bsame[-\s]*to[-\s]*same\b/i.test(s)) return true;
    if (/\b(chatgpt|claude|anthropic|notion|linear|slack|stripe|figma|github|gmail|youtube|spotify|airbnb|tinder|discord|amazon|uber|netflix|perplexity|bookmyshow|reddit|twitter|x\.com)\b/i.test(s)) return true;
    if (/\b(production[-\s]*(?:ready|grade|level|quality)|complete\s+(?:app|system|platform)|full[-\s]*(?:stack|featured)|complex|comprehensive|operating\s+system|real\s+(?:app|platform|system|website|saas)|saas\s+(?:app|dashboard|platform)|enterprise|production)\b/i.test(s)) return true;
    const words = s.split(/\s+/).filter(Boolean);
    if (words.length >= 12) return true;
    return false;
  }

  async function build(overridePrompt?: string, opts?: { refineFromSpec?: AppSpec }) {
    const usePrompt = (overridePrompt ?? prompt).slice(0, 1500);
    setBusy(true);
    setErr(null);
    setStage("plan");
    broadcastAgent("planner", "thinking");
    broadcastAgent("executor", "thinking");
    // Tick stages on a soft timer so user sees progress before real fetch resolves
    const tStage1 = setTimeout(() => setStage("spec"), 700);
    const tStage2 = setTimeout(() => setStage("validate"), 1600);
    // Auto-promote ambitious prompts to production mode so the user
    // gets real multi-file output without having to flip the toggle.
    // The explicit toggle still wins when on.
    const auto = !productionMode && !opts?.refineFromSpec && shouldAutoProduction(usePrompt);
    const useProduction = productionMode || auto;
    const cloneish = /\b(clone|same[-\s]*to[-\s]*same|chatgpt|claude|perplexity|notion|linear|slack|stripe|github|youtube|spotify|airbnb|tinder|discord|amazon|uber|netflix)\b/i.test(usePrompt);
    const effectiveTier = useProduction && codeTier === "prototype" ? (cloneish ? "same-to-same" : "production") : codeTier;
    if (auto) {
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: { text: "★ Production mode auto-enabled · ambitious prompt → multi-file build", tone: "ok" },
        }),
      );
    }
    try {
      // Production mode path · routes to /api/codegen-app-stream for a
      // real multi-file React/Next project streamed FILE-BY-FILE into
      // DelCode (the user watches the agent code live, like Cursor /
      // Claude Code). Refine flows stay on /api/build-app (DSL spec)
      // because they patch a known spec in place. New ambitious builds
      // with productionMode on get the same-to-same fidelity output.
      if (useProduction && !opts?.refineFromSpec) {
        // Open DelCode FIRST so the user sees files materialize one
        // by one. Then start the SSE stream.
        window.dispatchEvent(new CustomEvent("delos-launch-app", { detail: { id: "codebase" } }));
        const accFiles: Array<{ path: string; content: string }> = [];
        let projectName = "Generated project";
        const r = await fetch("/api/codegen-app-stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: usePrompt,
            stack: "nextjs",
            uiStyle: codeStyle,
            tier: effectiveTier,
            previousProject: lastProject ?? undefined,
            errorContext: errorFeedback || undefined,
          }),
        });
        if (!r.body) throw new Error("no stream");
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        let streamErr: string | null = null;
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
              const ev = JSON.parse(line.slice(6)) as { t: string;[k: string]: unknown };
              if (ev.t === "plan_done") {
                const proj = ev.project as { name?: string; files?: Array<{ path: string; purpose?: string }> };
                projectName = proj.name ?? projectName;
                setCodeProgress({ index: 0, total: proj.files?.length ?? 0, path: "(plan)", status: "planning done · writing files" });
                // Seed the checklist with every planned file so the
                // user sees the full file tree before any writes land.
                setFileChecklist(
                  (proj.files ?? []).map((f) => ({ path: f.path, status: "queued" as const })),
                );
              } else if (ev.t === "file_start") {
                const path = ev.path as string;
                setCodeProgress({
                  index: (ev.index as number) + 1,
                  total: ev.total as number,
                  path,
                  status: "writing",
                });
                setFileChecklist((prev) =>
                  prev.map((row) => (row.path === path ? { ...row, status: "writing" as const } : row)),
                );
              } else if (ev.t === "file_done") {
                const path = ev.path as string;
                const content = ev.content as string;
                const retried = Boolean(ev.retried);
                accFiles.push({ path, content });
                // W01 · push via global pending queue so DelCode catches
                // payload regardless of mount timing. consumeDelcodePending
                // runs on DelCode load · subscription handles subsequent events.
                const payload = { files: accFiles, name: projectName };
                (globalThis as unknown as { __delos_delcode_pending?: typeof payload }).__delos_delcode_pending = payload;
                window.dispatchEvent(
                  new CustomEvent("delos-codegen-load", { detail: payload }),
                );
                setCodeProgress({
                  index: (ev.index as number) + 1,
                  total: ev.total as number,
                  path,
                  status: retried ? "✓ written (retried)" : "✓ written",
                });
                setFileChecklist((prev) =>
                  prev.map((row) =>
                    row.path === path
                      ? { ...row, status: (retried ? "retried" : "done") as "done" | "retried", bytes: content.length }
                      : row,
                  ),
                );
                // Auto-focus the inline preview onto the freshest file
                // so the user watches the latest code drop in.
                setActivePreviewPath(path);
                setStreamingFiles((prev) => {
                  const next = prev.filter((r) => r.path !== path);
                  next.push({ path, content });
                  return next;
                });
              } else if (ev.t === "file_skip") {
                const path = ev.path as string;
                const reason = String(ev.reason ?? "");
                setFileChecklist((prev) =>
                  prev.map((row) => (row.path === path ? { ...row, status: "skipped" as const, reason } : row)),
                );
              } else if (ev.t === "project_done") {
                // W03 · stash projectId globally so DelCode toolbar ZIP/HTML
                // buttons know which project to export.
                const pid = (ev.projectId ?? (ev.project as { id?: string } | undefined)?.id) as string | undefined;
                if (pid) {
                  (globalThis as unknown as { __delos_current_project_id?: string }).__delos_current_project_id = pid;
                  window.dispatchEvent(new CustomEvent("delos-codegen-done", { detail: { projectId: pid } }));
                }
              } else if (ev.t === "error") {
                streamErr = String(ev.message ?? "stream error");
              }
            } catch {}
          }
        }
        if (streamErr && accFiles.length === 0) throw new Error(streamErr);
        if (accFiles.length === 0) throw new Error("codegen stream returned no files");
        setLastProject({ name: projectName, files: accFiles });
        setErrorFeedback("");
        setStage("done");
        broadcastAgent("planner", "done");
        broadcastAgent("executor", "done");
        broadcastAgent("critic", "done");
        broadcastAgent("memory", "done");
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { text: `★ ${projectName} · ${accFiles.length} files`, tone: "ok" },
          }),
        );
        setTimeout(() => {
          setStage("idle");
          setCodeProgress(null);
          broadcastAgent("planner", "idle");
          broadcastAgent("executor", "idle");
          broadcastAgent("critic", "idle");
          broadcastAgent("memory", "idle");
        }, 1500);
        clearTimeout(tStage1);
        clearTimeout(tStage2);
        setBusy(false);
        return;
      }
      // Refine path · send the user's change verbatim. The "Refine the
      // existing app X. Apply this change: …" wrapper was leaking into
      // downstream LLM title generation (LLM took the prefix as the new
      // name → "Refine the existing app 'ChatGPT · OpenA…'"). The
      // server-side refineBlock already injects the previous-spec JSON
      // so the LLM has full context without the prompt prefix.
      const finalPrompt = usePrompt;
      const r = await fetch("/api/build-app", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: finalPrompt,
          models: getModelOverrides(),
          tenantId: getTenantId(),
          temperature: getTemperature(),
          identity: renderIdentityPreamble(getIdentity()) || undefined,
          // Refine path · backend skips matchBuiltin / clone templates and
          // injects this spec into the LLM context so the result mutates
          // the existing app in place. Without this the LLM saw only the
          // change-request text and frequently rebuilt as a different
          // domain (Investor CRM → DQ War Room regression).
          previousSpec: opts?.refineFromSpec,
        }),
      });
      const j = (await r.json()) as { spec?: AppSpec; error?: string };
      if (!r.ok || !j.spec) throw new Error(j.error ?? `HTTP ${r.status}`);
      setStage("mount");
      broadcastAgent("critic", "thinking");
      const finalSpec = applyUiStyle(j.spec, uiStyle);
      setLastSpec(finalSpec);
      onBuilt(finalSpec);
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
      const msg = (e as Error).message;
      setErr(msg);
      setStage("idle");
      broadcastAgent("planner", "idle");
      broadcastAgent("executor", "idle");
      // BUG-2 fix · surface the failure as a toast so users don't see the
      // button just flip back to "BUILD APP" with nothing happening.
      try {
        window.dispatchEvent(new CustomEvent("toast", { detail: { text: `Build failed: ${msg.slice(0, 80)}`, tone: "bad" } }));
      } catch {}
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
    <div className="flex h-full" style={{ minHeight: 480 }}>
      {/* Left pane · existing VibeCode wizard / prompt / checklist. Width
          constrained when split-view is on so DelCode inline preview
          gets room. */}
    <div
      className="p-3 space-y-3 text-xs overflow-y-auto"
      style={{
        paddingBottom: 96,
        flex: productionMode && (streamingFiles.length > 0 || lastProject) ? "0 0 440px" : "1 1 100%",
        borderRight:
          productionMode && (streamingFiles.length > 0 || lastProject)
            ? "1px solid var(--surface-2)"
            : "none",
      }}
    >
      {/* paddingBottom keeps the BUILD APP / REFINE controls clear of the
          dock magnification region (~104px). Was an exact-overlap zone
          where forced clicks landed on dock icons (Identity) instead of
          the BUILD button — 2026-05-25 brutal-QA P0. */}
      <div className="font-pixel text-sm tracking-wider" style={{ color: "var(--accent)" }}>★ VIBECODE · VIBE-CODING PLATFORM</div>
      <p className="text-[color:var(--muted)] font-mono">
        Speak it, type it, ship it. VibeCode generates the spec, validates it, mounts a working app in a window. Pick a UI style + refine after build. HydraDB remembers everything.
      </p>
      <div style={{ position: "relative" }}>
        <textarea
          className="input-pixel"
          rows={3}
          value={prompt}
          // Hard cap at 1500 chars on input · prompt slice(0, 1500) prevents
          // 5000+ char DOS prompts that QA reported as causing partial output
          // / timeouts. Server-side cap is 800 (sanitizePrompt) but textarea
          // gives the user EARLY visual feedback before they hit BUILD.
          onChange={(e) => setPrompt(e.target.value.slice(0, 1500))}
          maxLength={1500}
          disabled={busy}
          style={{ paddingRight: 44 }}
        />
        {/* Length counter · turns warn at 80%, danger at 100% */}
        <div
          className="font-mono"
          style={{
            position: "absolute",
            right: 50,
            bottom: 4,
            fontSize: 9,
            color: prompt.length >= 1500 ? "var(--danger)" : prompt.length >= 1200 ? "var(--warn)" : "var(--muted)",
            pointerEvents: "none",
          }}
        >
          {prompt.length}/1500
        </div>
        <button
          onClick={() => {
            if (micActive) builderStt.stop();
            else builderStt.start();
          }}
          disabled={busy}
          title={micActive ? "stop dictation" : "dictate prompt"}
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 32,
            height: 32,
            borderRadius: 16,
            background: micActive ? "var(--danger)" : "var(--accent)",
            color: "var(--on-accent)",
            border: "2px solid var(--bg)",
            cursor: busy ? "not-allowed" : "pointer",
            fontSize: 14,
            lineHeight: 1,
            boxShadow: micActive ? "0 0 0 4px rgba(255,80,80,0.35)" : "2px 2px 0 var(--shadow)",
            animation: micActive ? "delos-mic-pulse 0.9s ease-in-out infinite" : undefined,
          }}
        >
          {builderStt.state === "transcribing" ? "…" : micActive ? "■" : "🎙"}
        </button>
        {builderStt.state === "transcribing" && (
          <div className="text-[10px] font-mono mt-1" style={{ color: "var(--accent)" }}>transcribing your voice…</div>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {presets.map((p) => (
          <button
            key={p}
            disabled={busy}
            onClick={() => fillPromptSafe(p)}
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
                onClick={() => fillPromptSafe(t.prompt)}
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
      {/* UI style picker · 5 presets. Selected style is applied as a theme
          override on the spec post-build, so the same prompt can be styled
          5 different ways without re-running the LLM. */}
      <div className="space-y-1.5">
        <div className="font-pixel text-[10px] tracking-widest" style={{ color: "var(--accent)" }}>★ UI STYLE</div>
        <div className="grid grid-cols-5 gap-1">
          {UI_STYLES.map((s) => {
            const SIcon = (Icons as unknown as Record<string, React.ComponentType<{ size?: number; color?: string }>>)[s.icon] ?? Icons.Box;
            const active = uiStyle === s.id;
            return (
              <button
                key={s.id}
                disabled={busy}
                onClick={() => setUiStyle(s.id)}
                title={s.desc}
                className="card-pixel flex flex-col items-center gap-0.5"
                style={{
                  padding: "6px 4px",
                  cursor: busy ? "not-allowed" : "pointer",
                  background: active ? "var(--surface-2)" : "var(--surface)",
                  borderColor: active ? "var(--accent)" : "var(--surface-2)",
                  borderWidth: active ? 2 : 1,
                }}
              >
                <SIcon size={14} color={active ? "var(--accent)" : "var(--muted)"} />
                <span className="font-pixel text-[9px] tracking-wider" style={{ color: active ? "var(--accent)" : "var(--fg)" }}>
                  {s.label.toUpperCase()}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Production mode toggle · flips builds onto /api/codegen-app for
          full multi-file React/Next output rendered in DelCode IDE.
          Default off · keeps the lightweight DSL path for quick widgets.
          Refine flows are unaffected (always DSL spec patches). */}
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <button
          onClick={() => setProductionMode((v) => !v)}
          className={`pill cursor-pointer ${productionMode ? "pill-ok" : "pill-muted"}`}
          style={{ fontSize: 9, padding: "3px 9px" }}
          title="On = real React project streamed file-by-file into DelCode · Off = DelOS widget"
        >
          {productionMode ? "● PRODUCTION · ON" : "○ production · off"}
        </button>
        <span className="font-mono" style={{ fontSize: 9, color: "var(--muted)" }}>
          {productionMode ? "→ DelCode IDE · streamed multi-file build" : "→ DelOS widget · single-file DSL spec"}
        </span>
      </div>

      {/* Pre-build wizard · only visible when productionMode is on. Lets the
          user pick a UI style + scaffolding tier BEFORE the agent starts
          coding. Threads through to /api/codegen-app-stream as uiStyle +
          tier params. 2026-05-25 ask: "ask me the question initially —
          what type of UI you want · give me the categories of it · I can
          select · do you need prototype scaffolding type of things". */}
      {productionMode && (
        <div className="space-y-2 mt-2">
          <div>
            <div className="font-pixel text-[10px] tracking-widest mb-1" style={{ color: "var(--accent)" }}>★ UI CATEGORY</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1">
              {([
                { id: "modern-saas", label: "Modern SaaS", desc: "Inter · indigo · soft shadow · Linear / Stripe vibe" },
                { id: "editorial", label: "Editorial", desc: "Serif · prose · NYT / Stripe Press" },
                { id: "glassmorphism", label: "Glassmorph", desc: "Frosted blur · neon · Vision Pro vibe" },
                { id: "brutalist", label: "Brutalist", desc: "Hard shadows · 2px borders · mono uppercase" },
                { id: "linear-clean", label: "Linear-clean", desc: "Dense rows · neutral · single accent" },
                { id: "pixel-retro", label: "Pixel Retro", desc: "DelOS native · Pixelify Sans · CRT" },
                { id: "minimal-mono", label: "Minimal Mono", desc: "JetBrains Mono · monochrome" },
              ] as const).map((s) => {
                const active = codeStyle === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => setCodeStyle(s.id)}
                    className="card-pixel flex flex-col items-start"
                    title={s.desc}
                    style={{
                      padding: "5px 7px",
                      cursor: "pointer",
                      background: active ? "var(--surface-2)" : "var(--surface)",
                      borderColor: active ? "var(--accent)" : "var(--surface-2)",
                      borderWidth: active ? 2 : 1,
                    }}
                  >
                    <span className="font-pixel text-[9px] tracking-wider" style={{ color: active ? "var(--accent)" : "var(--fg)" }}>{s.label}</span>
                    <span className="font-mono text-[8px]" style={{ color: "var(--muted)" }}>{s.desc.slice(0, 40)}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div className="font-pixel text-[10px] tracking-widest mb-1" style={{ color: "var(--accent)" }}>★ SCAFFOLDING TIER</div>
            <div className="grid grid-cols-3 gap-1">
              {([
                { id: "prototype", label: "Prototype", desc: "5-7 files · happy path · demo-grade" },
                { id: "production", label: "Production", desc: "8-12 files · routes · settings · states" },
                { id: "same-to-same", label: "Same-to-same", desc: "10-14 files · clone fidelity · brand colors" },
              ] as const).map((t) => {
                const active = codeTier === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setCodeTier(t.id)}
                    className="card-pixel flex flex-col items-start"
                    title={t.desc}
                    style={{
                      padding: "5px 7px",
                      cursor: "pointer",
                      background: active ? "var(--surface-2)" : "var(--surface)",
                      borderColor: active ? "var(--accent)" : "var(--surface-2)",
                      borderWidth: active ? 2 : 1,
                    }}
                  >
                    <span className="font-pixel text-[9px] tracking-wider" style={{ color: active ? "var(--accent)" : "var(--fg)" }}>{t.label}</span>
                    <span className="font-mono text-[8px]" style={{ color: "var(--muted)" }}>{t.desc.slice(0, 42)}</span>
                  </button>
                );
              })}
            </div>
          </div>
          {/* Live coding progress · shown while the SSE stream emits files.
              Each file_done event updates this strip + lands the file in
              DelCode so the user watches the build happen. */}
          {codeProgress && (
            <div className="card-pixel" style={{ padding: "6px 8px", borderColor: "var(--accent)" }}>
              <div className="font-pixel text-[10px] tracking-wider" style={{ color: "var(--accent)" }}>
                ★ AGENT CODING · {codeProgress.index}/{codeProgress.total}
              </div>
              <div className="font-mono text-[10px] mt-1" style={{ color: "var(--fg)" }}>
                {codeProgress.status} · <span style={{ color: "var(--muted)" }}>{codeProgress.path}</span>
              </div>
            </div>
          )}
          {/* File checklist · per-file status with icons. Was a single
              "current file" line · users couldn't tell how far the build
              was or which files failed. Now: see every file in the plan
              + watch them flip queued → writing → ✓ done / ↻ retried /
              ✗ skipped in real time. */}
          {fileChecklist.length > 0 && (
            <div className="card-pixel" style={{ padding: "6px 8px", borderColor: "var(--surface-2)" }}>
              <div className="flex items-center justify-between mb-1">
                <div className="font-pixel text-[10px] tracking-wider" style={{ color: "var(--accent)" }}>
                  ★ PROJECT FILES · {fileChecklist.filter((r) => r.status === "done" || r.status === "retried").length}/{fileChecklist.length}
                </div>
                <button
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent("delos-launch-app", { detail: { id: "codebase" } }),
                    )
                  }
                  className="pill pill-info cursor-pointer"
                  style={{ fontSize: 9, padding: "2px 8px" }}
                  title="Jump to DelCode IDE to read the generated source"
                >
                  ▶ OPEN DELCODE
                </button>
              </div>
              <div
                className="font-mono text-[10px] space-y-0.5"
                style={{ maxHeight: 160, overflowY: "auto" }}
              >
                {fileChecklist.map((row) => {
                  const icon =
                    row.status === "done"
                      ? "✓"
                      : row.status === "retried"
                        ? "↻"
                        : row.status === "skipped"
                          ? "✗"
                          : row.status === "writing"
                            ? "▸"
                            : "·";
                  const color =
                    row.status === "done"
                      ? "var(--success)"
                      : row.status === "retried"
                        ? "var(--warn)"
                        : row.status === "skipped"
                          ? "var(--danger)"
                          : row.status === "writing"
                            ? "var(--accent)"
                            : "var(--muted)";
                  return (
                    <div key={row.path} className="flex items-baseline gap-2" title={row.reason || row.path}>
                      <span style={{ color, width: 10, display: "inline-block" }}>{icon}</span>
                      <span style={{ color: "var(--fg)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.path}</span>
                      {row.bytes != null && (
                        <span style={{ color: "var(--muted)" }}>{row.bytes >= 1024 ? `${(row.bytes / 1024).toFixed(1)}K` : `${row.bytes}b`}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {/* Follow-up error loop · appears after a successful build. User
              types the issue they noticed (UI bug, missing feature, error
              text) and clicks REBUILD → server gets previousProject +
              errorContext and patches the affected files. */}
          {lastProject && !busy && (
            <div className="space-y-1">
              <div className="font-pixel text-[10px] tracking-widest" style={{ color: "var(--accent)" }}>
                ★ REPORT AN ISSUE · agent will fix and rebuild
              </div>
              <textarea
                className="input-pixel"
                rows={2}
                value={errorFeedback}
                onChange={(e) => setErrorFeedback(e.target.value.slice(0, 1800))}
                placeholder={`e.g. "Sidebar overflows on mobile" · "Modal close button missing" · "Header copy says 'undefined'"`}
                style={{ fontSize: 11 }}
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (!errorFeedback.trim()) return;
                    void build(prompt);
                  }}
                  disabled={!errorFeedback.trim()}
                  className="btn-pixel"
                  style={{ fontSize: 10, padding: "5px 10px" }}
                >
                  ↻ REBUILD WITH FIX
                </button>
                <span className="font-mono text-[9px]" style={{ color: "var(--muted)" }}>
                  prior project + your feedback → patched files
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Sticky footer · keeps BUILD APP visible above the dock when the
          panel scrolls past it. Was a regular flex row that scrolled off
          screen on short heights, and forced clicks at the bottom
          landed on dock icons. position:sticky pins it to the bottom
          of THIS scroll context, not the viewport, so it always reaches
          the user above the safe area. 2026-05-25 brutal-QA P0. */}
      <div
        className="flex gap-2 items-center"
        style={{
          position: "sticky",
          bottom: 8,
          background: "var(--surface)",
          padding: "8px",
          borderTop: "1px solid var(--surface-2)",
          marginLeft: -12,
          marginRight: -12,
          paddingLeft: 12,
          paddingRight: 12,
          zIndex: 5,
        }}
      >
        <button
          className="btn-pixel success"
          onClick={() => {
            if (busy) return; // defensive · disabled already guards but
                              // QA reported "deploy twice quickly" race.
            if (!prompt.trim()) {
              window.dispatchEvent(
                new CustomEvent("toast", { detail: { text: "Enter a prompt first", tone: "warn" } }),
              );
              return;
            }
            void build();
          }}
          disabled={busy || !prompt.trim()}
          aria-label={busy ? "Building app (in progress)" : "Build app from prompt"}
          aria-busy={busy}
          title={busy ? "Build in progress — please wait" : "Generate the app from the prompt above"}
          style={{ padding: "8px 14px", fontSize: 12, cursor: busy ? "not-allowed" : "pointer" }}
        >
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

      {/* Last-built spec · refine + schema viewer + debug. Hidden until a
          successful build lands so the panel doesn't clutter empty state. */}
      {lastSpec && !busy && (
        <div className="space-y-2 mt-3" style={{ borderTop: "1px dashed var(--surface-2)", paddingTop: 10 }}>
          <div className="flex items-center justify-between">
            <span className="font-pixel text-[10px] tracking-widest" style={{ color: "var(--success)" }}>
              ✓ LAST BUILD · {lastSpec.name}
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => setShowSchema((v) => !v)}
                className="pill pill-muted"
                style={{ cursor: "pointer", fontSize: 9 }}
              >
                {showSchema ? "↑ HIDE SCHEMA" : "▾ SHOW SCHEMA"}
              </button>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(JSON.stringify(lastSpec, null, 2));
                    window.dispatchEvent(new CustomEvent("toast", { detail: { text: "schema copied", tone: "ok" } }));
                  } catch (e) {
                    window.dispatchEvent(new CustomEvent("toast", { detail: { text: `copy failed: ${(e as Error).message.slice(0, 30)}`, tone: "bad" } }));
                  }
                }}
                className="pill pill-muted"
                style={{ cursor: "pointer", fontSize: 9 }}
              >
                ⧉ COPY JSON
              </button>
            </div>
          </div>
          {showSchema && (
            <pre
              style={{
                background: "var(--surface)",
                border: "1px solid var(--surface-2)",
                padding: 8,
                maxHeight: 240,
                overflow: "auto",
                fontSize: 10,
                fontFamily: "ui-monospace, 'JetBrains Mono', monospace",
                color: "var(--muted)",
                whiteSpace: "pre",
              }}
            >
              {JSON.stringify(lastSpec, null, 2)}
            </pre>
          )}
          <div className="space-y-1">
            <div className="font-pixel text-[10px] tracking-widest" style={{ color: "var(--accent)" }}>↻ REFINE / DEBUG</div>
            <textarea
              className="input-pixel"
              rows={2}
              value={refinePrompt}
              onChange={(e) => setRefinePrompt(e.target.value)}
              placeholder='e.g. "add a reset button", "make the title bigger", "fix the cart total math"'
              disabled={busy}
            />
            <div className="flex gap-1.5">
              <button
                disabled={busy || !refinePrompt.trim()}
                onClick={() => {
                  if (!refinePrompt.trim() || !lastSpec) return;
                  const change = refinePrompt;
                  setRefinePrompt("");
                  build(change, { refineFromSpec: lastSpec });
                }}
                className="btn-pixel"
                style={{ fontSize: 11, padding: "6px 12px" }}
              >
                ↻ REFINE
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  if (!lastSpec) return;
                  setRefinePrompt("");
                  build(`Debug this app. Fix any bugs in bindings, missing initialState keys, broken actions, mis-named icons. Return a corrected spec.`, { refineFromSpec: lastSpec });
                }}
                className="btn-pixel ghost"
                style={{ fontSize: 11, padding: "6px 12px" }}
              >
                🐛 AUTO-DEBUG
              </button>
              <button
                disabled={busy}
                onClick={() => { setLastSpec(null); setShowSchema(false); setRefinePrompt(""); }}
                className="btn-pixel ghost"
                style={{ fontSize: 11, padding: "6px 12px", color: "var(--muted)" }}
              >
                ✕ DISMISS
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    {/* Right pane · inline DelCode preview · ONLY when productionMode +
        we have something to show. File tree on the left of this pane,
        active file content on the right. Click a row to focus that file.
        2026-05-25 ask · "DelCode to be added in the route of VibeCode". */}
    {productionMode && (streamingFiles.length > 0 || lastProject) && (
      <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "var(--bg)" }}>
        <div className="flex items-center justify-between px-2 py-1" style={{ background: "var(--surface)", borderBottom: "1px solid var(--surface-2)" }}>
          <span className="font-pixel text-[10px] tracking-widest" style={{ color: "var(--accent)" }}>
            {"</>"} DELCODE INLINE · {(streamingFiles.length || (lastProject?.files?.length ?? 0))} files
          </span>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("delos-launch-app", { detail: { id: "codebase" } }))}
            className="pill pill-info"
            style={{ fontSize: 9, padding: "1px 7px", cursor: "pointer" }}
            title="Open full DelCode IDE in its own window"
          >
            ⤢ FULL IDE
          </button>
        </div>
        <div className="flex flex-1 overflow-hidden">
          <div className="overflow-y-auto" style={{ flex: "0 0 200px", borderRight: "1px solid var(--surface-2)", background: "var(--surface)" }}>
            {(() => {
              const files = streamingFiles.length > 0 ? streamingFiles : lastProject?.files ?? [];
              if (files.length === 0)
                return <div className="p-3 font-mono text-[10px]" style={{ color: "var(--muted)" }}>No files yet · build will populate</div>;
              return files.map((f) => {
                const active = f.path === activePreviewPath;
                return (
                  <button
                    key={f.path}
                    onClick={() => setActivePreviewPath(f.path)}
                    className="block w-full text-left px-2 py-1 font-mono text-[10px]"
                    style={{
                      background: active ? "var(--surface-2)" : "transparent",
                      color: active ? "var(--accent)" : "var(--fg)",
                      cursor: "pointer",
                      border: "none",
                      borderLeft: active ? "2px solid var(--accent)" : "2px solid transparent",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {f.path}
                  </button>
                );
              });
            })()}
          </div>
          <div className="flex-1 overflow-auto" style={{ background: "#0a0a14" }}>
            {(() => {
              const files = streamingFiles.length > 0 ? streamingFiles : lastProject?.files ?? [];
              const active = files.find((f) => f.path === activePreviewPath) ?? files[files.length - 1];
              if (!active)
                return <div className="p-3 font-mono text-[10px]" style={{ color: "var(--muted)" }}>{busy ? "Agent coding · live files will appear here…" : "Click a file in the list to preview."}</div>;
              return (
                <pre
                  className="font-mono"
                  style={{
                    fontSize: 10,
                    lineHeight: 1.5,
                    color: "#e8e8f0",
                    padding: 10,
                    margin: 0,
                    whiteSpace: "pre",
                  }}
                >
                  {active.content}
                </pre>
              );
            })()}
          </div>
        </div>
      </div>
    )}
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
