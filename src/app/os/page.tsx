"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import * as Icons from "lucide-react";
import { Boot } from "@/components/os/Boot";
import * as BrandIcons from "@/components/BrandIcons";
import { Window, type WindowChild, type SnapKind } from "@/components/os/Window";
import { ToastStack, type ToastItem } from "@/components/os/Toast";
import { Logo } from "@/components/Logo";
import { Terminal, MissionControl, NotesApp, AppBuilder, AboutApp } from "@/components/os/systemApps";
import { SettingsApp } from "@/components/os/SettingsApp";
import { MarketplaceApp } from "@/components/os/MarketplaceApp";
import { CohortApp } from "@/components/os/CohortApp";
import { SnakeGame, TicTacToeGame, MemoryMatchGame, MinesweeperGame, Game2048 } from "@/components/os/Games";
import { DoomGame } from "@/components/os/DoomGame";
import { VoiceApp } from "@/components/os/VoiceApp";
import { DelAssistant } from "@/components/os/DelAssistant";
import { CoworkApp } from "@/components/os/CoworkApp";
import { BrowserApp } from "@/components/os/BrowserApp";
import { CalculatorApp, CalendarApp, FileExplorerApp, SystemInfoApp } from "@/components/os/UtilityApps";
import { useCursor } from "@/lib/useCursor";
import { CommandPalette, type Command } from "@/components/os/CommandPalette";
import { ShortcutsModal } from "@/components/os/ShortcutsModal";
import { AnalyticsApp } from "@/components/os/AnalyticsApp";
import { IdentityApp } from "@/components/os/IdentityApp";
import { CoresApp } from "@/components/os/CoresApp";
import { CodebaseApp } from "@/components/os/CodebaseApp";
import { IngestApp } from "@/components/os/IngestApp";
import { OnboardingPortal, hasOnboarded } from "@/components/os/OnboardingPortal";
import { setTenantId as setTenantIdGlobal } from "@/lib/useTenant";
import { useViewport } from "@/lib/useViewport";
import { VoiceWakeMount } from "@/components/os/VoiceWakeMount";
import { ApprovalGate } from "@/components/os/ApprovalGate";
import { useWallpaper, WALLPAPERS, setWallpaper as setWallpaperGlobal } from "@/lib/useWallpaper";
import { useTheme } from "@/lib/useTheme";
import { AppRuntime } from "@/components/os/AppRuntime";
import { DesktopAmbient } from "@/components/os/DesktopAmbient";
import { Dock } from "@/components/os/Dock";
import { AgentPulse } from "@/components/os/AgentPulse";
import { CounterStrip } from "@/components/os/CounterStrip";
import { TourOverlay } from "@/components/os/TourOverlay";
import { EasterEggs } from "@/components/os/EasterEggs";
import { DesktopWidgets } from "@/components/os/DesktopWidgets";
import { Suspense } from "react";
import { emitIntent } from "@/lib/intentBus";
import type { VoiceAction } from "@/lib/useSpeech";
import type { AppSpec } from "@/lib/appSpec";

type WState = WindowChild & { maximized?: boolean; refreshKey: number };

type DockItem = {
  id: string;
  label: string;
  icon: keyof typeof Icons | string;
  spawn: () => Omit<WindowChild, "x" | "y" | "z">;
};

const desktopBus = new EventTarget();

function TerminalSlot() {
  return <Terminal onAnswer={(t) => desktopBus.dispatchEvent(new CustomEvent("toast", { detail: { text: "✓ " + t.slice(0, 60), tone: "ok" } }))} />;
}

function BuilderSlot() {
  return (
    <AppBuilder
      onBuilt={(spec) => {
        desktopBus.dispatchEvent(new CustomEvent("spawn-spec", { detail: spec }));
      }}
    />
  );
}

const SYSTEM_APPS: Record<string, DockItem> = {
  assistant: {
    id: "assistant",
    label: "Del Assistant",
    icon: "Bot",
    spawn: () => ({ id: "assistant", title: "Del Assistant", icon: "Bot", width: 760, height: 600, content: <DelAssistant /> }),
  },
  terminal: {
    id: "terminal",
    label: "del-terminal",
    icon: "TerminalSquare",
    spawn: () => ({ id: "terminal", title: "del-terminal", icon: "TerminalSquare", width: 620, height: 480, content: <TerminalSlot /> }),
  },
  builder: {
    id: "builder",
    label: "App Builder",
    icon: "Sparkles",
    spawn: () => ({ id: "builder", title: "Agent App Builder", icon: "Sparkles", width: 480, height: 480, content: <BuilderSlot /> }),
  },
  codebase: {
    id: "codebase",
    label: "Codebase",
    icon: "Code2",
    spawn: () => ({ id: "codebase", title: "Codebase Builder", icon: "Code2", width: 700, height: 560, content: <CodebaseApp /> }),
  },
  cohort: {
    id: "cohort",
    label: "Cohort",
    icon: "Users",
    spawn: () => ({ id: "cohort", title: "Cohort Council", icon: "Users", width: 520, height: 600, content: <CohortApp /> }),
  },
  voice: {
    id: "voice",
    label: "Voice Agent",
    icon: "Mic",
    spawn: () => ({ id: "voice", title: "Voice Agent", icon: "Mic", width: 420, height: 520, content: <VoiceApp /> }),
  },
  analytics: {
    id: "analytics",
    label: "Analytics",
    icon: "BarChart3",
    spawn: () => ({ id: "analytics", title: "Analytics", icon: "BarChart3", width: 460, height: 540, content: <AnalyticsApp /> }),
  },
  cowork: {
    id: "cowork",
    label: "Cowork",
    icon: "UsersRound",
    spawn: () => ({ id: "cowork", title: "Cowork", icon: "UsersRound", width: 460, height: 520, content: <CoworkApp /> }),
  },
  doom: {
    id: "doom",
    label: "DelDoom",
    icon: "Flame",
    spawn: () => ({ id: "doom", title: "DelDoom", icon: "Flame", width: 520, height: 380, content: <DoomGame /> }),
  },
  browser: {
    id: "browser",
    label: "Browser",
    icon: "Globe",
    spawn: () => ({ id: "browser", title: "Browser", icon: "Globe", width: 800, height: 600, content: <BrowserApp /> }),
  },
  calc: {
    id: "calc",
    label: "Calculator",
    icon: "Calculator",
    spawn: () => ({ id: "calc", title: "Calculator", icon: "Calculator", width: 320, height: 480, content: <CalculatorApp /> }),
  },
  calendar: {
    id: "calendar",
    label: "Calendar",
    icon: "Calendar",
    spawn: () => ({ id: "calendar", title: "Calendar", icon: "Calendar", width: 400, height: 500, content: <CalendarApp /> }),
  },
  files: {
    id: "files",
    label: "Files",
    icon: "FolderOpen",
    spawn: () => ({ id: "files", title: "Files", icon: "FolderOpen", width: 440, height: 520, content: <FileExplorerApp /> }),
  },
  sysinfo: {
    id: "sysinfo",
    label: "System Info",
    icon: "Cpu",
    spawn: () => ({ id: "sysinfo", title: "System Info", icon: "Cpu", width: 440, height: 500, content: <SystemInfoApp /> }),
  },
  mission: {
    id: "mission",
    label: "Mission Control",
    icon: "Radio",
    spawn: () => ({ id: "mission", title: "Mission Control", icon: "Radio", width: 480, height: 420, content: <MissionControl /> }),
  },
  marketplace: {
    id: "marketplace",
    label: "Marketplace",
    icon: "Wrench",
    spawn: () => ({ id: "marketplace", title: "Power-Ups Marketplace", icon: "Wrench", width: 540, height: 520, content: <MarketplaceApp /> }),
  },
  notes: {
    id: "notes",
    label: "Notes",
    icon: "BookOpen",
    spawn: () => ({ id: "notes", title: "Notes", icon: "BookOpen", width: 360, height: 380, content: <NotesApp /> }),
  },
  snake: {
    id: "snake",
    label: "Snake",
    icon: "Worm",
    spawn: () => ({ id: "snake", title: "Snake", icon: "Worm", width: 380, height: 480, content: <SnakeGame /> }),
  },
  tictactoe: {
    id: "tictactoe",
    label: "Tic-Tac-Toe",
    icon: "Hash",
    spawn: () => ({ id: "tictactoe", title: "Tic-Tac-Toe", icon: "Hash", width: 280, height: 360, content: <TicTacToeGame /> }),
  },
  memory: {
    id: "memory",
    label: "Memory Match",
    icon: "Brain",
    spawn: () => ({ id: "memory", title: "Memory Match", icon: "Brain", width: 320, height: 420, content: <MemoryMatchGame /> }),
  },
  minesweeper: {
    id: "minesweeper",
    label: "Minesweeper",
    icon: "Bomb",
    spawn: () => ({ id: "minesweeper", title: "Minesweeper", icon: "Bomb", width: 360, height: 440, content: <MinesweeperGame /> }),
  },
  game2048: {
    id: "game2048",
    label: "2048",
    icon: "Grid3x3",
    spawn: () => ({ id: "game2048", title: "2048", icon: "Grid3x3", width: 360, height: 460, content: <Game2048 /> }),
  },
  identity: {
    id: "identity",
    label: "Identity",
    icon: "User",
    spawn: () => ({ id: "identity", title: "~/IDENTITY.md", icon: "User", width: 560, height: 580, content: <IdentityApp /> }),
  },
  cores: {
    id: "cores",
    label: "Cores",
    icon: "Cpu",
    spawn: () => ({ id: "cores", title: "DevFactory · Cores", icon: "Cpu", width: 520, height: 520, content: <CoresApp /> }),
  },
  ingest: {
    id: "ingest",
    label: "Ingest",
    icon: "HardDrive",
    spawn: () => ({ id: "ingest", title: "Ingestion Hub", icon: "HardDrive", width: 580, height: 640, content: <IngestApp /> }),
  },
  settings: {
    id: "settings",
    label: "Settings",
    icon: "Settings",
    spawn: () => ({ id: "settings", title: "Settings", icon: "Settings", width: 480, height: 540, content: <SettingsApp /> }),
  },
  about: {
    id: "about",
    label: "About",
    icon: "Info",
    spawn: () => ({ id: "about", title: "About DelOS", icon: "Info", width: 380, height: 340, content: <AboutApp /> }),
  },
  arena: {
    id: "arena",
    label: "Arena",
    icon: "Swords",
    // External — opens /arena in new tab. Spawn returns a placeholder that auto-navigates.
    spawn: () => ({
      id: "arena",
      title: "Arena (battle royale)",
      icon: "Swords",
      width: 360,
      height: 220,
      content: (
        <div className="p-4 space-y-3 text-xs h-full flex flex-col items-center justify-center text-center">
          <div className="font-pixel text-sm tracking-widest" style={{ color: "var(--accent)" }}>★ ARENA</div>
          <p className="text-[color:var(--muted)] font-mono text-[11px]">
            Battle royale opens in a new tab so 3 cohort lanes have room to race.
          </p>
          <a href="/arena" target="_blank" rel="noreferrer" className="btn-pixel success" style={{ fontSize: 11, padding: "6px 12px" }}>
            ▶ OPEN ARENA
          </a>
        </div>
      ),
    }),
  },
};

export default function OSPage() {
  const [booted, setBooted] = useState(false);
  const [windows, setWindows] = useState<WState[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [launchpadOpen, setLaunchpadOpen] = useState(false);
  // Sticky-note dismissal persists across reloads — returning users don't
  // need to see the "how to use snap" cheat sheet every session.
  const [hintsDismissed, setHintsDismissed] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem("delos.hintsDismissed") === "1") setHintsDismissed(true);
    } catch {}
  }, []);
  function dismissHints() {
    setHintsDismissed(true);
    try { localStorage.setItem("delos.hintsDismissed", "1"); } catch {}
  }
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const zCounter = useRef(10);
  const spawnOffset = useRef(0);
  const [now, setNow] = useState(new Date());
  const [wallpaper] = useWallpaper();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_theme] = useTheme(); // apply theme attribute on mount
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_cursor] = useCursor(); // apply cursor attribute on mount
  const [viewport, setViewport] = useState({ width: 1600, height: 900 });
  const vp = useViewport();
  // On mobile + tablet, force every open window to behave as maximized so the
  // OS reads like a phone-OS shell (one full-screen app at a time, bottom dock).
  // Drag/resize controls on Window are disabled when this flag is true.
  const forceMaximize = vp.mobile;
  const [portalOpen, setPortalOpen] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [session, setSession] = useState<{ signedIn?: boolean; email?: string; tenantId?: string } | null>(null);

  // Bootstrap: fetch /api/me, lock per-user tenantId, decide whether to show OnboardingPortal.
  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d: { signedIn?: boolean; email?: string; tenantId?: string }) => {
        setSession(d);
        if (d?.tenantId) setTenantIdGlobal(d.tenantId);
        if (!hasOnboarded()) setPortalOpen(true);
      })
      .catch(() => {
        if (!hasOnboarded()) setPortalOpen(true);
      });
  }, []);

  // Listen for launch-app intents fired from OnboardingPortal, voice wake, etc.
  useEffect(() => {
    function onLaunch(e: Event) {
      const d = (e as CustomEvent).detail as { id?: string };
      if (d?.id && SYSTEM_APPS[d.id]) spawnSystemApp(d.id);
    }
    function onCloseFocused() {
      if (focusedId) {
        setWindows((p) => p.filter((w) => w.id !== focusedId));
        setFocusedId(null);
      }
    }
    function onWallpaperCycle() {
      // Defer to wallpaper hook listener — useWallpaper picks up this event.
      window.dispatchEvent(new CustomEvent("delos-wallpaper-next"));
    }
    window.addEventListener("delos-launch-app", onLaunch as EventListener);
    window.addEventListener("delos-close-focused", onCloseFocused as EventListener);
    window.addEventListener("delos-wallpaper-cycle", onWallpaperCycle as EventListener);
    return () => {
      window.removeEventListener("delos-launch-app", onLaunch as EventListener);
      window.removeEventListener("delos-close-focused", onCloseFocused as EventListener);
      window.removeEventListener("delos-wallpaper-cycle", onWallpaperCycle as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedId]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    function onResize() { setViewport({ width: window.innerWidth, height: window.innerHeight }); }
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function pushToast(text: string, tone: ToastItem["tone"] = "info") {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((p) => [...p, { id, text, tone }]);
    setTimeout(() => setToasts((p) => p.filter((x) => x.id !== id)), 3600);
  }

  function spawnSystemApp(key: string) {
    const tpl = SYSTEM_APPS[key];
    if (!tpl) return;
    setWindows((prev) => {
      const existing = prev.find((w) => w.id === tpl.id);
      zCounter.current += 1;
      if (existing) {
        setFocusedId(existing.id);
        return prev.map((w) => (w.id === tpl.id ? { ...w, z: zCounter.current, minimized: false } : w));
      }
      const base = tpl.spawn();
      const offset = spawnOffset.current * 24;
      spawnOffset.current = (spawnOffset.current + 1) % 8;
      const win: WState = { ...base, x: 80 + offset, y: 80 + offset, z: zCounter.current, refreshKey: 0 };
      setFocusedId(win.id);
      return [...prev, win];
    });
    pushToast(`launched ${tpl.label}`, "info");
  }

  function runDemoTour() {
    // Hackathon narrative: Terminal (chaos) → Mission Control (recall memory) → Cohort (multi-agent)
    const seq: Array<{ key: string; delay: number; toast?: string }> = [
      { key: "terminal", delay: 0, toast: "★ tour 1/3 · TERMINAL — run with chaos" },
      { key: "mission", delay: 1600, toast: "★ tour 2/3 · MISSION — see recalled memory" },
      { key: "cohort", delay: 3200, toast: "★ tour 3/3 · COHORT — 3 LLMs race + merge" },
    ];
    for (const s of seq) {
      setTimeout(() => {
        spawnSystemApp(s.key);
        if (s.toast) pushToast(s.toast, "ok");
      }, s.delay);
    }
  }

  function spawnSpecWindow(spec: AppSpec) {
    setWindows((prev) => {
      zCounter.current += 1;
      const winId = `spec-${spec.id}-${Date.now()}`;
      const offset = spawnOffset.current * 24;
      spawnOffset.current = (spawnOffset.current + 1) % 8;
      const content = makeSpecContent(spec, winId);
      const win: WState = {
        id: winId,
        title: spec.name,
        icon: spec.icon,
        width: spec.width,
        height: spec.height,
        x: 140 + offset,
        y: 90 + offset,
        z: zCounter.current,
        content,
        refreshKey: 0,
      };
      setFocusedId(winId);
      return [...prev, win];
    });
    pushToast(`★ ${spec.name} installed`, "ok");
  }

  function makeSpecContent(spec: AppSpec, winId: string) {
    return (
      <AppRuntime
        spec={spec}
        onClose={() => closeWin(winId)}
        onNotify={(m: string) => pushToast(m, "ok")}
        onAgent={async (prompt: string, saveAs: string, ctx: { setState: (s: Record<string, unknown>) => void; current: Record<string, unknown> }) => {
          try {
            const r = await fetch("/api/quick-agent", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ prompt }),
            });
            const j = (await r.json()) as { text?: string; error?: string };
            if (j.text) {
              ctx.setState({ [saveAs]: j.text });
              pushToast("agent replied", "ok");
            } else {
              pushToast(`agent err: ${j.error ?? "unknown"}`, "bad");
            }
          } catch (e) {
            pushToast(`agent err: ${(e as Error).message}`, "bad");
          }
        }}
        onTool={async (tool: string, args: Record<string, string>, saveAs: string | undefined, ctx: { setState: (s: Record<string, unknown>) => void; current: Record<string, unknown> }) => {
          try {
            const r = await fetch("/api/tool", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tool, args }),
            });
            const j = (await r.json()) as { ok?: boolean; data?: unknown; error?: string };
            if (j.ok && saveAs) {
              ctx.setState({ [saveAs]: typeof j.data === "object" ? JSON.stringify(j.data) : String(j.data) });
            } else if (!j.ok) {
              pushToast(`tool err: ${j.error ?? "unknown"}`, "bad");
            }
          } catch (e) {
            pushToast(`tool err: ${(e as Error).message}`, "bad");
          }
        }}
      />
    );
  }

  function closeWin(id: string) {
    setWindows((p) => p.filter((w) => w.id !== id));
    if (focusedId === id) setFocusedId(null);
  }
  function minimizeWin(id: string) {
    setWindows((p) => p.map((w) => (w.id === id ? { ...w, minimized: !w.minimized } : w)));
  }
  function maximizeWin(id: string) {
    setWindows((p) => p.map((w) => (w.id === id ? { ...w, maximized: !w.maximized } : w)));
  }
  function refreshWin(id: string) {
    setWindows((p) => p.map((w) => (w.id === id ? { ...w, refreshKey: w.refreshKey + 1 } : w)));
    pushToast("refreshed", "info");
  }
  function snapWin(id: string, side: SnapKind) {
    const TOP = 48;       // top bar
    const BOTTOM = 56;    // dock reserve
    const innerH = viewport.height - TOP - BOTTOM;
    const innerW = viewport.width;
    const halfH = innerH / 2;
    const halfW = innerW / 2;
    const layouts: Record<SnapKind, { x: number; y: number; width: number; height: number }> = {
      L:    { x: 0,        y: TOP,         width: halfW, height: innerH },
      R:    { x: halfW,    y: TOP,         width: halfW, height: innerH },
      T:    { x: 0,        y: TOP,         width: innerW, height: halfH },
      B:    { x: 0,        y: TOP + halfH, width: innerW, height: halfH },
      TL:   { x: 0,        y: TOP,         width: halfW, height: halfH },
      TR:   { x: halfW,    y: TOP,         width: halfW, height: halfH },
      BL:   { x: 0,        y: TOP + halfH, width: halfW, height: halfH },
      BR:   { x: halfW,    y: TOP + halfH, width: halfW, height: halfH },
      FULL: { x: 0,        y: TOP,         width: innerW, height: innerH },
    };
    const layout = layouts[side];
    setWindows((p) =>
      p.map((w) =>
        w.id === id ? { ...w, ...layout, maximized: false } : w,
      ),
    );
    const labels: Record<SnapKind, string> = {
      L: "left half", R: "right half", T: "top half", B: "bottom half",
      TL: "top-left", TR: "top-right", BL: "bottom-left", BR: "bottom-right",
      FULL: "full screen",
    };
    pushToast(`snapped ${labels[side]}`, "info");
  }

  // Auto-tile every open (non-minimized) window into a balanced grid.
  // 1 → fullscreen · 2 → halves · 3 → big L + 2 right · 4 → 2x2 · ≥5 → wraps.
  function gridArrange() {
    const visible = windows.filter((w) => !w.minimized);
    if (visible.length === 0) {
      pushToast("no windows to tile", "warn");
      return;
    }
    const TOP = 48;
    const BOTTOM = 56;
    const innerH = viewport.height - TOP - BOTTOM;
    const innerW = viewport.width;
    const n = visible.length;
    let cols = Math.ceil(Math.sqrt(n));
    if (n === 2) cols = 2;
    if (n === 3) cols = 3;
    const rows = Math.ceil(n / cols);
    const cellW = innerW / cols;
    const cellH = innerH / rows;
    setWindows((p) => {
      const next = [...p];
      let i = 0;
      for (const w of next) {
        if (w.minimized) continue;
        const r = Math.floor(i / cols);
        const c = i % cols;
        w.x = c * cellW;
        w.y = TOP + r * cellH;
        w.width = cellW;
        w.height = cellH;
        w.maximized = false;
        i += 1;
      }
      return next;
    });
    pushToast(`tiled ${n} window${n === 1 ? "" : "s"} into ${cols}×${rows} grid`, "info");
  }

  // Cascade — stack windows diagonally so each title bar is visible.
  function cascadeArrange() {
    const visible = windows.filter((w) => !w.minimized);
    if (visible.length === 0) return;
    const baseW = Math.min(720, viewport.width * 0.6);
    const baseH = Math.min(520, (viewport.height - 48 - 56) * 0.7);
    setWindows((p) => {
      const next = [...p];
      let i = 0;
      for (const w of next) {
        if (w.minimized) continue;
        w.x = 48 + i * 32;
        w.y = 64 + i * 32;
        w.width = baseW;
        w.height = baseH;
        w.maximized = false;
        i += 1;
      }
      return next;
    });
    pushToast(`cascaded ${visible.length} window${visible.length === 1 ? "" : "s"}`, "info");
  }
  function focusWin(id: string) {
    zCounter.current += 1;
    const z = zCounter.current;
    setWindows((p) => p.map((w) => (w.id === id ? { ...w, z } : w)));
    setFocusedId(id);
  }
  function moveWin(id: string, x: number, y: number) {
    setWindows((p) => p.map((w) => (w.id === id ? { ...w, x, y } : w)));
  }
  function resizeWin(id: string, rect: { x: number; y: number; width: number; height: number }) {
    setWindows((p) => p.map((w) => (w.id === id ? { ...w, ...rect, maximized: false } : w)));
  }

  useEffect(() => {
    function onToast(e: Event) {
      const d = (e as CustomEvent).detail as { text: string; tone?: ToastItem["tone"] };
      pushToast(d.text, d.tone ?? "info");
    }
    function onSpawn(e: Event) {
      const spec = (e as CustomEvent).detail as AppSpec;
      spawnSpecWindow(spec);
    }
    function onVoiceAction(e: Event) {
      const a = (e as CustomEvent<VoiceAction>).detail;
      if (!a) return;
      switch (a.intent) {
        case "open_app":
          if (a.app && SYSTEM_APPS[a.app]) spawnSystemApp(a.app);
          break;
        case "run_mission":
          spawnSystemApp("terminal");
          if (a.payload) setTimeout(() => emitIntent({ kind: "terminal.run", goal: a.payload! }), 250);
          break;
        case "build_app":
          spawnSystemApp("builder");
          if (a.payload) setTimeout(() => emitIntent({ kind: "builder.build", prompt: a.payload! }), 250);
          break;
        case "run_cohort":
          spawnSystemApp("cohort");
          if (a.payload) setTimeout(() => emitIntent({ kind: "cohort.run", goal: a.payload! }), 250);
          break;
        case "recall_memory":
          spawnSystemApp("mission");
          break;
        case "change_wallpaper": {
          const idx = WALLPAPERS.findIndex((w) => w.id === wallpaper);
          setWallpaperGlobal(WALLPAPERS[(idx + 1) % WALLPAPERS.length].id);
          break;
        }
        case "close_window":
          if (focusedId) closeWin(focusedId);
          break;
        case "navigate":
          if (a.payload) window.location.href = a.payload;
          break;
        case "answer":
        case "unknown":
          // VoiceApp already spoke the reply; nothing to do here.
          break;
      }
    }
    function onTileAll() { gridArrange(); }
    function onCascadeAll() { cascadeArrange(); }
    desktopBus.addEventListener("toast", onToast);
    desktopBus.addEventListener("spawn-spec", onSpawn);
    window.addEventListener("toast", onToast as EventListener);
    window.addEventListener("spawn-spec", onSpawn as EventListener);
    window.addEventListener("delos-voice-action", onVoiceAction as EventListener);
    window.addEventListener("delos-tile-all", onTileAll);
    window.addEventListener("delos-cascade-all", onCascadeAll);
    return () => {
      desktopBus.removeEventListener("toast", onToast);
      desktopBus.removeEventListener("spawn-spec", onSpawn);
      window.removeEventListener("toast", onToast as EventListener);
      window.removeEventListener("spawn-spec", onSpawn as EventListener);
      window.removeEventListener("delos-voice-action", onVoiceAction as EventListener);
      window.removeEventListener("delos-tile-all", onTileAll);
      window.removeEventListener("delos-cascade-all", onCascadeAll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dock order grouped by category. Reading left-to-right:
  //   ★ AI agents      assistant / identity / cohort / arena / voice / cowork
  //   ★ Builders       builder / codebase / cores / mission
  //   ★ Tools          ingest / terminal / browser / marketplace / analytics
  //   ★ Files & notes  files / notes / calendar / calc / sysinfo
  //   ★ Games          snake / tictactoe / memory / minesweeper / game2048 / doom
  //   ★ System         settings / about
  // No visual separators yet — order alone tightens the cognitive load enough
  // that "what does this app do" is answered by its neighbors.
  const dockOrder = useMemo(
    () => [
      // AI agents (6)
      "assistant", "identity", "cohort", "arena", "voice", "cowork",
      // Builders (4)
      "builder", "codebase", "cores", "mission",
      // Tools (5)
      "ingest", "terminal", "browser", "marketplace", "analytics",
      // Files & notes (5)
      "files", "notes", "calendar", "calc", "sysinfo",
      // Games (6)
      "snake", "tictactoe", "memory", "minesweeper", "game2048", "doom",
      // System (2)
      "settings", "about",
    ],
    [],
  );
  const All = Icons as unknown as Record<string, React.ComponentType<{ size?: number; color?: string }>>;

  // Global keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (isMod && e.key === "/") {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") {
        if (ctxMenu) {
          setCtxMenu(null);
        } else if (launchpadOpen) {
          setLaunchpadOpen(false);
        } else if (shortcutsOpen) {
          setShortcutsOpen(false);
        } else if (paletteOpen) {
          setPaletteOpen(false);
        } else if (focusedId) {
          setWindows((p) => p.filter((w) => w.id !== focusedId));
          setFocusedId(null);
        }
      }
      if (isMod && e.key.toLowerCase() === "t") {
        e.preventDefault();
        spawnSystemApp("terminal");
      }
      if (isMod && e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        spawnSystemApp("builder");
      }
      if (isMod && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        runDemoTour();
      }
      if (isMod && e.key.toLowerCase() === "r") {
        if (focusedId) {
          e.preventDefault();
          refreshWin(focusedId);
        }
      }
      // Launchpad — F4 or Cmd+Space (same vibe as Mac Launchpad / Windows Start)
      if (e.key === "F4" || (isMod && e.code === "Space")) {
        e.preventDefault();
        setLaunchpadOpen((v) => !v);
        return;
      }
      // Win+Arrow snap shortcuts (only when meta key is down — leave Cmd+Left for browsers)
      if (e.metaKey && focusedId && !e.ctrlKey) {
        if (e.key === "ArrowLeft")  { e.preventDefault(); snapWin(focusedId, e.shiftKey ? "BL" : e.altKey ? "TL" : "L"); }
        if (e.key === "ArrowRight") { e.preventDefault(); snapWin(focusedId, e.shiftKey ? "BR" : e.altKey ? "TR" : "R"); }
        if (e.key === "ArrowUp")    { e.preventDefault(); snapWin(focusedId, "FULL"); }
        if (e.key === "ArrowDown")  { e.preventDefault(); minimizeWin(focusedId); }
      }
      // Tile shortcut — Cmd+G
      if (isMod && e.key.toLowerCase() === "g") {
        e.preventDefault();
        gridArrange();
      }
      // Cascade — Cmd+Shift+C
      if (isMod && e.shiftKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        cascadeArrange();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedId, paletteOpen, ctxMenu, windows.length]);

  const commands: Command[] = useMemo(() => {
    const launches: Command[] = dockOrder.map((key) => ({
      id: `launch:${key}`,
      label: `Launch ${SYSTEM_APPS[key].label}`,
      hint: `open the ${SYSTEM_APPS[key].label} app`,
      icon: SYSTEM_APPS[key].icon as string,
      section: "App",
      run: () => spawnSystemApp(key),
    }));
    const actions: Command[] = [
      { id: "build-app", label: "Build new app with AI", hint: "open App Builder", icon: "Sparkles", section: "Action", run: () => spawnSystemApp("builder") },
      { id: "cohort-run", label: "Run cohort council", hint: "compare models in parallel", icon: "Users", section: "Action", run: () => spawnSystemApp("cohort") },
      {
        id: "wallpaper-cycle",
        label: "Cycle wallpaper",
        hint: "next preset",
        icon: "Image",
        section: "Theme",
        run: () => {
          const idx = WALLPAPERS.findIndex((w) => w.id === wallpaper);
          const next = WALLPAPERS[(idx + 1) % WALLPAPERS.length];
          setWallpaperGlobal(next.id);
          pushToast(`wallpaper · ${next.label}`, "info");
        },
      },
      {
        id: "close-focused",
        label: "Close focused window",
        hint: focusedId ? `close ${focusedId}` : "no focused window",
        icon: "X",
        section: "Window",
        run: () => focusedId && closeWin(focusedId),
      },
      {
        id: "maximize-focused",
        label: "Toggle maximize",
        hint: focusedId ?? "no focused window",
        icon: "Maximize2",
        section: "Window",
        run: () => focusedId && maximizeWin(focusedId),
      },
      {
        id: "refresh-focused",
        label: "Refresh focused window",
        hint: focusedId ?? "no focused window",
        icon: "RotateCw",
        section: "Window",
        run: () => focusedId && refreshWin(focusedId),
      },
      {
        id: "close-all",
        label: "Close all windows",
        hint: `${windows.length} open`,
        icon: "XCircle",
        section: "Window",
        run: () => {
          setWindows([]);
          setFocusedId(null);
          pushToast("all windows closed", "info");
        },
      },
      { id: "exit", label: "Exit to landing", hint: "go to /", icon: "LogOut", section: "Nav", run: () => { window.location.href = "/"; } },
    ];
    return [...launches, ...actions];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dockOrder, focusedId, windows.length, wallpaper]);

  const wallEntry = WALLPAPERS.find((w) => w.id === wallpaper) ?? WALLPAPERS[0];
  const wallCss = wallEntry.css;
  const wallAnimated = wallEntry.animated;
  // Auto-contrast tone for logo + chrome readability. "light" wallpapers flip text to dark.
  const wallTone = wallEntry.pairsWith ?? "dark";

  return (
    <div className="fixed inset-0 overflow-hidden delos-root" data-wall-tone={wallTone} style={{ background: "var(--bg)" }}>
      {!booted && <Boot onDone={() => setBooted(true)} appsCount={dockOrder.length} />}

      {booted && (
        <>
          <div className={`absolute inset-0 ${wallAnimated ? "wallpaper-animated" : ""}`} style={{ background: wallCss }} />
          <div
            className="absolute inset-0 opacity-15"
            style={{
              background: `repeating-linear-gradient(0deg, transparent 0 38px, rgba(123,123,153,0.08) 38px 40px),
                     repeating-linear-gradient(90deg, transparent 0 38px, rgba(123,123,153,0.08) 38px 40px)`,
            }}
          />
          <DesktopAmbient density={20} />
          <DesktopWidgets />

          <header data-tour="hero" className="absolute top-0 left-0 right-0 z-[100] flex items-center justify-between px-2 sm:px-4 py-2 glass-header crt-glow">
            <div className="flex items-center gap-3 min-w-0">
              <Logo size={26} />
              <span className="hidden sm:inline text-[color:var(--muted)] font-mono text-[10px]">v2.1 · agents under pressure</span>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <button onClick={() => setLaunchpadOpen(true)} className="hidden sm:inline-flex pill pill-muted" title="Launchpad (F4 / ⌘Space)" style={{ cursor: "pointer", fontSize: 10 }}>
                <Icons.LayoutGrid size={10} /> APPS
              </button>
              <button onClick={gridArrange} className="hidden md:inline-flex pill pill-muted" title="Tile windows (⌘G)" style={{ cursor: "pointer", fontSize: 10 }}>
                <Icons.Grid3x3 size={10} /> TILE
              </button>
              <button data-tour="demo-button" onClick={runDemoTour} className="hidden md:inline-flex pill pill-info" title="Run demo tour (⌘ Shift D)" style={{ cursor: "pointer", fontSize: 10 }}>
                ▶ DEMO
              </button>
              <CounterStrip />
              <span data-tour="hydradb" className="hidden sm:inline-flex pill pill-ok"><span className="w-2 h-2 inline-block accent-pulse" style={{ background: "var(--success)" }} /> HYDRADB</span>
              <span className="pill pill-info">{windows.filter((w) => !w.minimized).length} OPEN</span>
              <span className="font-pixel text-sm tracking-widest" style={{ color: "var(--fg)" }}>
                {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
              <Link href="/" data-tour="exit" className="pill pill-muted" style={{ textDecoration: "none" }}>EXIT</Link>
            </div>
          </header>

          <main
            role="main"
            aria-label="DelOS desktop"
            className="absolute inset-0 pt-12 pb-14"
            onMouseDown={() => {
              setFocusedId(null);
              setCtxMenu(null);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtxMenu({ x: e.clientX, y: e.clientY });
            }}
          >
            {windows.map((w) => (
              <Window
                key={`${w.id}-${w.refreshKey}`}
                win={w}
                focused={focusedId === w.id}
                maximized={w.maximized || forceMaximize}
                onFocus={() => focusWin(w.id)}
                onClose={() => closeWin(w.id)}
                onMinimize={() => minimizeWin(w.id)}
                onMaximize={() => maximizeWin(w.id)}
                onRefresh={() => refreshWin(w.id)}
                onSnap={(side) => snapWin(w.id, side)}
                onResize={(rect) => resizeWin(w.id, rect)}
                onDragEnd={(x, y) => moveWin(w.id, x, y)}
                bounds={viewport}
              />
            ))}

            <WelcomeMat visible={windows.length === 0} onLaunch={spawnSystemApp} apps={SYSTEM_APPS} order={dockOrder} onDemo={runDemoTour} />
          </main>

          <div data-tour="agent-pulse" className="contents">
            <AgentPulse onOpen={() => spawnSystemApp("cohort")} />
          </div>

          {/* Guided tour overlay (judges + first-time users) */}
          <Suspense fallback={null}>
            <TourOverlay />
          </Suspense>

          {/* Easter eggs — konami code, :matrix, :varun, :doom */}
          <EasterEggs />

          <div data-tour="dock" className="contents">
            <Dock
              order={dockOrder}
              apps={SYSTEM_APPS}
              openIds={windows.map((w) => w.id)}
              focusedId={focusedId}
              onLaunch={spawnSystemApp}
              onClose={closeWin}
              onMinimize={minimizeWin}
            />
          </div>

          <ToastStack items={toasts} onDismiss={(id) => setToasts((p) => p.filter((x) => x.id !== id))} />

          <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
          {portalOpen && <OnboardingPortal onClose={() => setPortalOpen(false)} />}
          <VoiceWakeMount />
          <ApprovalGate />
          <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
          <Launchpad
            open={launchpadOpen}
            onClose={() => setLaunchpadOpen(false)}
            apps={SYSTEM_APPS}
            order={dockOrder}
            onLaunch={(k) => { spawnSystemApp(k); setLaunchpadOpen(false); }}
          />
          {!hintsDismissed && (
            <HintSticky
              onDismiss={dismissHints}
              onTile={gridArrange}
              onCascade={cascadeArrange}
              onLaunchpad={() => setLaunchpadOpen(true)}
            />
          )}

          {ctxMenu && (
            <ContextMenu x={ctxMenu.x} y={ctxMenu.y} onClose={() => setCtxMenu(null)} onPick={(action) => {
              if (action === "terminal") spawnSystemApp("terminal");
              else if (action === "builder") spawnSystemApp("builder");
              else if (action === "notes") spawnSystemApp("notes");
              else if (action === "settings") spawnSystemApp("settings");
              else if (action === "wallpaper") {
                const idx = WALLPAPERS.findIndex((w) => w.id === wallpaper);
                const next = WALLPAPERS[(idx + 1) % WALLPAPERS.length];
                setWallpaperGlobal(next.id);
                pushToast(`wallpaper · ${next.label}`, "info");
              } else if (action === "refresh-all") {
                setWindows((p) => p.map((w) => ({ ...w, refreshKey: w.refreshKey + 1 })));
                pushToast("all refreshed", "info");
              } else if (action === "close-all") {
                setWindows([]);
                pushToast("all closed", "info");
              } else if (action === "palette") {
                setPaletteOpen(true);
              }
              setCtxMenu(null);
            }} />
          )}

          <button
            onClick={() => setPaletteOpen(true)}
            className="fixed top-14 right-3 z-[80] pill pill-muted hidden sm:flex"
            style={{ cursor: "pointer", fontSize: 10 }}
            aria-label="Open command palette"
            title="Cmd+K"
          >
            <Icons.Command size={10} /> K
          </button>
        </>
      )}
    </div>
  );
}

function ContextMenu({ x, y, onClose, onPick }: { x: number; y: number; onClose: () => void; onPick: (action: string) => void }) {
  const items: Array<{ action: string; label: string; icon: string; section?: string }> = [
    { action: "terminal", label: "New Terminal", icon: "TerminalSquare", section: "New" },
    { action: "builder", label: "New Agent App", icon: "Sparkles", section: "New" },
    { action: "notes", label: "New Notes", icon: "BookOpen", section: "New" },
    { action: "palette", label: "Command Palette ⌘K", icon: "Command", section: "Tools" },
    { action: "wallpaper", label: "Cycle Wallpaper", icon: "Image", section: "View" },
    { action: "refresh-all", label: "Refresh All Windows", icon: "RotateCw", section: "View" },
    { action: "close-all", label: "Close All Windows", icon: "XCircle", section: "View" },
    { action: "settings", label: "Settings", icon: "Settings", section: "System" },
  ];
  const All = Icons as unknown as Record<string, React.ComponentType<{ size?: number; color?: string }>>;
  // Adjust position to stay in bounds
  const w = typeof window === "undefined" ? 1600 : window.innerWidth;
  const h = typeof window === "undefined" ? 900 : window.innerHeight;
  const cx = Math.min(x, w - 220);
  const cy = Math.min(y, h - items.length * 28 - 20);
  return (
    <>
      <div className="fixed inset-0 z-[8000]" onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div className="fixed z-[8001] card-pixel" style={{ left: cx, top: cy, padding: 4, minWidth: 220 }}>
        {items.map((it, i) => {
          const Cmp = All[it.icon] ?? Icons.ChevronRight;
          const prev = items[i - 1];
          const showHeader = !prev || prev.section !== it.section;
          return (
            <div key={it.action}>
              {showHeader && it.section && (
                <div className="px-2 pt-1 pb-0.5 text-[9px] font-pixel tracking-wider" style={{ color: "var(--muted)" }}>{it.section}</div>
              )}
              <button
                onClick={() => onPick(it.action)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-left font-mono text-xs hover:bg-[color:var(--surface-2)]"
                style={{ color: "var(--fg)" }}
              >
                <Cmp size={12} color="var(--accent)" />
                <span>{it.label}</span>
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

function WelcomeMat({
  visible,
  onLaunch,
  apps,
  order,
  onDemo,
}: {
  visible: boolean;
  onLaunch: (key: string) => void;
  apps: Record<string, DockItem>;
  order: string[];
  onDemo: () => void;
}) {
  const All = Icons as unknown as Record<string, React.ComponentType<{ size?: number; color?: string }>>;
  // Sleek brand-aligned overrides for killer apps. Falls back to lucide otherwise.
  const SLEEK: Record<string, React.ComponentType<{ size?: number; color?: string }>> = {
    assistant: BrandIcons.DelAssistantSleek,
    identity: BrandIcons.IdentitySleek,
    ingest: BrandIcons.IngestSleek,
    cohort: BrandIcons.CohortSleek,
    cores: BrandIcons.CoresSleek,
    arena: BrandIcons.ArenaSleek,
    builder: BrandIcons.BuilderSleek,
    terminal: BrandIcons.TerminalSleek,
    mission: BrandIcons.MissionSleek,
    claude: BrandIcons.ClaudeIcon,
    chatgpt: BrandIcons.ChatGPTIcon,
    perplexity: BrandIcons.PerplexityIcon,
  };
  if (!visible) return null;
  const featured = order.slice(0, 12);
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-4 overflow-y-auto">
      <div className="text-center pointer-events-auto px-4 max-w-3xl w-full">
        <div className="flex items-center justify-center gap-3 mb-2">
          <Logo size={96} />
        </div>
        <h1
          className="font-pixel text-2xl sm:text-3xl tracking-widest mt-2 wallpaper-text-shadow"
          style={{ color: "var(--fg)" }}
        >
          WELCOME TO DEL<span style={{ color: "var(--accent)" }}>OS</span>
        </h1>
        <p
          className="text-[color:var(--muted)] font-mono text-[11px] sm:text-xs mt-3 max-w-md mx-auto wallpaper-text-shadow"
          style={{ background: "rgba(var(--bg-rgb), 0.5)", padding: "6px 12px", borderRadius: 4, display: "inline-block" }}
        >
          browser-OS · agents build the apps · ⌘K palette · right-click desktop · drag windows · double-click title to max
        </p>
        <div className="mt-5 flex justify-center gap-2 flex-wrap">
          <button className="btn-pixel success" onClick={onDemo} title="Auto-launch a guided 4-app tour">▶ DEMO TOUR</button>
          <button className="btn-pixel" onClick={() => onLaunch("builder")}>★ BUILD APP</button>
          <button className="btn-pixel ghost" onClick={() => onLaunch("cohort")}>COHORT</button>
          <button className="btn-pixel ghost" onClick={() => onLaunch("voice")}>VOICE</button>
          <button className="btn-pixel ghost" onClick={() => onLaunch("doom")}>DOOM 3D</button>
          <button className="btn-pixel ghost" onClick={() => onLaunch("terminal")}>TERMINAL</button>
        </div>

        <div className="mt-8 grid grid-cols-4 sm:grid-cols-6 gap-2 sm:gap-3 mx-auto">
          {featured.map((k) => {
            const a = apps[k];
            const Cmp = SLEEK[k] ?? All[a.icon as string] ?? Icons.Box;
            return (
              <button
                key={k}
                onClick={() => onLaunch(k)}
                className="card-pixel app-card-icon icon-premium flex flex-col items-center justify-center gap-1 group"
                style={{ padding: "10px 6px", cursor: "pointer", transition: "transform 140ms cubic-bezier(0.34, 1.56, 0.64, 1)" }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-4px)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}
              >
                <Cmp size={26} color="var(--accent)" />
                <span className="font-pixel text-[9px] tracking-wider" style={{ color: "var(--fg)" }}>{a.label.toUpperCase()}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Fullscreen Launchpad — Mac-style app grid with live filter.
// Opens on F4 / Cmd+Space / header APPS button. ESC closes.
function Launchpad({
  open,
  onClose,
  apps,
  order,
  onLaunch,
}: {
  open: boolean;
  onClose: () => void;
  apps: Record<string, DockItem>;
  order: string[];
  onLaunch: (key: string) => void;
}) {
  const [q, setQ] = useState("");
  const All = Icons as unknown as Record<string, React.ComponentType<{ size?: number; color?: string }>>;
  const SLEEK: Record<string, React.ComponentType<{ size?: number; color?: string }>> = {
    assistant: BrandIcons.DelAssistantSleek,
    identity: BrandIcons.IdentitySleek,
    ingest: BrandIcons.IngestSleek,
    cohort: BrandIcons.CohortSleek,
    cores: BrandIcons.CoresSleek,
    arena: BrandIcons.ArenaSleek,
    builder: BrandIcons.BuilderSleek,
    terminal: BrandIcons.TerminalSleek,
    mission: BrandIcons.MissionSleek,
  };
  useEffect(() => { if (!open) setQ(""); }, [open]);
  if (!open) return null;
  const list = order.filter((k) => apps[k].label.toLowerCase().includes(q.toLowerCase()));
  // Group into categories
  const groups: Array<{ label: string; ids: string[] }> = [
    { label: "AI AGENTS",      ids: ["assistant", "identity", "cohort", "arena", "voice", "cowork"] },
    { label: "BUILDERS",       ids: ["builder", "codebase", "cores", "mission"] },
    { label: "TOOLS",          ids: ["ingest", "terminal", "browser", "marketplace", "analytics"] },
    { label: "FILES & NOTES",  ids: ["files", "notes", "calendar", "calc", "sysinfo"] },
    { label: "GAMES",          ids: ["snake", "tictactoe", "memory", "minesweeper", "game2048", "doom"] },
    { label: "SYSTEM",         ids: ["settings", "about"] },
  ];
  return (
    <div
      className="fixed inset-0 z-[9000] flex flex-col items-center justify-start overflow-y-auto"
      style={{
        background: "rgba(7,7,11,0.92)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        padding: "60px 24px 40px",
      }}
      onClick={onClose}
    >
      <div className="w-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div className="font-pixel text-2xl tracking-widest" style={{ color: "var(--accent)" }}>
            ★ LAUNCHPAD
          </div>
          <button onClick={onClose} className="pill pill-muted" style={{ cursor: "pointer" }}>
            <Icons.X size={10} /> ESC
          </button>
        </div>

        <div className="card-pixel mb-6" style={{ padding: "8px 12px" }}>
          <div className="flex items-center gap-2">
            <Icons.Search size={14} color="var(--accent)" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="search apps…"
              className="bg-transparent flex-1 outline-none font-mono text-sm"
              style={{ color: "var(--fg)" }}
            />
            <span className="font-mono text-[10px]" style={{ color: "var(--muted)" }}>
              {list.length} / {order.length}
            </span>
          </div>
        </div>

        {q ? (
          <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 gap-3">
            {list.map((k) => {
              const a = apps[k];
              const Cmp = SLEEK[k] ?? All[a.icon as string] ?? Icons.Box;
              return (
                <button
                  key={k}
                  onClick={() => onLaunch(k)}
                  className="card-pixel flex flex-col items-center justify-center gap-1.5 hover:scale-105 transition-transform"
                  style={{ padding: "14px 8px", cursor: "pointer", background: "rgba(255,255,255,0.04)" }}
                >
                  <Cmp size={32} color="var(--accent)" />
                  <span className="font-pixel text-[9px] tracking-wider text-center" style={{ color: "var(--fg)" }}>
                    {a.label.toUpperCase()}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map((g) => {
              const visible = g.ids.filter((id) => apps[id]);
              if (!visible.length) return null;
              return (
                <div key={g.label}>
                  <div className="font-pixel text-[10px] tracking-widest mb-2" style={{ color: "var(--muted)" }}>
                    ◆ {g.label}
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 gap-3">
                    {visible.map((k) => {
                      const a = apps[k];
                      const Cmp = SLEEK[k] ?? All[a.icon as string] ?? Icons.Box;
                      return (
                        <button
                          key={k}
                          onClick={() => onLaunch(k)}
                          className="card-pixel flex flex-col items-center justify-center gap-1.5 transition-transform"
                          style={{ padding: "14px 8px", cursor: "pointer", background: "rgba(255,255,255,0.04)" }}
                          onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.06)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
                        >
                          <Cmp size={32} color="var(--accent)" />
                          <span className="font-pixel text-[9px] tracking-wider text-center" style={{ color: "var(--fg)" }}>
                            {a.label.toUpperCase()}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// Sticky-note style cheat sheet pinned to the desktop. First-time
// users see the new snap + Launchpad + tile shortcuts at a glance.
// Dismissable; state lives in component memory (session).
function HintSticky({
  onDismiss,
  onTile,
  onCascade,
  onLaunchpad,
}: {
  onDismiss: () => void;
  onTile: () => void;
  onCascade: () => void;
  onLaunchpad: () => void;
}) {
  return (
    <div
      className="fixed z-[70] hidden md:block"
      style={{
        right: 16,
        bottom: 72,
        width: 268,
        background: "#fff7a8",
        color: "#1a1a26",
        padding: 12,
        boxShadow: "4px 4px 0 0 rgba(0,0,0,0.35)",
        borderRadius: 2,
        transform: "rotate(-1.5deg)",
        fontFamily: "var(--font-pixel)",
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] tracking-widest" style={{ color: "#7a6500" }}>★ STICKY · HOW TO USE</span>
        <button onClick={onDismiss} aria-label="Dismiss hints" style={{ color: "#1a1a26", cursor: "pointer" }}>
          <Icons.X size={12} />
        </button>
      </div>
      <ul className="text-[10px] space-y-1 leading-snug" style={{ color: "#2a2200" }}>
        <li>· Drag window to <strong>edge</strong> → snap half</li>
        <li>· Drag to <strong>corner</strong> → quarter snap</li>
        <li>· <strong>⌘ + ←/→</strong> half · <strong>⌘ + ↑</strong> full</li>
        <li>· <strong>⌘ Alt ←/→</strong> top-quarter · <strong>⌘ Shift ←/→</strong> bottom-quarter</li>
        <li>· <strong>⌘ G</strong> auto-tile · <strong>⌘ Shift C</strong> cascade</li>
        <li>· <strong>F4</strong> or <strong>⌘ Space</strong> Launchpad</li>
        <li>· <strong>⌘ K</strong> palette · <strong>⌘ /</strong> all shortcuts</li>
      </ul>
      <div className="flex gap-1.5 mt-3">
        <button
          onClick={onTile}
          style={{ background: "#1a1a26", color: "#fbc531", padding: "4px 6px", fontSize: 9, cursor: "pointer", border: "none" }}
        >
          TILE NOW
        </button>
        <button
          onClick={onCascade}
          style={{ background: "#1a1a26", color: "#5fc4e1", padding: "4px 6px", fontSize: 9, cursor: "pointer", border: "none" }}
        >
          CASCADE
        </button>
        <button
          onClick={onLaunchpad}
          style={{ background: "#1a1a26", color: "#6ab04c", padding: "4px 6px", fontSize: 9, cursor: "pointer", border: "none" }}
        >
          LAUNCHPAD
        </button>
      </div>
    </div>
  );
}
