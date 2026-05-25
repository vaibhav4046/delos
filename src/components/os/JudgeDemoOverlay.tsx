"use client";
// Fullscreen narration overlay for the one minute judge demo.
//
// Listens on the window event bus for `delos-judge-card` events emitted
// by `runJudgeDemo`. Renders a centered card with the current step
// index, a short eyebrow label, a one sentence explainer, a live timer,
// and a progress bar that fills to JUDGE_DEMO_TOTAL_MS. The card uses
// pointer events none so the OS underneath stays interactive while the
// demo plays. Press Esc to cancel.

import { useEffect, useRef, useState } from "react";
import { JUDGE_DEMO_TOTAL_MS, type JudgeOverlayCard } from "@/lib/demo/judgeScript";

export function JudgeDemoOverlay({ onCancel }: { onCancel?: () => void }) {
  const [card, setCard] = useState<JudgeOverlayCard | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    function onCard(e: Event) {
      const detail = (e as CustomEvent<JudgeOverlayCard | null>).detail;
      setCard(detail);
      if (detail) {
        if (startRef.current === null) startRef.current = performance.now();
      } else {
        startRef.current = null;
        setElapsedMs(0);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && card) {
        window.dispatchEvent(new CustomEvent("delos-judge-cancel"));
        onCancel?.();
      }
    }
    window.addEventListener("delos-judge-card", onCard as EventListener);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("delos-judge-card", onCard as EventListener);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card]);

  useEffect(() => {
    function tick() {
      if (startRef.current !== null) {
        setElapsedMs(Math.min(JUDGE_DEMO_TOTAL_MS, performance.now() - startRef.current));
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  if (!card) return null;
  const pct = Math.min(100, (elapsedMs / JUDGE_DEMO_TOTAL_MS) * 100);
  const remaining = Math.max(0, JUDGE_DEMO_TOTAL_MS - elapsedMs);
  const remainingSec = (remaining / 1000).toFixed(1);

  return (
    <div
      aria-live="polite"
      role="status"
      className="fixed left-1/2 -translate-x-1/2 z-[1000]"
      style={{
        bottom: 96,
        width: 480,
        maxWidth: "calc(100vw - 24px)",
        pointerEvents: "none",
        userSelect: "none",
      }}
    >
      <div
        style={{
          background: "rgba(10, 8, 22, 0.92)",
          border: "2px solid var(--accent)",
          boxShadow: "0 14px 40px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,211,0,0.12) inset",
          padding: "14px 16px 16px",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
        }}
      >
        <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
          <div className="flex items-center gap-2">
            <span
              className="font-pixel"
              style={{
                fontSize: 10,
                padding: "2px 8px",
                background: "var(--accent)",
                color: "var(--on-accent)",
                letterSpacing: "0.18em",
              }}
            >
              {card.label}
            </span>
            <span className="font-mono" style={{ fontSize: 10, color: "var(--muted)" }}>
              step {card.index} of {card.total}
            </span>
          </div>
          <div className="flex items-center gap-2 font-mono" style={{ fontSize: 10, color: "var(--muted)" }}>
            <span>{remainingSec}s</span>
            <span style={{ color: "var(--muted)" }}>esc to stop</span>
          </div>
        </div>
        <div
          className="font-pixel"
          style={{ fontSize: 12, color: "var(--fg)", letterSpacing: "0.04em", marginBottom: 6 }}
        >
          NOW DOING
        </div>
        <div
          style={{
            fontSize: 13,
            lineHeight: 1.55,
            color: "var(--fg)",
            fontFamily: "var(--font-sans, ui-sans-serif), system-ui, sans-serif",
          }}
        >
          {card.explainer}
        </div>
        <div
          style={{
            position: "relative",
            marginTop: 12,
            height: 4,
            background: "rgba(255,255,255,0.08)",
            borderRadius: 0,
            overflow: "hidden",
          }}
          aria-label={`progress ${pct.toFixed(0)} percent`}
        >
          <div
            style={{
              position: "absolute",
              inset: "0 auto 0 0",
              width: `${pct}%`,
              background: "linear-gradient(90deg, var(--accent), #ffdc4a)",
              transition: "width 80ms linear",
            }}
          />
        </div>
      </div>
    </div>
  );
}
