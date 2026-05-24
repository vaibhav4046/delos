"use client";
import { motion, AnimatePresence } from "framer-motion";
import * as Icons from "lucide-react";

const SHORTCUTS: Array<{ keys: string; desc: string; section: string }> = [
  { keys: "⌘ K / Ctrl K", desc: "Open command palette", section: "Global" },
  { keys: "⌘ /", desc: "Toggle this shortcuts list", section: "Global" },
  { keys: "Esc", desc: "Close focused window · close palette · close modal", section: "Global" },
  { keys: "⌘ T", desc: "Open new terminal", section: "Global" },
  { keys: "⌘ Shift B", desc: "Open App Builder", section: "Global" },
  { keys: "⌘ Shift D", desc: "Run demo tour (4 apps auto)", section: "Global" },
  { keys: "⌘ R", desc: "Refresh focused window", section: "Window" },
  { keys: "Drag title bar", desc: "Move window", section: "Window" },
  { keys: "Double-click title", desc: "Toggle maximize", section: "Window" },
  { keys: "Drag to edge", desc: "Snap left / right half", section: "Window" },
  { keys: "Right-click desktop", desc: "Context menu (new terminal · wallpaper · refresh all)", section: "Desktop" },
  { keys: "Enter", desc: "Run mission in Terminal · build in App Builder", section: "Apps" },
  { keys: "WASD / arrows", desc: "Snake game", section: "Games" },
  { keys: "Click", desc: "Tic-Tac-Toe · Memory Match", section: "Games" },
];

export function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const sections = [...new Set(SHORTCUTS.map((s) => s.section))];
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[9100] flex items-center justify-center p-6"
          style={{ background: "var(--overlay)", backdropFilter: "blur(6px)" }}
          onMouseDown={onClose}
        >
          <motion.div
            initial={{ y: -12, opacity: 0, scale: 0.95 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -12, opacity: 0, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 340, damping: 26 }}
            onMouseDown={(e) => e.stopPropagation()}
            className="card-pixel w-[92vw] max-w-2xl"
            style={{ padding: 0, borderColor: "var(--accent)", boxShadow: "0 0 0 2px var(--bg), 0 0 0 4px var(--accent), 8px 8px 0 0 #0a0a14" }}
          >
            <div className="flex items-center justify-between p-3 border-b-2 border-[color:var(--surface-2)]" style={{ background: "var(--accent)", color: "var(--surface)" }}>
              <div className="flex items-center gap-2">
                <Icons.Keyboard size={16} />
                <span className="font-pixel text-sm tracking-wider">KEYBOARD SHORTCUTS</span>
              </div>
              <button onClick={onClose} className="font-pixel text-sm" style={{ color: "var(--surface)" }}>×</button>
            </div>
            <div className="p-4 max-h-[70vh] overflow-y-auto space-y-4">
              {sections.map((sec) => (
                <div key={sec}>
                  <h3 className="font-pixel text-[11px] tracking-widest mb-2" style={{ color: "var(--accent)" }}>{sec.toUpperCase()}</h3>
                  <ul className="space-y-1">
                    {SHORTCUTS.filter((s) => s.section === sec).map((s) => (
                      <li key={s.keys} className="flex items-center justify-between gap-3 text-xs">
                        <span className="text-[color:var(--muted)] flex-1">{s.desc}</span>
                        <code
                          className="font-mono text-[11px] px-2 py-0.5"
                          style={{ background: "var(--bg)", color: "var(--accent)", border: "1px solid var(--surface-2)" }}
                        >
                          {s.keys}
                        </code>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className="p-3 border-t-2 border-[color:var(--surface-2)] flex items-center justify-between text-[10px] font-mono text-[color:var(--muted)]">
              <span>Esc to close · {SHORTCUTS.length} shortcuts</span>
              <span>v2.0</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
