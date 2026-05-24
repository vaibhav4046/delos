"use client";
import { useRef, useState, useCallback, useLayoutEffect, useEffect } from "react";
import * as Icons from "lucide-react";
import {
  ClaudeIcon, ChatGPTIcon, PerplexityIcon,
  DelAssistantSleek, IdentitySleek, IngestSleek, CohortSleek,
  CoresSleek, ArenaSleek, BuilderSleek, TerminalSleek, MissionSleek,
} from "@/components/BrandIcons";

// Sleek custom SVGs override lucide for the killer apps — hand-tuned
// strokeWidth 1.75 + brand-aligned glyphs feel premium vs generic lucide.
const BRAND_ICONS: Record<string, React.ComponentType<{ size?: number; color?: string }>> = {
  claude: ClaudeIcon,
  chatgpt: ChatGPTIcon,
  perplexity: PerplexityIcon,
  assistant: DelAssistantSleek,
  identity: IdentitySleek,
  ingest: IngestSleek,
  cohort: CohortSleek,
  cores: CoresSleek,
  arena: ArenaSleek,
  builder: BuilderSleek,
  terminal: TerminalSleek,
  mission: MissionSleek,
};

type DockApp = {
  id: string;
  label: string;
  icon: string;
};

export function Dock({
  order,
  apps,
  openIds,
  focusedId,
  onLaunch,
  onClose,
  onMinimize,
  autoHide = true,
}: {
  order: string[];
  apps: Record<string, DockApp>;
  openIds: string[];
  focusedId?: string | null;
  onLaunch: (key: string) => void;
  // Optional handlers — older callers still work; passing them unlocks right-click +
  // hover-X close so users aren't trapped with an open window they can't dismiss.
  onClose?: (id: string) => void;
  onMinimize?: (id: string) => void;
  // When true, dock slides offscreen if cursor is far from bottom edge.
  // Disabled on Welcome mat / when no windows are open so first-time users
  // see the app row immediately.
  autoHide?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [mx, setMx] = useState<number | null>(null);
  const [bouncing, setBouncing] = useState<string | null>(null);
  const [scrollW, setScrollW] = useState(0);
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  // Dock visible by default; auto-hides into bottom edge when cursor is far away
  // and at least one window is open. Hover the bottom 80px strip to reveal.
  const [revealed, setRevealed] = useState(true);
  const revealLockRef = useRef(false);

  const All = Icons as unknown as Record<string, React.ComponentType<{ size?: number; color?: string }>>;
  const open = new Set(openIds);

  // Magnification params
  const BASE_SIZE = 24;
  const MAX_BOOST = 22;
  const SIGMA = 56;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setScrollW(el.scrollWidth);
    const ro = new ResizeObserver(() => setScrollW(el.scrollWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [order.length]);

  // Dismiss context menu on outside click / Esc
  useEffect(() => {
    if (!menu) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as HTMLElement;
      if (t.closest?.("[data-dock-menu]")) return;
      setMenu(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenu(null);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const onMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setMx(e.clientX - rect.left);
  }, []);

  const onLeave = useCallback(() => setMx(null), []);

  // Global pointer watcher · reveals dock when cursor enters the bottom 96px
  // reveal-strip. Throttles to rAF so movement stays cheap on slow machines.
  // When autoHide is false (welcome mat, no windows) dock stays revealed.
  useEffect(() => {
    if (!autoHide) { setRevealed(true); return; }
    let raf = 0;
    let lastY = 9999;
    const onPointer = (e: PointerEvent) => {
      lastY = e.clientY;
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        const vh = window.innerHeight;
        const inStrip = lastY >= vh - 96;
        // Sticky reveal · once revealed, stay revealed until cursor leaves a
        // larger 128px exit-strip. Prevents flicker at the seam.
        setRevealed((prev) => (prev ? lastY >= vh - 128 : inStrip));
      });
    };
    const onKey = (e: KeyboardEvent) => {
      // ⌘D · toggle dock pin · power-user override
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        revealLockRef.current = !revealLockRef.current;
        setRevealed(revealLockRef.current ? true : revealed);
      }
    };
    window.addEventListener("pointermove", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("keydown", onKey);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [autoHide, revealed]);

  function handleClick(key: string, app: DockApp) {
    setBouncing(key);
    setTimeout(() => setBouncing(null), 520);
    // Smart click: if the window is open AND focused → minimize; otherwise launch
    // (which also brings to front + un-minimizes existing instances).
    if (open.has(app.id) && focusedId === app.id && onMinimize) {
      onMinimize(app.id);
      return;
    }
    onLaunch(key);
  }

  function handleContext(e: React.MouseEvent, key: string) {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ key, x: e.clientX, y: e.clientY });
  }

  // Slide dock fully offscreen when hidden · 24px peek-strip lets the user
  // remember it's there. cubic-bezier ease-out feels like a real OS, not CSS.
  const hidden = !revealed;
  const dockTranslate = hidden ? "translate3d(0, calc(100% - 6px), 0)" : "translate3d(0, 0, 0)";

  return (
    <footer
      className="absolute bottom-0 left-0 right-0 z-[100] flex items-end justify-center px-2 sm:px-4 py-2 sm:py-3 pointer-events-none"
      style={{
        background: "transparent",
        transform: dockTranslate,
        transition: "transform 280ms cubic-bezier(0.32, 0.72, 0, 1)",
        willChange: "transform",
      }}
    >
      <div
        ref={ref}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        onMouseEnter={() => setRevealed(true)}
        data-app-dock
        className="flex items-end gap-1 sm:gap-2 px-3 sm:px-4 py-2 sm:py-3 overflow-x-auto pointer-events-auto max-w-[calc(100vw-1rem)]"
        style={{
          background: "rgba(var(--bg-rgb), 0.88)",
          border: "2px solid var(--surface-2)",
          borderBottom: "none",
          backdropFilter: "blur(14px) saturate(170%)",
          WebkitBackdropFilter: "blur(14px) saturate(170%)",
          boxShadow: "0 -2px 0 var(--bg), 0 -4px 0 var(--surface-2), 0 -6px 16px var(--shadow)",
          scrollbarWidth: "thin",
        }}
      >
        {order.map((key, i) => {
          const app = apps[key];
          if (!app) return null;
          const Cmp = BRAND_ICONS[key] ?? All[app.icon] ?? All.Box;
          const isOpen = open.has(app.id);
          const isFocused = focusedId === app.id;
          const isBouncing = bouncing === key;
          let size = BASE_SIZE;
          let lift = 0;
          if (mx != null && scrollW > 0) {
            const iconSlot = scrollW / order.length;
            const center = iconSlot * (i + 0.5);
            const dx = Math.abs(center - mx);
            const w = Math.exp(-(dx * dx) / (2 * SIGMA * SIGMA));
            size = BASE_SIZE + MAX_BOOST * w;
            lift = -10 * w;
          }
          const pad = Math.round(8 + (size - BASE_SIZE) * 0.4);
          return (
            <div key={key} className="relative group flex-shrink-0">
              <button
                onClick={() => handleClick(key, app)}
                onContextMenu={(e) => handleContext(e, key)}
                className="dock-icon"
                aria-label={isOpen ? `Toggle ${app.label} · right-click for options` : `Launch ${app.label}`}
                title={isOpen ? `${app.label} · click to minimize · right-click to close` : app.label}
                style={{
                  padding: pad,
                  background: isFocused ? "var(--accent)" : isOpen ? "var(--surface-2)" : "var(--surface)",
                  border: `2px solid ${isFocused ? "var(--accent)" : isOpen ? "var(--accent)" : "var(--surface-2)"}`,
                  transform: `translateY(${lift}px)${isBouncing ? " scale(1.18)" : ""}`,
                  transition: "transform 140ms cubic-bezier(0.34, 1.56, 0.64, 1), background 200ms, border-color 200ms, padding 140ms",
                  cursor: "pointer",
                  boxShadow: isOpen
                    ? "0 0 0 1px var(--bg), 0 0 0 2px var(--accent), 3px 3px 0 var(--shadow)"
                    : "0 0 0 1px var(--bg), 3px 3px 0 var(--shadow)",
                }}
              >
                <Cmp size={Math.round(size)} color={isFocused ? "var(--on-accent)" : "var(--accent)"} />
              </button>

              {/* Hover-only close × on open apps. Stops propagation so it doesn't toggle. */}
              {isOpen && onClose && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(app.id);
                  }}
                  className="absolute -top-1 -right-1 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{
                    width: 16,
                    height: 16,
                    background: "var(--danger)",
                    color: "var(--on-accent, #fff)",
                    border: "1px solid var(--bg)",
                    boxShadow: "1px 1px 0 var(--shadow)",
                    fontSize: 11,
                    lineHeight: 1,
                    fontWeight: 700,
                    cursor: "pointer",
                    padding: 0,
                  }}
                  aria-label={`Close ${app.label}`}
                  title={`Close ${app.label}`}
                >
                  ×
                </button>
              )}

              {/* Running indicator dot. */}
              {isOpen && (
                <span
                  className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 accent-pulse"
                  style={{
                    width: isFocused ? 8 : 6,
                    height: isFocused ? 8 : 6,
                    background: isFocused ? "var(--success)" : "var(--accent)",
                    borderRadius: 0,
                  }}
                />
              )}

              {/* Hover tooltip */}
              <span
                className="absolute -top-9 left-1/2 -translate-x-1/2 px-2 py-1 text-[10px] font-pixel tracking-wider opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap"
                style={{
                  background: "var(--surface)",
                  color: "var(--fg)",
                  border: "1px solid var(--accent)",
                  boxShadow: "2px 2px 0 var(--shadow)",
                }}
              >
                {app.label.toUpperCase()}
              </span>
            </div>
          );
        })}
      </div>

      {/* Right-click context menu */}
      {menu && (() => {
        const app = apps[menu.key];
        if (!app) return null;
        const isOpen = open.has(app.id);
        return (
          <div
            data-dock-menu
            className="fixed z-[110] pointer-events-auto"
            style={{
              left: Math.min(menu.x, (typeof window !== "undefined" ? window.innerWidth : 1920) - 200),
              top: Math.max(menu.y - 140, 8),
              background: "var(--surface)",
              border: "2px solid var(--accent)",
              boxShadow: "4px 4px 0 var(--shadow), 0 0 24px var(--ring)",
              minWidth: 180,
            }}
          >
            <div
              className="px-3 py-2 font-pixel text-[10px] tracking-widest"
              style={{ color: "var(--accent)", borderBottom: "1px solid var(--surface-2)" }}
            >
              ★ {app.label.toUpperCase()}
            </div>
            <DockMenuItem
              label={isOpen ? "Bring to front" : "Launch"}
              icon="▶"
              onClick={() => {
                onLaunch(menu.key);
                setMenu(null);
              }}
            />
            {isOpen && onMinimize && (
              <DockMenuItem
                label="Minimize"
                icon="—"
                onClick={() => {
                  onMinimize(app.id);
                  setMenu(null);
                }}
              />
            )}
            {isOpen && onClose && (
              <DockMenuItem
                label="Close"
                icon="×"
                danger
                onClick={() => {
                  onClose(app.id);
                  setMenu(null);
                }}
              />
            )}
          </div>
        );
      })()}
    </footer>
  );
}

function DockMenuItem({
  label,
  icon,
  danger,
  onClick,
}: {
  label: string;
  icon: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2 font-mono text-xs flex items-center gap-2 hover:bg-[color:var(--surface-2)]"
      style={{
        color: danger ? "var(--danger)" : "var(--fg)",
        cursor: "pointer",
        border: "none",
        background: "transparent",
      }}
    >
      <span style={{ width: 12, display: "inline-block", textAlign: "center" }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}
