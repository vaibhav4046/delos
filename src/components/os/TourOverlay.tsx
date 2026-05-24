"use client";
import { useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";

// 7-step guided tour for judges.
// Mount on /os when ?tour=1 OR delrio_tour cookie set.

type Step = {
  selector: string;
  title: string;
  body: string;
};

const STEPS: Step[] = [
  {
    selector: "[data-tour=\"hero\"]",
    title: "Welcome to DelOS",
    body: "Browser-OS where multi-agent orchestration is wired in by default. Memory · Tools · Recovery · Adaptation, all visible.",
  },
  {
    selector: "[data-counter-strip]",
    title: "Live cost meter",
    body: "Agents · requests · tokens · USD spent — increments in real time as you run missions. Antigravity-style.",
  },
  {
    selector: "[data-tour=\"dock\"]",
    title: "24 apps in the dock",
    body: "Terminal · Assistant · Cohort · Arena · Voice · Del Doom · Builder · Memory · Cowork · and more. macOS-style magnification.",
  },
  {
    selector: "[data-tour=\"demo-button\"]",
    title: "Demo tour shortcut",
    body: "Click ▶ DEMO in the header (or ⌘ Shift D) to auto-launch Terminal → Mission Control → Cohort in sequence.",
  },
  {
    selector: "[data-tour=\"agent-pulse\"]",
    title: "Multi-agent constellation",
    body: "Planner · Executor · Critic · Tooler · Memory — five sub-agents, always visible. Dots pulse when active.",
  },
  {
    selector: "[data-tour=\"hydradb\"]",
    title: "HydraDB save-state",
    body: "Every run reads and writes graph-shaped memory. Cross-device via tenant ID. Visit /memory to see the graph.",
  },
  {
    selector: "[data-tour=\"exit\"]",
    title: "You're ready",
    body: "Try /play for chaos demos. /arena for 3-model races. /scorecard for the full feature map. /run/[id] to replay any run.",
  },
];

const STORAGE_KEY = "delos.tour.step";

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export function TourOverlay() {
  const sp = useSearchParams();
  const wantTour = sp.get("tour") === "1" || getCookie("delrio_tour") === "1";
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);

  // Activate on mount if tour requested
  useEffect(() => {
    if (!wantTour) return;
    const dismissed = sessionStorage.getItem("delos.tour.dismissed");
    if (dismissed) return;
    const saved = Number(sessionStorage.getItem(STORAGE_KEY) ?? "0");
    setStep(Math.max(0, Math.min(STEPS.length - 1, saved)));
    // Tiny delay so /os DOM mounts targets
    const t = setTimeout(() => setActive(true), 600);
    return () => clearTimeout(t);
  }, [wantTour]);

  // Track target rect
  useEffect(() => {
    if (!active) return;
    function tick() {
      const el = document.querySelector(STEPS[step].selector) as HTMLElement | null;
      if (el) {
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
        // Scroll into view if needed
        if (r.top < 0 || r.bottom > window.innerHeight) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      } else {
        setRect(null);
      }
    }
    tick();
    const id = setInterval(tick, 600);
    window.addEventListener("resize", tick);
    return () => {
      clearInterval(id);
      window.removeEventListener("resize", tick);
    };
  }, [active, step]);

  function next() {
    if (step < STEPS.length - 1) {
      const ns = step + 1;
      setStep(ns);
      sessionStorage.setItem(STORAGE_KEY, String(ns));
    } else {
      dismiss();
    }
  }

  function prev() {
    if (step > 0) {
      const ns = step - 1;
      setStep(ns);
      sessionStorage.setItem(STORAGE_KEY, String(ns));
    }
  }

  function dismiss() {
    setActive(false);
    sessionStorage.setItem("delos.tour.dismissed", "1");
  }

  if (!active) return null;
  const s = STEPS[step];

  // Compute tip position — try below target, flip to above if no room
  const pad = 12;
  let tipTop = (rect?.top ?? 200) + (rect?.height ?? 0) + pad;
  const tipHeight = 180;
  if (tipTop + tipHeight > window.innerHeight - 20) {
    tipTop = Math.max(20, (rect?.top ?? 200) - tipHeight - pad);
  }
  const tipLeft = Math.max(16, Math.min(window.innerWidth - 360, (rect?.left ?? window.innerWidth / 2) - 160));

  return (
    <div
      data-tour-overlay
      className="fixed inset-0 z-[9500] pointer-events-none"
    >
      {/* Backdrop with spotlight cutout via SVG mask */}
      <svg className="absolute inset-0 w-full h-full pointer-events-auto" onClick={dismiss}>
        <defs>
          <mask id="tour-spotlight">
            <rect width="100%" height="100%" fill="white" />
            {rect && (
              <rect
                x={rect.left - 6}
                y={rect.top - 6}
                width={rect.width + 12}
                height={rect.height + 12}
                fill="black"
                rx={6}
              />
            )}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.72)" mask="url(#tour-spotlight)" />
        {rect && (
          <rect
            x={rect.left - 6}
            y={rect.top - 6}
            width={rect.width + 12}
            height={rect.height + 12}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="3"
            strokeDasharray="6 4"
            rx={6}
            style={{ filter: "drop-shadow(0 0 8px var(--accent))" }}
          />
        )}
      </svg>

      {/* Tooltip card */}
      <div
        ref={tipRef}
        data-tour-step={step}
        className="absolute card-pixel pointer-events-auto"
        style={{
          top: tipTop,
          left: tipLeft,
          width: 340,
          maxWidth: "calc(100vw - 32px)",
          background: "var(--surface)",
          borderColor: "var(--accent)",
          padding: 16,
          boxShadow: "0 0 0 2px var(--bg), 0 0 0 4px var(--accent), 8px 8px 0 var(--shadow)",
          zIndex: 9501,
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="font-pixel text-[10px] tracking-widest" style={{ color: "var(--accent)" }}>
            ★ TOUR · STEP {step + 1}/{STEPS.length}
          </span>
          <button
            onClick={dismiss}
            className="font-pixel text-xs"
            style={{ color: "var(--muted)", cursor: "pointer", background: "transparent", border: "none" }}
            aria-label="Skip tour"
          >
            skip all ×
          </button>
        </div>
        <h3 className="font-pixel text-base sm:text-lg tracking-wider mb-2" style={{ color: "var(--fg)" }}>
          {s.title}
        </h3>
        <p className="font-mono text-[11px] leading-relaxed mb-3" style={{ color: "var(--muted)" }}>
          {s.body}
        </p>
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={prev}
            disabled={step === 0}
            className="btn-pixel ghost"
            style={{ padding: "4px 10px", fontSize: 11, opacity: step === 0 ? 0.4 : 1, cursor: step === 0 ? "not-allowed" : "pointer" }}
          >
            ← BACK
          </button>
          <div className="flex gap-1">
            {STEPS.map((_, i) => (
              <span
                key={i}
                style={{
                  width: 6,
                  height: 6,
                  background: i === step ? "var(--accent)" : "var(--surface-2)",
                  display: "inline-block",
                }}
              />
            ))}
          </div>
          <button onClick={next} className="btn-pixel success" style={{ padding: "4px 10px", fontSize: 11 }}>
            {step === STEPS.length - 1 ? "FINISH" : "NEXT →"}
          </button>
        </div>
      </div>
    </div>
  );
}
