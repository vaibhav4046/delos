"use client";
import { useEffect, useRef, useState } from "react";
import * as Icons from "lucide-react";
import type { ModelKey } from "@/lib/llm.catalog";
import { ClaudeIcon, ChatGPTIcon, PerplexityIcon } from "@/components/BrandIcons";

const HEADER_ICONS: Record<string, React.ComponentType<{ size?: number; color?: string }>> = {
  claude: ClaudeIcon,
  chatgpt: ChatGPTIcon,
  perplexity: PerplexityIcon,
};

type Msg = { role: "user" | "assistant"; content: string; ts: number; ms?: number; tokens?: number };

export type ChatConfig = {
  id: string;
  title: string;
  brandColor: string;
  brandLogo?: string;
  model: ModelKey;
  systemPrompt: string;
  placeholder?: string;
  withSearch?: boolean;
  searchMcpUrl?: string;
};

export function ChatApp({ config }: { config: ChatConfig }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [searching, setSearching] = useState<string | null>(null);
  const [model, setModel] = useState<ModelKey>(config.model);
  const ctrlRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const storeKey = `delos.chat.${config.id}.v1`;

  // Load history on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storeKey);
      if (raw) setMsgs(JSON.parse(raw));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.id]);

  // Persist
  useEffect(() => {
    try {
      localStorage.setItem(storeKey, JSON.stringify(msgs.slice(-50)));
    } catch {}
  }, [msgs, storeKey]);

  // Scroll to bottom
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [msgs, streaming, searching]);

  // Probe real-API availability for brand routing
  const [realAvail, setRealAvail] = useState<{ claude: boolean; chatgpt: boolean }>({ claude: false, chatgpt: false });
  useEffect(() => {
    fetch("/api/brand-chat")
      .then((r) => r.json())
      .then((j) => setRealAvail({ claude: !!j.claude, chatgpt: !!j.chatgpt }))
      .catch(() => {});
  }, []);
  const isRealBrand = (config.id === "claude" && realAvail.claude) || (config.id === "chatgpt" && realAvail.chatgpt);

  async function tryRealBrand(userMsg: Msg): Promise<string | null> {
    if (config.id !== "claude" && config.id !== "chatgpt") return null;
    try {
      const r = await fetch("/api/brand-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand: config.id,
          messages: [...msgs, userMsg].map((m) => ({ role: m.role, content: m.content })),
          systemPrompt: config.systemPrompt,
        }),
      });
      if (!r.ok) return null;
      const j = (await r.json()) as { ok: boolean; text?: string };
      if (!j.ok || !j.text) return null;
      return j.text;
    } catch {
      return null;
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    const userMsg: Msg = { role: "user", content: text, ts: Date.now() };
    const assistantMsg: Msg = { role: "assistant", content: "", ts: Date.now() };
    setMsgs((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setStreaming(true);
    setSearching(null);

    // Try real brand API first if claude/chatgpt keys present
    if (isRealBrand) {
      const real = await tryRealBrand(userMsg);
      if (real) {
        setMsgs((prev) => {
          const next = [...prev];
          next[next.length - 1] = { ...next[next.length - 1], content: real };
          return next;
        });
        setStreaming(false);
        return;
      }
    }

    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...msgs, userMsg].map((m) => ({ role: m.role, content: m.content })),
          model,
          system: config.systemPrompt,
          withSearch: config.withSearch ?? false,
          searchMcpUrl: config.searchMcpUrl,
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
              setMsgs((prev) => {
                const next = [...prev];
                next[next.length - 1] = { ...next[next.length - 1], content: acc };
                return next;
              });
            } else if (ev.t === "search_start") {
              setSearching(ev.query);
            } else if (ev.t === "search_result") {
              setSearching(null);
            } else if (ev.t === "done") {
              setMsgs((prev) => {
                const next = [...prev];
                next[next.length - 1] = { ...next[next.length - 1], ms: ev.ms, tokens: ev.completionTokens };
                return next;
              });
            } else if (ev.t === "error") {
              setMsgs((prev) => {
                const next = [...prev];
                next[next.length - 1] = { ...next[next.length - 1], content: `[error: ${ev.message}]` };
                return next;
              });
            }
          } catch {}
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setMsgs((prev) => {
          const next = [...prev];
          next[next.length - 1] = { ...next[next.length - 1], content: `[error: ${(e as Error).message}]` };
          return next;
        });
      }
    } finally {
      setStreaming(false);
      setSearching(null);
    }
  }

  function clear() {
    setMsgs([]);
    try { localStorage.removeItem(storeKey); } catch {}
  }

  function stop() {
    ctrlRef.current?.abort();
    setStreaming(false);
    setSearching(null);
  }

  return (
    <div className="p-3 h-full flex flex-col gap-2 text-xs">
      <div className="card-pixel" style={{ borderColor: config.brandColor, padding: 8 }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {(() => {
              const Brand = HEADER_ICONS[config.id];
              return Brand ? <Brand size={18} color={config.brandColor} /> : null;
            })()}
            <span className="font-pixel text-sm tracking-wider" style={{ color: config.brandColor }}>{config.title}</span>
            {config.withSearch && <span className="pill pill-info" style={{ fontSize: 9 }}>web</span>}
            {isRealBrand && <span className="pill pill-ok" style={{ fontSize: 9 }}>★ REAL API</span>}
            {!isRealBrand && config.id === "claude" && <span className="pill pill-muted" style={{ fontSize: 9 }}>via mistral</span>}
            {!isRealBrand && config.id === "chatgpt" && <span className="pill pill-muted" style={{ fontSize: 9 }}>via groq gpt-oss</span>}
          </div>
          <div className="flex items-center gap-1">
            <select value={model} onChange={(e) => setModel(e.target.value as ModelKey)} className="font-mono text-[10px]" style={{ background: "var(--surface)", color: "var(--fg)", border: "1px solid var(--surface-2)", padding: "2px 4px" }}>
              <option value="groq:openai/gpt-oss-120b">Groq GPT-OSS 120B</option>
              <option value="groq:openai/gpt-oss-20b">Groq GPT-OSS 20B</option>
              <option value="groq:meta-llama/llama-4-scout-17b-16e-instruct">Llama 4 Scout</option>
              <option value="groq:moonshotai/kimi-k2-instruct-0905">Kimi K2</option>
              <option value="mistral:mistral-large-latest">Mistral Large</option>
              <option value="mistral:mistral-small-latest">Mistral Small</option>
              <option value="google:gemini-2.5-flash">Gemini 2.5 Flash</option>
              <option value="google:gemini-2.5-pro">Gemini 2.5 Pro</option>
            </select>
            <button onClick={clear} className="pill pill-muted cursor-pointer" title="Clear history"><Icons.Trash2 size={10} /></button>
          </div>
        </div>
        <p className="text-[10px] text-[color:var(--muted)] font-mono mt-1">{config.placeholder ?? "ask anything"}</p>
      </div>

      <div ref={logRef} className="flex-1 overflow-y-auto border-2 border-[color:var(--surface-2)] p-2 space-y-2 font-mono" style={{ minHeight: 220 }}>
        {msgs.length === 0 && (
          <div className="text-[color:var(--muted)]">conversation starts here…</div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className="flex items-start gap-2">
            <span
              className="pill mt-0.5"
              style={{
                fontSize: 9,
                color: m.role === "user" ? "var(--fg)" : config.brandColor,
                borderColor: m.role === "user" ? "var(--muted)" : config.brandColor,
              }}
            >
              {m.role === "user" ? "YOU" : config.title.toUpperCase().slice(0, 5)}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] leading-relaxed whitespace-pre-wrap">{m.content || (i === msgs.length - 1 && streaming ? "…" : "")}</p>
              {m.role === "assistant" && m.ms !== undefined && (
                <div className="flex gap-2 text-[9px] text-[color:var(--muted)] mt-0.5">
                  <span>{m.ms}ms</span>
                  {m.tokens !== undefined && <span>{m.tokens} tok</span>}
                </div>
              )}
            </div>
          </div>
        ))}
        {searching && (
          <div className="flex items-center gap-2 text-[color:var(--muted)]">
            <Icons.Search size={12} className="animate-pulse" /> searching: {searching}…
          </div>
        )}
        {streaming && !searching && (
          <div className="flex items-center gap-2 text-[color:var(--muted)]">
            <Icons.Loader2 size={12} className="animate-spin" /> thinking…
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <textarea
          className="input-pixel flex-1"
          rows={2}
          placeholder={config.placeholder ?? "ask anything…"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={streaming}
        />
        {streaming ? (
          <button onClick={stop} className="btn-pixel danger" style={{ padding: "6px 10px", fontSize: 11 }}>STOP</button>
        ) : (
          <button onClick={send} disabled={!input.trim()} className="btn-pixel" style={{ padding: "6px 10px", fontSize: 11, background: config.brandColor }}>SEND</button>
        )}
      </div>
    </div>
  );
}

export function ClaudeApp() {
  return (
    <ChatApp
      config={{
        id: "claude",
        title: "Claude",
        brandColor: "#cc7c5f",
        model: "mistral:mistral-large-latest",
        systemPrompt:
          "You are Claude, a helpful, harmless, and honest AI assistant. Be thoughtful, nuanced, and careful with your reasoning. Use markdown sparingly. Hedge appropriately.",
        placeholder: "Ask Claude anything…",
      }}
    />
  );
}

export function ChatGPTApp() {
  return (
    <ChatApp
      config={{
        id: "chatgpt",
        title: "ChatGPT",
        brandColor: "#10a37f",
        model: "groq:openai/gpt-oss-120b",
        systemPrompt:
          "You are ChatGPT, a large language model. Be friendly, helpful, and concise. Format answers cleanly with bullets or headings when appropriate. Don't refuse reasonable requests.",
        placeholder: "Send a message…",
      }}
    />
  );
}

export function PerplexityApp() {
  return (
    <ChatApp
      config={{
        id: "perplexity",
        title: "Perplexity",
        brandColor: "#20808d",
        // Free-tier-confirmed model. Kimi K2 is paid on this account.
        model: "groq:openai/gpt-oss-120b",
        systemPrompt:
          "You are Perplexity, an answer engine. Search the web for context, then answer with concise citations. If web context is provided in the system message, weave it into the answer. Always cite sources inline like [1]. Be direct, no hedging.",
        placeholder: "Ask anything — searches the web first…",
        withSearch: true,
        searchMcpUrl: typeof window !== "undefined" ? new URL("/api/mcp/demo", window.location.origin).toString() : "",
      }}
    />
  );
}
