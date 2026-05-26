"use client";
// Real client-side terminal via xterm.js.
//
// Subscribes to /api/run SSE for an agent and pipes events into a colored
// terminal rendered by xterm. Looks identical to a real PTY session from
// the user's perspective. No node-pty (Vercel serverless can't spawn
// processes), but the visual + interaction surface matches MissionControl's
// xterm-based Agent Fleet panes.

import { useEffect, useRef } from "react";
import type { Terminal as XTerm } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

type RunEvent =
  | { t: "meta"; runId: string; at?: number }
  | { t: "phase"; phase: string; note?: string; at?: number }
  | { t: "thought"; agent: string; text: string; at?: number }
  | { t: "tool_call"; name: string; args: unknown; at?: number }
  | { t: "tool_result"; name: string; ok: boolean; result?: unknown; error?: string; at?: number }
  | { t: "recover"; strategy: string; reason: string; at?: number }
  | { t: "usage"; role: string; model: string; promptTokens: number; completionTokens: number; ms: number; at?: number }
  | { t: "answer"; text: string; at?: number }
  | { t: "error"; message: string; at?: number };

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

function eventToLine(ev: RunEvent, baseAt: number): string {
  const t = ev.at ? ((ev.at - baseAt) / 1000).toFixed(2) : "0.00";
  const ts = `${ANSI.gray}[${t.padStart(6, " ")}s]${ANSI.reset}`;
  switch (ev.t) {
    case "meta":
      return `${ts} ${ANSI.cyan}BOOT${ANSI.reset} ${ANSI.dim}runId=${ev.runId}${ANSI.reset}`;
    case "phase":
      return `${ts} ${ANSI.yellow}${ev.phase.toUpperCase()}${ANSI.reset} ${ev.note ?? ""}`;
    case "thought":
      return `${ts} ${ANSI.magenta}${ev.agent}${ANSI.reset} ${ANSI.dim}${ev.text.slice(0, 200)}${ANSI.reset}`;
    case "tool_call":
      return `${ts} ${ANSI.blue}→ ${ev.name}${ANSI.reset} ${ANSI.dim}${JSON.stringify(ev.args).slice(0, 120)}${ANSI.reset}`;
    case "tool_result": {
      const head = ev.ok ? `${ANSI.green}✓${ANSI.reset}` : `${ANSI.red}✗${ANSI.reset}`;
      const tail = ev.ok
        ? `${ANSI.dim}${JSON.stringify(ev.result).slice(0, 140)}${ANSI.reset}`
        : `${ANSI.red}${(ev.error ?? "").slice(0, 140)}${ANSI.reset}`;
      return `${ts} ${head} ${ev.name} ${tail}`;
    }
    case "recover":
      return `${ts} ${ANSI.green}${ANSI.bold}1-UP${ANSI.reset} ${ev.strategy} ${ANSI.dim}${ev.reason}${ANSI.reset}`;
    case "usage":
      return `${ts} ${ANSI.gray}llm${ANSI.reset} ${ANSI.bold}${ev.role}${ANSI.reset} ${ANSI.dim}${ev.model} ${ev.promptTokens}→${ev.completionTokens}t ${ev.ms}ms${ANSI.reset}`;
    case "answer":
      return `${ts} ${ANSI.green}${ANSI.bold}ANSWER${ANSI.reset}\r\n${ev.text}`;
    case "error":
      return `${ts} ${ANSI.red}${ANSI.bold}ERR${ANSI.reset} ${ev.message}`;
    default:
      return `${ts} ${ANSI.dim}${JSON.stringify(ev).slice(0, 160)}${ANSI.reset}`;
  }
}

export function XtermPanel({
  goal,
  tenant,
  height = 360,
  autoStart = true,
  onAnswer,
  onDone,
  prelude,
}: {
  goal: string;
  tenant?: string;
  height?: number;
  autoStart?: boolean;
  onAnswer?: (text: string) => void;
  onDone?: () => void;
  prelude?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);

  // Mount xterm once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      // CSS already loaded via globals.css import below.
      if (cancelled || !ref.current) return;
      const t = new Terminal({
        cursorBlink: true,
        fontSize: 12,
        fontFamily: "JetBrains Mono, ui-monospace, Menlo, monospace",
        theme: {
          background: "#07070B",
          foreground: "#FFFFFF",
          cursor: "#FFD60A",
          black: "#0F0F18",
          red: "#C0392B",
          green: "#6AB04C",
          yellow: "#FFD60A",
          blue: "#5DE6FF",
          magenta: "#C39DFF",
          cyan: "#5DE6FF",
          white: "#FFFFFF",
        },
        scrollback: 1500,
        convertEol: true,
      });
      const fit = new FitAddon();
      t.loadAddon(fit);
      t.open(ref.current);
      fit.fit();
      termRef.current = t;
      fitRef.current = fit;
      if (prelude) {
        for (const line of prelude.split(/\r?\n/)) t.writeln(line);
      }
      const ro = new ResizeObserver(() => { try { fit.fit(); } catch {} });
      ro.observe(ref.current);
      if (autoStart && goal.trim()) {
        startStream();
      }
    })();
    return () => {
      cancelled = true;
      ctrlRef.current?.abort();
      try { termRef.current?.dispose(); } catch {}
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startStream() {
    const t = termRef.current;
    if (!t) return;
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    t.writeln(`${ANSI.cyan}$ delos run${ANSI.reset} ${ANSI.dim}--tenant=${tenant ?? "auto"}${ANSI.reset} ${ANSI.bold}"${goal.slice(0, 80)}"${ANSI.reset}`);
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: goal, goal, tenantId: tenant }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        t.writeln(`${ANSI.red}HTTP ${res.status}${ANSI.reset}`);
        onDone?.();
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      const baseAt = Date.now();
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
            t.writeln(eventToLine(ev, baseAt));
            if (ev.t === "answer" && onAnswer) onAnswer(ev.text);
          } catch {
            /* skip malformed */
          }
        }
      }
      t.writeln(`${ANSI.gray}— stream closed —${ANSI.reset}`);
      onDone?.();
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        t.writeln(`${ANSI.red}stream error: ${(e as Error).message}${ANSI.reset}`);
      }
      onDone?.();
    }
  }

  return (
    <div
      ref={ref}
      style={{
        height,
        width: "100%",
        background: "#07070B",
        border: "1px solid var(--surface-2)",
        padding: 4,
      }}
    />
  );
}
