"use client";
import { AnimatePresence, motion } from "framer-motion";

export type ToastItem = { id: string; text: string; tone?: "info" | "ok" | "warn" | "bad" };

export function ToastStack({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: string) => void }) {
  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2" style={{ pointerEvents: "none" }}>
      <AnimatePresence>
        {items.map((t) => {
          const cls = t.tone === "ok" ? "pill-ok" : t.tone === "warn" ? "pill-warn" : t.tone === "bad" ? "pill-bad" : "pill-info";
          return (
            <motion.div
              key={t.id}
              initial={{ x: 60, opacity: 0, scale: 0.85 }}
              animate={{ x: 0, opacity: 1, scale: 1 }}
              exit={{ x: 60, opacity: 0, scale: 0.7 }}
              transition={{ type: "spring", stiffness: 360, damping: 26 }}
              className={`card-pixel flex items-center gap-2 pr-3 pl-2 py-1.5 ${cls}`}
              style={{ pointerEvents: "auto" }}
              onClick={() => onDismiss(t.id)}
            >
              <span className="coin" />
              <span className="font-mono text-sm" style={{ color: "var(--fg)" }}>{t.text}</span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
