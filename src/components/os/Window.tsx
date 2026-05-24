"use client";
import { useRef, useState, useEffect } from "react";
import * as Icons from "lucide-react";
import { motion, useDragControls } from "framer-motion";
import { AppErrorBoundary } from "./ErrorBoundary";

// Snap targets — half-screen edges, quarter-screen corners, full top/bottom.
// Wired up to Win+arrow shortcuts and drag-to-edge detection.
export type SnapKind = "L" | "R" | "T" | "B" | "TL" | "TR" | "BL" | "BR" | "FULL";

export type WindowChild = {
  id: string;
  title: string;
  icon?: string;
  width: number;
  height: number;
  x: number;
  y: number;
  z: number;
  minimized?: boolean;
  content: React.ReactNode;
};

type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export function Window({
  win,
  focused,
  onFocus,
  onClose,
  onMinimize,
  onMaximize,
  onRefresh,
  onSnap,
  onResize,
  onDragEnd,
  bounds,
  maximized,
}: {
  win: WindowChild;
  focused: boolean;
  onFocus: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onMaximize: () => void;
  onRefresh: () => void;
  onSnap: (side: SnapKind) => void;
  onResize?: (rect: { x: number; y: number; width: number; height: number }) => void;
  onDragEnd: (x: number, y: number) => void;
  bounds: { width: number; height: number };
  maximized?: boolean;
}) {
  const constraintRef = useRef<HTMLDivElement | null>(null);
  const dragControls = useDragControls();
  const All = Icons as unknown as Record<string, React.ComponentType<{ size?: number; color?: string }>>;
  const iconName = (win.icon ?? "Box").charAt(0).toUpperCase() + (win.icon ?? "Box").slice(1);
  const IconCmp = All[iconName] ?? Icons.Box;
  const [phase, setPhase] = useState<"open" | "shown" | "closing">("open");
  const [snapMenuOpen, setSnapMenuOpen] = useState(false);
  const [resizing, setResizing] = useState(false);
  const snapHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setPhase("shown"), 250);
    return () => clearTimeout(t);
  }, []);

  function handleClose() {
    setPhase("closing");
    setTimeout(onClose, 180);
  }

  // Drag-resize from any of the 8 edges. Tracks start pointer + rect, updates
  // x/y/w/h on pointermove. Top/left edges adjust origin AND size simultaneously
  // so the opposite corner stays anchored (real OS behavior).
  function startResize(edge: ResizeEdge, e: React.PointerEvent) {
    if (maximized) return;
    e.preventDefault();
    e.stopPropagation();
    onFocus();
    const startX = e.clientX;
    const startY = e.clientY;
    const startRect = { x: win.x, y: win.y, width: win.width, height: win.height };
    const minW = 280;
    const minH = 200;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture?.(e.pointerId);
    setResizing(true);
    // rAF-throttle the pointermove → onResize chain. Without this each native
    // mousemove event triggers a React setState + reconcile + motion animate,
    // which feels chunky on 60Hz panels and visibly stutters on 120Hz.
    let raf = 0;
    let latest: { x: number; y: number; width: number; height: number } | null = null;
    const flush = () => {
      raf = 0;
      if (latest) onResize?.(latest);
    };

    function onMove(ev: PointerEvent) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      let { x, y, width, height } = startRect;
      if (edge.includes("e")) width = Math.max(minW, startRect.width + dx);
      if (edge.includes("s")) height = Math.max(minH, startRect.height + dy);
      if (edge.includes("w")) {
        const newW = Math.max(minW, startRect.width - dx);
        x = startRect.x + (startRect.width - newW);
        width = newW;
      }
      if (edge.includes("n")) {
        const newH = Math.max(minH, startRect.height - dy);
        y = Math.max(48, startRect.y + (startRect.height - newH));
        height = newH;
      }
      // Clamp to viewport
      if (x + width > bounds.width) width = bounds.width - x;
      if (y + height > bounds.height - 56) height = bounds.height - 56 - y;
      latest = { x, y, width, height };
      if (!raf) raf = window.requestAnimationFrame(flush);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (raf) window.cancelAnimationFrame(raf);
      if (latest) onResize?.(latest); // commit final frame
      setResizing(false);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function openSnapMenu() {
    if (snapHoverTimerRef.current) clearTimeout(snapHoverTimerRef.current);
    setSnapMenuOpen(true);
  }
  function delayedCloseSnapMenu() {
    if (snapHoverTimerRef.current) clearTimeout(snapHoverTimerRef.current);
    snapHoverTimerRef.current = setTimeout(() => setSnapMenuOpen(false), 250);
  }

  const targetX = maximized ? 0 : win.x;
  const targetY = maximized ? 48 : win.y;
  const targetW = maximized ? bounds.width : win.width;
  // Reserve top bar (48px) + dock + dock-magnification headroom (~104px total)
  // so maximized windows never hide their own bottom controls (chat input, send)
  // behind the dock. Was 56 — Del Assistant input was clipped at 1440x900.
  const targetH = maximized ? bounds.height - 48 - 104 : win.height;

  return (
    <>
      <div ref={constraintRef} className="absolute pointer-events-none" style={{ inset: 0, width: bounds.width, height: bounds.height }} />
      <motion.div
        drag={!maximized}
        dragControls={dragControls}
        dragListener={false}
        dragMomentum={false}
        dragConstraints={constraintRef}
        initial={{ x: win.x, y: win.y, scale: 0.7, opacity: 0 }}
        animate={
          phase === "closing"
            ? { x: targetX, y: targetY, scale: 0.6, opacity: 0 }
            : { x: targetX, y: targetY, scale: 1, opacity: 1, width: targetW, height: targetH }
        }
        transition={resizing ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 30, mass: 0.5 }}
        onDragEnd={(_, info) => {
          if (maximized) return;
          const nx = win.x + info.offset.x;
          const ny = win.y + info.offset.y;
          // Edge-snap detection — Aero-style 8 zones:
          //   top-edge → FULL maximize · bottom strip → minimize-style stay
          //   left/right edge → half · within ~25% corner → quarter snap
          const cornerY = bounds.height * 0.28;
          const cornerYBot = bounds.height * 0.72;
          const leftEdge = nx <= 8;
          const rightEdge = nx + win.width >= bounds.width - 8;
          const topEdge = ny <= 56; // below top bar
          if (topEdge && !leftEdge && !rightEdge) onSnap("FULL");
          else if (leftEdge && ny < cornerY) onSnap("TL");
          else if (leftEdge && ny > cornerYBot) onSnap("BL");
          else if (rightEdge && ny < cornerY) onSnap("TR");
          else if (rightEdge && ny > cornerYBot) onSnap("BR");
          else if (leftEdge) onSnap("L");
          else if (rightEdge) onSnap("R");
          else onDragEnd(nx, ny);
        }}
        onMouseDown={onFocus}
        style={{
          position: "absolute",
          width: targetW,
          height: targetH,
          zIndex: win.z,
          display: win.minimized ? "none" : "flex",
          flexDirection: "column",
          background: "var(--surface)",
          border: `2px solid ${focused ? "var(--accent)" : "var(--surface-2)"}`,
          boxShadow: focused
            ? "0 0 0 2px var(--bg), 0 0 0 4px var(--accent), 8px 8px 0 0 var(--shadow)"
            : "0 0 0 2px var(--bg), 0 0 0 4px var(--surface-2), 6px 6px 0 0 var(--shadow)",
          // Hint the compositor — drag/resize is the only time these change.
          // Without this Chrome promotes layers reactively, which adds a frame
          // of lag at drag start. With it, layer exists upfront → instant feel.
          willChange: "transform, width, height",
        }}
      >
        <div
          onPointerDown={(e) => !maximized && dragControls.start(e)}
          onDoubleClick={onMaximize}
          className={`flex items-center justify-between px-3 py-2 select-none ${focused ? "window-title-premium" : ""} ${maximized ? "cursor-default" : "cursor-grab active:cursor-grabbing"}`}
          style={{ background: focused ? undefined : "var(--surface-2)", color: focused ? "var(--on-accent)" : "var(--fg)" }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <IconCmp size={14} color="currentColor" />
            <span className="font-pixel text-sm tracking-wider truncate">{win.title.toUpperCase()}</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={onRefresh} className="w-5 h-5 flex items-center justify-center hover:bg-black/20" aria-label="Refresh" title="Refresh">
              <Icons.RotateCw size={11} color="currentColor" />
            </button>
            <button onClick={onMinimize} className="w-5 h-5 flex items-center justify-center hover:bg-black/20" aria-label="Minimize" title="Minimize">
              <Icons.Minus size={12} color="currentColor" />
            </button>
            <div
              className="relative"
              onMouseEnter={openSnapMenu}
              onMouseLeave={delayedCloseSnapMenu}
            >
              <button
                onClick={onMaximize}
                className="w-5 h-5 flex items-center justify-center hover:bg-black/20"
                aria-label="Maximize"
                title="Maximize · hover for snap layouts"
              >
                {maximized ? <Icons.Minimize2 size={11} color="currentColor" /> : <Icons.Maximize2 size={11} color="currentColor" />}
              </button>
              {snapMenuOpen && !maximized && (
                <SnapLayoutsMenu
                  onPick={(k) => { onSnap(k); setSnapMenuOpen(false); }}
                  onClose={() => setSnapMenuOpen(false)}
                />
              )}
            </div>
            <button onClick={handleClose} className="w-5 h-5 flex items-center justify-center hover:bg-[color:var(--danger)]" aria-label="Close" title="Close (Esc)">
              <Icons.X size={12} color="currentColor" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto" style={{ background: "var(--surface)" }}>
          <AppErrorBoundary appName={win.title}>{win.content}</AppErrorBoundary>
        </div>

        {/* Resize handles — only when not maximized. Use very thin hit regions
            along each edge + 12×12 corners. cursor + pointerdown wired in. */}
        {!maximized && onResize && (
          <>
            <ResizeHandle edge="n"  onDown={startResize} style={{ top: 0, left: 8, right: 8, height: 6 }} />
            <ResizeHandle edge="s"  onDown={startResize} style={{ bottom: 0, left: 8, right: 8, height: 6 }} />
            <ResizeHandle edge="e"  onDown={startResize} style={{ right: 0, top: 8, bottom: 8, width: 6 }} />
            <ResizeHandle edge="w"  onDown={startResize} style={{ left: 0, top: 8, bottom: 8, width: 6 }} />
            <ResizeHandle edge="ne" onDown={startResize} style={{ top: 0, right: 0, width: 12, height: 12 }} />
            <ResizeHandle edge="nw" onDown={startResize} style={{ top: 0, left: 0, width: 12, height: 12 }} />
            <ResizeHandle edge="se" onDown={startResize} style={{ bottom: 0, right: 0, width: 14, height: 14 }} grip />
            <ResizeHandle edge="sw" onDown={startResize} style={{ bottom: 0, left: 0, width: 12, height: 12 }} />
          </>
        )}
      </motion.div>
    </>
  );
}

const CURSORS: Record<ResizeEdge, string> = {
  n: "ns-resize", s: "ns-resize",
  e: "ew-resize", w: "ew-resize",
  ne: "nesw-resize", sw: "nesw-resize",
  nw: "nwse-resize", se: "nwse-resize",
};

function ResizeHandle({
  edge,
  onDown,
  style,
  grip,
}: {
  edge: ResizeEdge;
  onDown: (edge: ResizeEdge, e: React.PointerEvent) => void;
  style: React.CSSProperties;
  grip?: boolean;
}) {
  return (
    <div
      onPointerDown={(e) => onDown(edge, e)}
      style={{
        position: "absolute",
        cursor: CURSORS[edge],
        zIndex: 5,
        ...style,
      }}
      aria-label={`Resize ${edge}`}
    >
      {grip && (
        <svg width="14" height="14" viewBox="0 0 14 14" style={{ position: "absolute", right: 1, bottom: 1, opacity: 0.45 }}>
          <path d="M 13 7 L 7 13 M 13 11 L 11 13 M 13 3 L 3 13" stroke="currentColor" strokeWidth="1.2" fill="none" />
        </svg>
      )}
    </div>
  );
}

// Windows-11 style "Snap Layouts" popover. Shows 6 layout previews.
// Hover the maximize button to reveal; pick a layout to apply.
function SnapLayoutsMenu({
  onPick,
  onClose,
}: {
  onPick: (kind: SnapKind) => void;
  onClose: () => void;
}) {
  // Each item is a layout preview drawn with CSS grid. Click handler maps to
  // a SnapKind. The "2x2 grid" + "cascade" entries dispatch a custom event so
  // page.tsx can run the global gridArrange / cascadeArrange.
  type Layout = { kind: SnapKind | "GRID" | "CASCADE"; label: string; cells: Array<{ row: string; col: string }> };
  const layouts: Layout[] = [
    { kind: "FULL", label: "Maximize",       cells: [{ row: "1 / 3", col: "1 / 3" }] },
    { kind: "L",    label: "Left half",      cells: [{ row: "1 / 3", col: "1 / 2" }] },
    { kind: "R",    label: "Right half",     cells: [{ row: "1 / 3", col: "2 / 3" }] },
    { kind: "TL",   label: "Top-left ¼",     cells: [{ row: "1 / 2", col: "1 / 2" }] },
    { kind: "BR",   label: "Bottom-right ¼", cells: [{ row: "2 / 3", col: "2 / 3" }] },
    { kind: "GRID", label: "Tile all (⌘G)",  cells: [
      { row: "1 / 2", col: "1 / 2" }, { row: "1 / 2", col: "2 / 3" },
      { row: "2 / 3", col: "1 / 2" }, { row: "2 / 3", col: "2 / 3" },
    ] },
  ];
  return (
    <div
      onMouseLeave={onClose}
      style={{
        position: "absolute",
        top: "calc(100% + 4px)",
        right: 0,
        zIndex: 50,
        background: "var(--surface)",
        border: "2px solid var(--accent)",
        boxShadow: "6px 6px 0 0 var(--shadow)",
        padding: 6,
        minWidth: 200,
      }}
    >
      <div className="font-pixel text-[9px] tracking-widest mb-1.5" style={{ color: "var(--muted)" }}>
        ◆ SNAP LAYOUTS
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {layouts.map((l) => (
          <button
            key={l.label}
            title={l.label}
            onClick={() => {
              if (l.kind === "GRID") window.dispatchEvent(new CustomEvent("delos-tile-all"));
              else if (l.kind === "CASCADE") window.dispatchEvent(new CustomEvent("delos-cascade-all"));
              else onPick(l.kind);
            }}
            style={{
              padding: 4,
              background: "var(--bg)",
              border: "1px solid var(--surface-2)",
              cursor: "pointer",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateRows: "1fr 1fr",
                gridTemplateColumns: "1fr 1fr",
                gap: 2,
                width: 44,
                height: 28,
                margin: "0 auto",
              }}
            >
              {l.cells.map((c, i) => (
                <div key={i} style={{ gridRow: c.row, gridColumn: c.col, background: "var(--accent)", opacity: 0.75 }} />
              ))}
            </div>
            <div className="font-pixel text-[8px] tracking-wider text-center mt-1" style={{ color: "var(--fg)" }}>
              {l.label.toUpperCase()}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
