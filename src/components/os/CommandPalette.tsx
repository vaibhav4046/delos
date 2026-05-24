"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import * as Icons from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export type Command = {
  id: string;
  label: string;
  hint?: string;
  icon?: string;
  section?: string;
  run: () => void;
};

export function CommandPalette({
  open,
  onClose,
  commands,
}: {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}) {
  const [query, setQuery] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIdx(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) => c.label.toLowerCase().includes(q) || (c.hint ?? "").toLowerCase().includes(q),
    );
  }, [query, commands]);

  useEffect(() => {
    if (idx >= filtered.length) setIdx(0);
  }, [filtered.length, idx]);

  const All = Icons as unknown as Record<string, React.ComponentType<{ size?: number; color?: string }>>;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[9000] flex items-start justify-center pt-24"
          style={{ background: "var(--overlay)", backdropFilter: "blur(6px)" }}
          onMouseDown={onClose}
        >
          <motion.div
            initial={{ y: -12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -12, opacity: 0 }}
            transition={{ type: "spring", stiffness: 360, damping: 26 }}
            onMouseDown={(e) => e.stopPropagation()}
            className="card-pixel w-[92vw] max-w-xl"
            style={{ padding: 0, borderColor: "var(--accent)", boxShadow: "0 0 0 2px var(--bg), 0 0 0 4px var(--accent), 8px 8px 0 0 #0a0a14" }}
          >
            <div className="flex items-center gap-2 p-3 border-b-2 border-[color:var(--surface-2)]">
              <Icons.Search size={16} color="var(--accent)" />
              <input
                ref={inputRef}
                className="flex-1 bg-transparent outline-none font-mono text-sm"
                style={{ color: "var(--fg)" }}
                placeholder="type a command…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setIdx((i) => Math.min(filtered.length - 1, i + 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setIdx((i) => Math.max(0, i - 1));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    const c = filtered[idx];
                    if (c) {
                      c.run();
                      onClose();
                    }
                  } else if (e.key === "Escape") {
                    onClose();
                  }
                }}
              />
              <span className="pill pill-muted" style={{ fontSize: 9 }}>ESC</span>
            </div>
            <ul className="max-h-[50vh] overflow-y-auto">
              {filtered.length === 0 && (
                <li className="p-4 font-mono text-xs text-[color:var(--muted)]">no commands</li>
              )}
              {filtered.map((c, i) => {
                const name = (c.icon ?? "ChevronRight").replace(/^./, (s) => s.toUpperCase());
                const Cmp = All[name] ?? Icons.ChevronRight;
                const active = i === idx;
                return (
                  <li
                    key={c.id}
                    onMouseEnter={() => setIdx(i)}
                    onClick={() => {
                      c.run();
                      onClose();
                    }}
                    className="flex items-center gap-3 px-3 py-2 cursor-pointer border-l-4"
                    style={{
                      background: active ? "var(--surface-2)" : "transparent",
                      borderColor: active ? "var(--accent)" : "transparent",
                    }}
                  >
                    <Cmp size={14} color={active ? "var(--accent)" : "var(--muted)"} />
                    <div className="flex-1 min-w-0">
                      <div className="font-pixel text-sm tracking-wider" style={{ color: active ? "var(--fg)" : "var(--fg)" }}>{c.label}</div>
                      {c.hint && <div className="font-mono text-[10px] text-[color:var(--muted)] truncate">{c.hint}</div>}
                    </div>
                    {c.section && <span className="pill pill-muted" style={{ fontSize: 9 }}>{c.section}</span>}
                  </li>
                );
              })}
            </ul>
            <div className="px-3 py-2 border-t-2 border-[color:var(--surface-2)] flex items-center justify-between font-mono text-[10px] text-[color:var(--muted)]">
              <span>↑↓ navigate · enter run · esc close</span>
              <span>⌘K / ctrl-K to open</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
