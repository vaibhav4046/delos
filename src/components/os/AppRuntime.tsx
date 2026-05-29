"use client";
import { useState, useCallback } from "react";
import * as Icons from "lucide-react";
import type { AppAction, AppNode, AppSpec } from "@/lib/appSpec";

type StateMap = Record<string, unknown>;

function interpolate(template: string, state: StateMap): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const parts = path.split(".");
    let cur: unknown = state;
    for (const p of parts) {
      if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[p];
      } else {
        return "";
      }
    }
    return String(cur ?? "");
  });
}

function truthy(expr: string | undefined, state: StateMap): boolean {
  if (!expr) return true;
  const value = interpolate(`{{${expr}}}`, state).trim();
  if (!value) return false;
  if (value === "false" || value === "0") return false;
  return true;
}

export function AppRuntime({
  spec,
  onClose,
  onNotify,
  onAgent,
  onTool,
}: {
  spec: AppSpec;
  onClose: () => void;
  onNotify: (msg: string) => void;
  onAgent: (prompt: string, saveAs: string, ctx: { setState: (s: StateMap) => void; current: StateMap }) => Promise<void>;
  onTool: (tool: string, args: Record<string, string>, saveAs: string | undefined, ctx: { setState: (s: StateMap) => void; current: StateMap }) => Promise<void>;
}) {
  const [state, setState] = useState<StateMap>(() => spec.initialState ?? {});
  const [busy, setBusy] = useState(false);

  const update = useCallback((patch: StateMap) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  const dispatch = useCallback(
    async (actions: AppAction[]) => {
      for (const a of actions) {
        switch (a.kind) {
          case "set":
            update({ [a.key]: interpolate(a.value, state) });
            break;
          case "toggle":
            update({ [a.key]: !state[a.key] });
            break;
          case "inc": {
            const cur = Number(state[a.key] ?? 0);
            update({ [a.key]: cur + (a.by ?? 1) });
            break;
          }
          case "push": {
            const list = Array.isArray(state[a.listKey]) ? (state[a.listKey] as string[]) : [];
            update({ [a.listKey]: [...list, interpolate(a.valueTemplate, state)] });
            break;
          }
          case "clear":
            update({ [a.key]: Array.isArray(state[a.key]) ? [] : "" });
            break;
          case "notify":
            onNotify(interpolate(a.text, state));
            break;
          case "close":
            onClose();
            break;
          case "tool": {
            const args: Record<string, string> = {};
            if (a.argsTemplate) {
              for (const [k, v] of Object.entries(a.argsTemplate)) args[k] = interpolate(v, state);
            }
            setBusy(true);
            try {
              await onTool(a.tool, args, a.saveAs, { setState: update, current: state });
            } finally {
              setBusy(false);
            }
            break;
          }
          case "agent": {
            const prompt = interpolate(a.promptTemplate, state);
            setBusy(true);
            try {
              await onAgent(prompt, a.saveAs, { setState: update, current: state });
            } finally {
              setBusy(false);
            }
            break;
          }
        }
      }
    },
    [state, update, onNotify, onClose, onAgent, onTool],
  );

  // Per-app theme · spec.theme overrides the DelOS palette inside this
  // window only. Variables flow down to every NodeR call via inherited
  // CSS so buttons / pills / cards / inputs all retint without code
  // changes. Falls back to OS tokens when fields are absent.
  const themeVars: React.CSSProperties = {};
  type ThemeBlock = { bg?: string; surface?: string; surface2?: string; fg?: string; muted?: string; accent?: string; onAccent?: string; font?: string; pixelFont?: string; radius?: string | number };
  const theme = (spec as unknown as { theme?: ThemeBlock }).theme;
  if (theme) {
    if (theme.bg) (themeVars as Record<string, string>)["--bg"] = theme.bg;
    if (theme.surface) (themeVars as Record<string, string>)["--surface"] = theme.surface;
    if (theme.surface2) (themeVars as Record<string, string>)["--surface-2"] = theme.surface2;
    if (theme.fg) (themeVars as Record<string, string>)["--fg"] = theme.fg;
    if (theme.muted) (themeVars as Record<string, string>)["--muted"] = theme.muted;
    if (theme.accent) (themeVars as Record<string, string>)["--accent"] = theme.accent;
    if (theme.onAccent) (themeVars as Record<string, string>)["--on-accent"] = theme.onAccent;
    if (theme.font) (themeVars as Record<string, string>)["--font-sans"] = theme.font;
    if (theme.pixelFont) (themeVars as Record<string, string>)["--font-pixel"] = theme.pixelFont;
  }
  const themed = !!theme;
  // Detect html-root specs · they manage their own padding so we strip
  // the default 16px padding to avoid double-margins around the brand
  // layout. Same for the `space-y-3` and flex `min-height:100%` which
  // would force a min-height on the wrapper that fights window resize.
  const rootIsHtml = (spec.root as { kind?: string }).kind === "html";
  return (
    <div
      className={`${rootIsHtml ? "" : "p-4 space-y-3"} text-[color:var(--fg)] ${themed ? "app-themed" : ""}`}
      style={{
        ...themeVars,
        opacity: busy ? 0.8 : 1,
        transition: "opacity 120ms",
        background: themed ? "var(--bg)" : undefined,
        // Fill the window — flex column so children with `flex:1` (the
        // html escape-hatch block, list cards, etc) absorb the available
        // height and shrink on resize instead of overflowing.
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: rootIsHtml ? "hidden" : "auto",
        fontFamily: theme?.font ? theme.font : undefined,
      }}
    >
      <NodeR node={spec.root} state={state} dispatch={dispatch} update={update} />
      {busy && (
        <div className="flex items-center gap-2 pt-2 text-[color:var(--muted)] font-mono text-xs">
          <Icons.Loader2 size={12} className="animate-spin" />
          <span>working…</span>
        </div>
      )}
    </div>
  );
}

function NodeR({
  node,
  state,
  dispatch,
  update,
}: {
  node: AppNode;
  state: StateMap;
  dispatch: (a: AppAction[]) => void;
  update: (patch: StateMap) => void;
}) {
  if (!truthy(node.if, state)) return null;
  const cls = node.className ?? "";
  switch (node.kind) {
    case "text": {
      const v = interpolate(node.value, state);
      const size = node.size ?? "body";
      if (size === "h1") return <h1 className={`font-pixel text-2xl tracking-wider ${cls}`} style={{ color: "var(--accent)" }}>{v}</h1>;
      if (size === "h2") return <h2 className={`font-pixel text-lg tracking-wider ${cls}`}>{v}</h2>;
      if (size === "h3") return <h3 className={`font-pixel text-base tracking-wider ${cls}`}>{v}</h3>;
      if (size === "mono") return <code className={`block font-mono text-xs whitespace-pre-wrap ${cls}`} style={{ color: "var(--muted)" }}>{v}</code>;
      return <p className={`text-sm leading-relaxed ${cls}`} style={{ color: "var(--fg)" }}>{v}</p>;
    }
    case "button": {
      const variant = node.variant ?? "primary";
      const cn = `btn-pixel ${variant === "ghost" ? "ghost" : variant === "danger" ? "danger" : variant === "success" ? "success" : ""} ${cls}`;
      return (
        <button className={cn} onClick={() => void dispatch(node.actions)}>
          {interpolate(node.label, state)}
        </button>
      );
    }
    case "input": {
      const v = String(state[node.bind] ?? "");
      if (node.type === "textarea") {
        return (
          <textarea
            className={`input-pixel ${cls}`}
            placeholder={node.placeholder}
            value={v}
            onChange={(e) => update({ [node.bind]: e.target.value })}
            rows={3}
          />
        );
      }
      return (
        <input
          className={`input-pixel ${cls}`}
          type={node.type === "number" ? "number" : "text"}
          placeholder={node.placeholder}
          value={v}
          onChange={(e) => update({ [node.bind]: e.target.value })}
        />
      );
    }
    case "row":
      return (
        <div className={`flex items-center ${cls}`} style={{ gap: (node.gap ?? 2) * 4 }}>
          {node.children.map((c, i) => (
            <NodeR key={i} node={c} state={state} dispatch={dispatch} update={update} />
          ))}
        </div>
      );
    case "col":
      return (
        <div className={`flex flex-col ${cls}`} style={{ gap: (node.gap ?? 2) * 4 }}>
          {node.children.map((c, i) => (
            <NodeR key={i} node={c} state={state} dispatch={dispatch} update={update} />
          ))}
        </div>
      );
    case "card":
      return (
        <div className={`card-pixel ${cls}`}>
          {node.children.map((c, i) => (
            <NodeR key={i} node={c} state={state} dispatch={dispatch} update={update} />
          ))}
        </div>
      );
    case "list": {
      const arr = Array.isArray(state[node.bindKey]) ? (state[node.bindKey] as string[]) : [];
      if (arr.length === 0)
        return <div className={`text-sm text-[color:var(--muted)] ${cls}`}>{node.emptyText ?? "Empty."}</div>;
      return (
        <ul className={`space-y-1 ${cls}`}>
          {arr.map((it, i) => (
            <li key={i} className="card-pixel text-sm">
              {interpolate(node.itemTemplate, { ...state, item: it, index: i })}
            </li>
          ))}
        </ul>
      );
    }
    case "divider":
      return <hr className={`border-[color:var(--surface-2)] ${cls}`} />;
    case "image": {
      const name = node.icon.charAt(0).toUpperCase() + node.icon.slice(1);
      const All = Icons as unknown as Record<string, React.ComponentType<{ size?: number; color?: string }>>;
      const Cmp = All[name] ?? Icons.Box;
      return (
        <div className={cls}>
          <Cmp size={node.size ?? 24} color="var(--accent)" />
        </div>
      );
    }
    case "spacer":
      return <div style={{ height: node.size ?? 8 }} />;
    case "pill": {
      const tone = node.tone ?? "info";
      return <span className={`pill pill-${tone} ${cls}`}>{interpolate(node.text, state)}</span>;
    }
    case "html": {
      // Curated escape hatch · clones ship hand-crafted layouts the DSL
      // can't express. Sanitize aggressively before injecting since AppSpecs
      // can also come from the LLM path:
      //   • drop <script>, <iframe>, <object>, <embed>, <link>, <meta>
      //   • strip on* event-handler attributes
      //   • strip javascript:/data:text/html URLs in href/src
      // Keep inline `style` + `class` + `data-*` so brand layouts retain
      // their typography & spacing. Templated `{{state}}` interpolation
      // still runs so dynamic values flow through.
      const interpolated = interpolate(node.html, state);
      const safe = sanitizeHtml(interpolated);
      // Render as a flex-fill block so absolute-positioned children (macOS
      // dock, Snapchat phone bezel) keep their layout when the window is
      // resized. Was a hardcoded 580px height which clipped/leaked layout
      // when the user resized the window. Now fills the window height
      // and scrolls internally when content overflows.
      return (
        <div
          className={`app-html-block ${cls}`}
          style={{
            flex: 1,
            minHeight: 360,
            width: "100%",
            overflow: "auto",
            display: "flex",
            flexDirection: "column",
          }}
          dangerouslySetInnerHTML={{ __html: safe }}
        />
      );
    }
  }
}

// HTML sanitizer for the `html` escape-hatch node. AppSpecs can originate
// from the LLM path, so the markup is untrusted and must be sanitized before
// it reaches dangerouslySetInnerHTML.
//
// Two layers:
//   1. A regex pre-pass that strips script/style bodies and dangerous tags.
//      This is the SSR baseline (no DOM available) and also a cheap fast-path.
//   2. A DOM allowlist pass (client only). Parsing with the browser's own
//      HTMLParser canonicalizes the markup — defeating mutation-XSS and
//      entity-encoded bypasses (e.g. `jav&#x09;ascript:`), because attribute
//      values are read back already entity-decoded. Anything not on the tag /
//      attribute allowlist is dropped.
//
// A regex-only sanitizer is known-bypassable, so the DOM pass is what we rely
// on for safety; the regex pass is defense-in-depth for the (in practice never
// hit) server-render path where these windowed apps don't yet exist.

const ALLOWED_TAGS = new Set([
  "a", "abbr", "article", "aside", "b", "blockquote", "br", "button", "canvas",
  "caption", "code", "col", "colgroup", "dd", "div", "dl", "dt", "em", "figure",
  "figcaption", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "i",
  "img", "input", "label", "li", "main", "mark", "nav", "ol", "option", "p",
  "picture", "pre", "section", "select", "small", "source", "span", "strong",
  "sub", "sup", "s", "table", "tbody", "td", "textarea", "tfoot", "th", "thead",
  "time", "tr", "u", "ul",
]);

const ALLOWED_ATTR =
  /^(class|id|style|title|alt|src|srcset|href|width|height|colspan|rowspan|type|placeholder|value|name|role|tabindex|disabled|checked|selected|readonly|maxlength|min|max|step|for|aria-[\w-]+|data-[\w-]+)$/i;

function safeUrlAttr(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v.startsWith("javascript:") || v.startsWith("vbscript:")) return false;
  // Allow data: only for images (brand clones inline small logos as data URIs);
  // block data:text/html and any other data: payload that can run script.
  if (v.startsWith("data:") && !v.startsWith("data:image/")) return false;
  return true;
}

function sanitizeDom(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const walk = (parent: Element) => {
    for (const child of Array.from(parent.children)) {
      const tag = child.tagName.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) {
        child.remove();
        continue;
      }
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase();
        if (!ALLOWED_ATTR.test(name)) {
          child.removeAttribute(attr.name);
          continue;
        }
        if ((name === "href" || name === "src" || name === "srcset") && !safeUrlAttr(attr.value)) {
          child.removeAttribute(attr.name);
          continue;
        }
        // CSS can smuggle script via expression() / javascript: in url().
        if (name === "style" && /(expression\s*\(|javascript:|vbscript:|@import|<\/?\w)/i.test(attr.value)) {
          child.removeAttribute(attr.name);
        }
      }
      walk(child);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

function regexStrip(html: string): string {
  let s = String(html || "");
  s = s.replace(/<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, "");
  s = s.replace(/<\s*style\b[^>]*>[\s\S]*?<\s*\/\s*style\s*>/gi, "");
  s = s.replace(/<\s*(iframe|object|embed|link|meta|form|svg|math)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "");
  s = s.replace(/<\s*(iframe|object|embed|link|meta|svg|math)\b[^>]*\/?>/gi, "");
  s = s.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "");
  s = s.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "");
  s = s.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "");
  s = s.replace(/\b(href|src)\s*=\s*"\s*(javascript|vbscript|data\s*:\s*text\/html)[^"]*"/gi, '$1="#"');
  s = s.replace(/\b(href|src)\s*=\s*'\s*(javascript|vbscript|data\s*:\s*text\/html)[^']*'/gi, "$1='#'");
  return s;
}

function sanitizeHtml(html: string): string {
  const pre = regexStrip(html);
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    return pre; // SSR baseline — windowed apps don't render server-side anyway.
  }
  try {
    return sanitizeDom(pre);
  } catch {
    return pre;
  }
}

