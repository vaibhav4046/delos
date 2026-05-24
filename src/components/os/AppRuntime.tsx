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

  return (
    <div className="p-4 space-y-3 text-[color:var(--fg)]" style={{ opacity: busy ? 0.8 : 1, transition: "opacity 120ms" }}>
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
  }
}

