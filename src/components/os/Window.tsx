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

export function Window({
  win,
  focused,
  onFocus,
  onClose,
  onMinimize,
  onMaximize,
  onRefresh,
  onSnap,
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

  useEffect(() => {
    const t = setTimeout(() => setPhase("shown"), 250);
    return () => clearTimeout(t);
  }, []);

  function handleClose() {
    setPhase("closing");
    setTimeout(onClose, 180);
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
        transition={{ type: "spring", stiffness: 320, damping: 22, mass: 0.6 }}
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
            <button onClick={onMaximize} className="w-5 h-5 flex items-center justify-center hover:bg-black/20" aria-label="Maximize" title="Maximize">
              {maximized ? <Icons.Minimize2 size={11} color="currentColor" /> : <Icons.Maximize2 size={11} color="currentColor" />}
            </button>
            <button onClick={handleClose} className="w-5 h-5 flex items-center justify-center hover:bg-[color:var(--danger)]" aria-label="Close" title="Close (Esc)">
              <Icons.X size={12} color="currentColor" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto" style={{ background: "var(--surface)" }}>
          <AppErrorBoundary appName={win.title}>{win.content}</AppErrorBoundary>
        </div>
      </motion.div>
    </>
  );
}
