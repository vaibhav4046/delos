"use client";
import { useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import Link from "next/link";
import * as Icons from "lucide-react";
import { Boot } from "@/components/os/Boot";
import * as BrandIcons from "@/components/BrandIcons";
import { Window, type WindowChild, type SnapKind } from "@/components/os/Window";
import { ToastStack, type ToastItem } from "@/components/os/Toast";
import { Logo } from "@/components/Logo";
// Core apps kept eager — they're on the hot path (Terminal opens from
// the demo tour, AppBuilder is the headline killer feature). Everything
// else is lazy so the /os initial chunk drops dramatically. QA caught
// the chunk pushing ~5s on cold load before this change.
import { Terminal, MissionControl, NotesApp, AppBuilder, AboutApp } from "@/components/os/systemApps";
import { useNotifBridge, useUnreadCount } from "@/lib/notifications";
import { SettingsApp } from "@/components/os/SettingsApp";
// CohortApp import removed · cohort feature retired from product UI.
import { VoiceApp } from "@/components/os/VoiceApp";
import { DelAssistant } from "@/components/os/DelAssistant";
import { CalculatorApp, CalendarApp, FileExplorerApp, SystemInfoApp } from "@/components/os/UtilityApps";

// Heavy / rarely-launched-first apps · React.lazy code-split. Each one
// downloads only when a user actually launches it. Reduces /os initial
// JS by ~40% in practice.
const MarketplaceApp = lazy(() => import("@/components/os/MarketplaceApp").then((m) => ({ default: m.MarketplaceApp })));
const DoomGame = lazy(() => import("@/components/os/DoomGame").then((m) => ({ default: m.DoomGame })));
// Original retrofuturistic arcade · pixel platformer. No third-party assets.
const BourbonPalaceGame = lazy(() => import("@/components/os/BourbonPalaceGame").then((m) => ({ default: m.BourbonPalaceGame })));
// Original short story game · CRT text adventure with SVG portraits.
const NeonOriginGame = lazy(() => import("@/components/os/NeonOriginGame").then((m) => ({ default: m.NeonOriginGame })));
// CoworkApp lazy import removed · DelAssistant absorbs autonomous mode.
const BrowserApp = lazy(() => import("@/components/os/BrowserApp").then((m) => ({ default: m.BrowserApp })));
const SnakeGame = lazy(() => import("@/components/os/Games").then((m) => ({ default: m.SnakeGame })));
const TicTacToeGame = lazy(() => import("@/components/os/Games").then((m) => ({ default: m.TicTacToeGame })));
const MemoryMatchGame = lazy(() => import("@/components/os/Games").then((m) => ({ default: m.MemoryMatchGame })));
const MinesweeperGame = lazy(() => import("@/components/os/Games").then((m) => ({ default: m.MinesweeperGame })));
const Game2048 = lazy(() => import("@/components/os/Games").then((m) => ({ default: m.Game2048 })));
const AnalyticsApp = lazy(() => import("@/components/os/AnalyticsApp").then((m) => ({ default: m.AnalyticsApp })));
const IdentityApp = lazy(() => import("@/components/os/IdentityApp").then((m) => ({ default: m.IdentityApp })));
const CoresApp = lazy(() => import("@/components/os/CoresApp").then((m) => ({ default: m.CoresApp })));
// DelCode · manual multi-file IDE replacing the old LLM-codegen Codebase.
const DelCodeApp = lazy(() => import("@/components/os/DelCodeApp").then((m) => ({ default: m.DelCodeApp })));
const IngestApp = lazy(() => import("@/components/os/IngestApp").then((m) => ({ default: m.IngestApp })));
const OssLibraryApp = lazy(() => import("@/components/os/OssLibraryApp").then((m) => ({ default: m.OssLibraryApp })));
// Memory Browser · sleek interactive memory dashboard. Distinct from
// the Memory Match game (which keeps the "memory" key). 2026-05-25.
const MemoryBrowserApp = lazy(() => import("@/components/os/MemoryBrowserApp").then((m) => ({ default: m.MemoryBrowserApp })));
const NotificationCenter = lazy(() => import("@/components/os/NotificationCenter").then((m) => ({ default: m.NotificationCenter })));
const ScheduleApp = lazy(() => import("@/components/os/ScheduleApp").then((m) => ({ default: m.ScheduleApp })));
const WidgetsApp = lazy(() => import("@/components/os/WidgetsApp").then((m) => ({ default: m.WidgetsApp })));
import { ScheduleTicker } from "@/components/os/ScheduleTicker";
import { ReminderEngine } from "@/components/os/ReminderEngine";
import { ShortcutsSticky } from "@/components/os/ShortcutsSticky";

// Mini-shell that wraps a lazy app in a Suspense boundary with a tiny
// shimmer placeholder. Without this React would throw "rendered a
// promise" once a lazy component is mounted inside a Window.
function L({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <Suspense
      fallback={
        <div
          style={{
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "ui-monospace, monospace",
            fontSize: 11,
            color: "var(--muted)",
            opacity: 0.8,
          }}
        >
          loading {label ?? "app"}…
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
import { useCursor } from "@/lib/useCursor";
import { CommandPalette, type Command } from "@/components/os/CommandPalette";
import { ShortcutsModal } from "@/components/os/ShortcutsModal";
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
    label: "VibeCode",
    icon: "Sparkles",
    // Renamed from "App Builder" → "VibeCode" (proper vibe-coding platform
    // branding). Same underlying AppBuilder component + clone pipeline.
    // Wider default · 1040x640 leaves room for the inline DelCode pane
    // that appears when productionMode + a build is live. Previously
    // 520x540 was too narrow for split-view + the user had to launch
    // DelCode as a separate window.
    spawn: () => ({ id: "builder", title: "VibeCode · vibe-coding platform", icon: "Sparkles", width: 1040, height: 640, content: <BuilderSlot /> }),
  },
  codebase: {
    id: "codebase",
    label: "DelCode",
    icon: "Code2",
    // Was the LLM-driven CodebaseApp; the user wanted a real manual IDE
    // (file tree + tabs + editor + integrated terminal + language libs).
    // CodebaseApp stays in the bundle as a fallback for the codegen path
    // but the dock entry now opens DelCode.
    spawn: () => ({ id: "codebase", title: "DelCode · IDE", icon: "Code2", width: 820, height: 580, content: <L label="DelCode"><DelCodeApp /></L> }),
  },
  // Cohort + Cowork removed from product per user request 2026-05-25.
  // DelAssistant absorbs both (autonomous MCP actions for Gmail / Notion
  // / GitHub / GDrive + chat). Entries deleted from SYSTEM_APPS so any
  // stray references throw a clear error instead of silently spawning
  // a deprecated surface.
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
    spawn: () => ({ id: "analytics", title: "Analytics", icon: "BarChart3", width: 460, height: 540, content: <L label="analytics"><AnalyticsApp /></L> }),
  },
  doom: {
    id: "doom",
    label: "DelDoom",
    icon: "Flame",
    spawn: () => ({ id: "doom", title: "DelDoom", icon: "Flame", width: 520, height: 380, content: <L label="doom"><DoomGame /></L> }),
  },
  bourbon: {
    id: "bourbon",
    label: "Bourbon Palace",
    icon: "Crown",
    spawn: () => ({ id: "bourbon", title: "Bourbon Palace · Retrofuturistic", icon: "Crown", width: 720, height: 480, content: <L label="bourbon palace"><BourbonPalaceGame /></L> }),
  },
  neon: {
    id: "neon",
    label: "Neon Origin",
    icon: "Sparkle",
    spawn: () => ({ id: "neon", title: "Neon Origin · Story", icon: "Sparkle", width: 620, height: 460, content: <L label="neon origin"><NeonOriginGame /></L> }),
  },
  browser: {
    id: "browser",
    label: "Browser",
    icon: "Globe",
    spawn: () => ({ id: "browser", title: "Browser", icon: "Globe", width: 800, height: 600, content: <L label="browser"><BrowserApp /></L> }),
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
    spawn: () => ({ id: "marketplace", title: "Power-Ups Marketplace", icon: "Wrench", width: 540, height: 520, content: <L label="marketplace"><MarketplaceApp /></L> }),
  },
  oss: {
    id: "oss",
    label: "OSS Library",
    icon: "LibraryBig",
    spawn: () => ({ id: "oss", title: "OSS Library", icon: "LibraryBig", width: 560, height: 600, content: <L label="oss"><OssLibraryApp /></L> }),
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
    spawn: () => ({ id: "snake", title: "Snake", icon: "Worm", width: 380, height: 480, content: <L label="snake"><SnakeGame /></L> }),
  },
  tictactoe: {
    id: "tictactoe",
    label: "Tic-Tac-Toe",
    icon: "Hash",
    spawn: () => ({ id: "tictactoe", title: "Tic-Tac-Toe", icon: "Hash", width: 280, height: 360, content: <L label="tic-tac-toe"><TicTacToeGame /></L> }),
  },
  memory: {
    id: "memory",
    label: "Memory Match",
    icon: "Brain",
    spawn: () => ({ id: "memory", title: "Memory Match", icon: "Brain", width: 320, height: 420, content: <L label="memory match"><MemoryMatchGame /></L> }),
  },
  memoryBrowser: {
    id: "memoryBrowser",
    label: "Memory Browser",
    icon: "Database",
    spawn: () => ({
      id: "memoryBrowser",
      title: "Memory · Save State",
      icon: "Database",
      width: 720,
      height: 560,
      content: <L label="memory browser"><MemoryBrowserApp /></L>,
    }),
  },
  notifications: {
    id: "notifications",
    label: "Notifications",
    icon: "Bell",
    spawn: () => ({
      id: "notifications",
      title: "Notifications",
      icon: "Bell",
      width: 460,
      height: 540,
      content: <L label="notifications"><NotificationCenter /></L>,
    }),
  },
  schedule: {
    id: "schedule",
    label: "Schedule",
    icon: "CalendarClock",
    spawn: () => ({
      id: "schedule",
      title: "Scheduled Actions",
      icon: "CalendarClock",
      width: 540,
      height: 560,
      content: <L label="schedule"><ScheduleApp /></L>,
    }),
  },
  widgets: {
    id: "widgets",
    label: "Widgets",
    icon: "LayoutDashboard",
    spawn: () => ({
      id: "widgets",
      title: "Widgets · Clock · Reminders",
      icon: "LayoutDashboard",
      width: 420,
      height: 620,
      content: <L label="widgets"><WidgetsApp /></L>,
    }),
  },
  minesweeper: {
    id: "minesweeper",
    label: "Minesweeper",
    icon: "Bomb",
    spawn: () => ({ id: "minesweeper", title: "Minesweeper", icon: "Bomb", width: 360, height: 440, content: <L label="minesweeper"><MinesweeperGame /></L> }),
  },
  game2048: {
    id: "game2048",
    label: "2048",
    icon: "Grid3x3",
    spawn: () => ({ id: "game2048", title: "2048", icon: "Grid3x3", width: 360, height: 460, content: <L label="2048"><Game2048 /></L> }),
  },
  identity: {
    id: "identity",
    label: "Identity",
    icon: "User",
    spawn: () => ({ id: "identity", title: "~/IDENTITY.md", icon: "User", width: 560, height: 580, content: <L label="identity"><IdentityApp /></L> }),
  },
  cores: {
    id: "cores",
    label: "Cores",
    icon: "Cpu",
    spawn: () => ({ id: "cores", title: "DevFactory · Cores", icon: "Cpu", width: 520, height: 520, content: <L label="cores"><CoresApp /></L> }),
  },
  ingest: {
    id: "ingest",
    label: "Ingest",
    icon: "HardDrive",
    spawn: () => ({ id: "ingest", title: "Ingestion Hub", icon: "HardDrive", width: 580, height: 640, content: <L label="ingest"><IngestApp /></L> }),
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
            Battle royale opens in a new tab so multiple agent lanes have room to race.
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
  const [booted, setBooted] = useState(true);
  const [windows, setWindows] = useState<WState[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [launchpadOpen, setLaunchpadOpen] = useState(false);
  // Notification system · bridge toasts into persistent notif store and
  // expose unread counter for the dock badge.
  useNotifBridge();
  const unreadNotifs = useUnreadCount();
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
  // Start above the dock's z=100 so a focused window always wins
  // pointer hits over the dock icon strip. Previously focused windows
  // only beat the dock after ~90 focus events, so a click on a BUILD
  // button near the dock area routed to the dock icon (Identity)
  // instead of the window. 2026-05-25 brutal-QA P0.
  const zCounter = useRef(120);
  const spawnOffset = useRef(0);
  // Was `useState(new Date())` — SSR snapshot frozen at build, client
  // rehydrates with a fresh Date → text mismatch → React error #418. Start
  // null on both sides, populate after mount.
  const [now, setNow] = useState<Date | null>(null);
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
    fetch("/api/me?profile=full", { credentials: "include" })
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
    setNow(new Date());
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

  // Clamp a spawn rect so the window fits inside the viewport · ensures the
  // bottom-right resize handle is never below the dock or off-screen. Was
  // a hard-to-debug user complaint: large clone windows (880×620) spawned
  // at y=90 went past the visible area on 1568×662 viewports, so the SE
  // resize handle was clipped and "resize felt broken".
  function fitToViewport(rect: { x: number; y: number; width: number; height: number }) {
    const TOP = 48;
    const DOCK = 64;
    const margin = 12;
    // Use live window.innerWidth/Height · React state viewport may still
    // be the initial 1600×900 default at the moment a spec window spawns
    // (because the resize effect hasn't fired its first commit yet).
    // Reading direct from the DOM avoids that race.
    const vw = typeof window !== "undefined" ? window.innerWidth : viewport.width;
    const vh = typeof window !== "undefined" ? window.innerHeight : viewport.height;
    const maxW = Math.max(280, vw - margin * 2);
    const maxH = Math.max(180, vh - TOP - DOCK - margin);
    const w = Math.min(rect.width, maxW);
    const h = Math.min(rect.height, maxH);
    const x = Math.max(margin, Math.min(rect.x, vw - w - margin));
    const y = Math.max(TOP + margin, Math.min(rect.y, vh - DOCK - h - margin));
    return { x, y, width: w, height: h };
  }

  function spawnSystemApp(key: string) {
    const tpl = SYSTEM_APPS[key];
    if (!tpl) return;
    // Auto-dismiss tutorial sticky on first window open · QA report
    // flagged the sticky as "unremovable" because new users opened apps
    // before noticing the small X. Now opening any app dismisses it
    // for good (localStorage persisted).
    if (!hintsDismissed) dismissHints();
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
      const fit = fitToViewport({ x: 80 + offset, y: 80 + offset, width: base.width, height: base.height });
      const win: WState = { ...base, ...fit, z: zCounter.current, refreshKey: 0 };
      setFocusedId(win.id);
      return [...prev, win];
    });
    pushToast(`launched ${tpl.label}`, "info");
  }

  function runDemoTour() {
    // Autonomous hackathon demo — one click drives the whole stack:
    //   1. Open Del Assistant
    //   2. Fire Gmail draft via MCP autonomous pattern
    //   3. Fire Notion create-page via MCP autonomous pattern
    //   4. Fire GitHub list via MCP autonomous pattern
    //   5. Open VibeCode + build an investor CRM in place
    //   6. Open Mission Control + recall pinned facts
    // Each step narrates with a toast so the judge sees what fires when.
    // Gmail + Notion gracefully degrade to "connect via Settings" if no
    // OAuth, but the path proves out end-to-end.
    type Step = { delay: number; toast: string; run: () => void };
    const steps: Step[] = [
      {
        delay: 0,
        toast: "★ demo 1/6 · DEL ASSISTANT — autonomous brain online",
        run: () => spawnSystemApp("assistant"),
      },
      {
        delay: 2200,
        toast: "★ demo 2/6 · GMAIL MCP — drafting an email…",
        run: () =>
          emitIntent({
            kind: "assistant.ask",
            text: "draft email to judges@delrio.app about hackathon final demo recap",
          }),
      },
      {
        delay: 7000,
        toast: "★ demo 3/6 · NOTION MCP — creating a recap page…",
        run: () =>
          emitIntent({
            kind: "assistant.ask",
            text: "create notion page titled DelOS Hackathon Demo Recap",
          }),
      },
      {
        delay: 11500,
        toast: "★ demo 4/6 · GITHUB MCP — listing repositories…",
        run: () =>
          emitIntent({
            kind: "assistant.ask",
            text: "list my github repos",
          }),
      },
      {
        delay: 16500,
        toast: "★ demo 5/6 · VIBECODE — building an investor CRM…",
        run: () => {
          spawnSystemApp("builder");
          setTimeout(
            () =>
              emitIntent({
                kind: "builder.build",
                prompt:
                  "investor CRM platform with deal pipeline, portfolio tracking, and follow-up reminders",
              }),
            300,
          );
        },
      },
      {
        delay: 22000,
        toast: "★ demo 6/6 · MISSION CONTROL — recalling pinned memory",
        run: () => {
          spawnSystemApp("mission");
          setTimeout(
            () =>
              emitIntent({
                kind: "memory.search",
                query: "demo recap and investor CRM",
              }),
            300,
          );
        },
      },
    ];
    for (const s of steps) {
      setTimeout(() => {
        s.run();
        pushToast(s.toast, "ok");
      }, s.delay);
    }
  }

  function spawnSpecWindow(spec: AppSpec) {
    setWindows((prev) => {
      // Refine detection · if an existing window already hosts this
      // spec.id, replace its content IN PLACE rather than spawning a
      // duplicate window. Was the 2026-05-25 brutal-QA "refine builds
      // different tab" P0 — every refine call dispatched spawn-spec
      // again and we minted a fresh `spec-<id>-<ts>` window each time.
      const prefix = `spec-${spec.id}-`;
      const candidates = prev.filter((w) => w.id.startsWith(prefix));
      const existing = candidates[candidates.length - 1];
      if (existing) {
        zCounter.current += 1;
        const content = makeSpecContent(spec, existing.id);
        pushToast(`✓ ${spec.name} refined`, "ok");
        setFocusedId(existing.id);
        return prev.map((w) =>
          w.id === existing.id
            ? {
                ...w,
                title: spec.name,
                icon: spec.icon,
                content,
                z: zCounter.current,
                minimized: false,
                refreshKey: (w.refreshKey ?? 0) + 1,
              }
            : w,
        );
      }
      zCounter.current += 1;
      const winId = `spec-${spec.id}-${Date.now()}`;
      const offset = spawnOffset.current * 24;
      spawnOffset.current = (spawnOffset.current + 1) % 8;
      const content = makeSpecContent(spec, winId);
      // Clamp clone spec windows (often 880×640) to the actual viewport so
      // the bottom-right resize handle is reachable on all screen sizes.
      const fit = fitToViewport({ x: 140 + offset, y: 90 + offset, width: spec.width, height: spec.height });
      const win: WState = {
        id: winId,
        title: spec.name,
        icon: spec.icon,
        ...fit,
        z: zCounter.current,
        content,
        refreshKey: 0,
      };
      setFocusedId(winId);
      return [...prev, win];
    });
    // Toast is emitted from inside the setter for refine; only show the
    // "installed" toast when we actually spawn a NEW window. Tracked via
    // a flag below.
    if (!windows.some((w) => w.id.startsWith(`spec-${spec.id}-`))) {
      pushToast(`★ ${spec.name} installed`, "ok");
    }
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
    // BUG-4 fix · map to NEW objects so React re-renders. Was mutating
    // existing references in-place; framer-motion saw same object identity
    // and skipped the position animation, so windows looked stacked.
    setWindows((p) => {
      let visIdx = 0;
      return p.map((w) => {
        if (w.minimized) return w;
        const i = visIdx++;
        const r = Math.floor(i / cols);
        const c = i % cols;
        return {
          ...w,
          x: c * cellW,
          y: TOP + r * cellH,
          width: cellW,
          height: cellH,
          maximized: false,
        };
      });
    });
    pushToast(`tiled ${n} window${n === 1 ? "" : "s"} into ${cols}×${rows} grid`, "info");
  }

  // Cascade — stack windows diagonally so each title bar is visible.
  function cascadeArrange() {
    const visible = windows.filter((w) => !w.minimized);
    if (visible.length === 0) return;
    const baseW = Math.min(720, viewport.width * 0.6);
    const baseH = Math.min(520, (viewport.height - 48 - 56) * 0.7);
    // BUG-4 sibling fix — same reference-identity fix as gridArrange.
    setWindows((p) => {
      let visIdx = 0;
      return p.map((w) => {
        if (w.minimized) return w;
        const i = visIdx++;
        return {
          ...w,
          x: 48 + i * 32,
          y: 64 + i * 32,
          width: baseW,
          height: baseH,
          maximized: false,
        };
      });
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
    function fireVoiceStep(step: { intent: VoiceAction["intent"]; app?: string; payload?: string }) {
      switch (step.intent) {
        case "open_app":
          if (step.app && SYSTEM_APPS[step.app]) spawnSystemApp(step.app);
          // When voice routes a Gmail/Notion/GitHub/GDrive MCP request
          // to the assistant, pipe the transcript into DelAssistant so
          // its client-side tryMcpAction fires the actual MCP call.
          // Was a 2026-05-25 judge finding · voice "draft email" opened
          // the assistant window but never forwarded the request body.
          if (step.app === "assistant" && step.payload) {
            setTimeout(() => emitIntent({ kind: "assistant.ask", text: step.payload! }), 250);
          }
          break;
        case "run_mission":
          spawnSystemApp("terminal");
          if (step.payload) setTimeout(() => emitIntent({ kind: "terminal.run", goal: step.payload! }), 250);
          break;
        case "build_app":
          spawnSystemApp("builder");
          if (step.payload) setTimeout(() => emitIntent({ kind: "builder.build", prompt: step.payload! }), 250);
          break;
        case "run_cohort":
          // Cohort UI removed · reroute to assistant so the user still
          // gets a multi-step answer. Assistant runs the same query via
          // its autonomous pipeline + MCP tools.
          spawnSystemApp("assistant");
          if (step.payload) setTimeout(() => emitIntent({ kind: "assistant.ask", text: step.payload! }), 250);
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
          if (step.payload) window.location.href = step.payload;
          break;
        case "answer":
        case "unknown":
        case "compound":
          // No-op for atomic steps; compound is handled by chain unrolling.
          break;
      }
    }
    function onVoiceAction(e: Event) {
      const a = (e as CustomEvent<VoiceAction>).detail;
      if (!a) return;
      // Compound chain — fire each step with a small stagger so window
      // mounts settle between actions. Caps at 4 steps (server-side cap
      // is the same) so a runaway chain can't spawn 20 windows.
      if (a.intent === "compound" && Array.isArray(a.chain) && a.chain.length > 0) {
        a.chain.slice(0, 4).forEach((step, i) => {
          setTimeout(() => fireVoiceStep(step), i * 350);
        });
        return;
      }
      fireVoiceStep({ intent: a.intent, app: a.app, payload: a.payload });
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
      // AI agents (4) · removed cohort + cowork — assistant absorbs autonomous
      // routing via MCP tool calls (Gmail / Notion / GitHub / GDrive) and the
      // cohort race UI no longer ships as a top-level surface.
      "assistant", "identity", "arena", "voice",
      // Builders (4)
      "builder", "codebase", "cores", "mission",
      // Tools (7) · memoryBrowser surfaces save-state across runs
      "memoryBrowser", "notifications", "schedule", "widgets", "ingest", "terminal", "browser", "marketplace", "oss", "analytics",
      // Files & notes (5)
      "files", "notes", "calendar", "calc", "sysinfo",
      // Games (6)
      "snake", "tictactoe", "memory", "minesweeper", "game2048", "doom", "bourbon", "neon",
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
      // Cycle through open windows · Cmd/Ctrl+Tab (forward) +
      // Cmd/Ctrl+Shift+Tab (backward). QA report 2026-05-25 flagged
      // "no taskbar or alt-tab equivalent". Focus the next visible
      // (non-minimized) window in z-order so multi-window flows stay
      // navigable from keyboard.
      if (isMod && e.key === "Tab") {
        e.preventDefault();
        setWindows((wins) => {
          const visible = wins.filter((w) => !w.minimized);
          if (visible.length === 0) return wins;
          // Sort by z to define a stable cycle order.
          const ordered = [...visible].sort((a, b) => a.z - b.z);
          const currentIdx = ordered.findIndex((w) => w.id === focusedId);
          const nextIdx = e.shiftKey
            ? (currentIdx <= 0 ? ordered.length - 1 : currentIdx - 1)
            : (currentIdx === -1 || currentIdx === ordered.length - 1 ? 0 : currentIdx + 1);
          const next = ordered[nextIdx];
          if (!next) return wins;
          zCounter.current += 1;
          const newZ = zCounter.current;
          setFocusedId(next.id);
          return wins.map((w) => (w.id === next.id ? { ...w, z: newZ, minimized: false } : w));
        });
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
      { id: "build-app", label: "Open VibeCode", hint: "vibe-code an app", icon: "Sparkles", section: "Action", run: () => spawnSystemApp("builder") },
      { id: "assistant-ask", label: "Ask Del Assistant", hint: "draft email · create Notion page · query GitHub", icon: "Sparkles", section: "Action", run: () => spawnSystemApp("assistant") },
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
          <ScheduleTicker />
          <ReminderEngine />
          <div
            className={`absolute inset-0 ${wallEntry.liveClass ?? (wallAnimated ? "wallpaper-animated" : "")}`}
            style={wallEntry.liveClass ? undefined : { background: wallCss }}
          />
          {wallEntry.video && (
            <>
              {/* Video wallpaper — muted, looping, blurred, no sound. Renders
                  behind everything else; gracefully falls back to gradient
                  if the file is missing (onError hides the element). */}
              <video
                key={wallEntry.id}
                src={wallEntry.video}
                autoPlay
                muted
                loop
                playsInline
                disablePictureInPicture
                className="absolute inset-0 w-full h-full"
                style={{
                  objectFit: "cover",
                  filter: `blur(${wallEntry.videoBlur ?? 12}px) brightness(0.7) saturate(1.1)`,
                  transform: "scale(1.08)", // crop the blurred edge so no halo bleeds in
                  pointerEvents: "none",
                  zIndex: 0,
                }}
                aria-hidden="true"
                onError={(e) => { (e.currentTarget as HTMLVideoElement).style.display = "none"; }}
              />
              {wallEntry.videoOverlay && (
                <div className="absolute inset-0" style={{ background: wallEntry.videoOverlay, pointerEvents: "none", zIndex: 1 }} />
              )}
            </>
          )}
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
              {/* Command palette opener — was floating top-right, now lives
                  inline so it stops fighting with the OPEN counter + clock
                  on narrow viewports. Keyboard shortcut unchanged (⌘K). */}
              <button
                onClick={() => setPaletteOpen(true)}
                className="pill pill-muted inline-flex items-center gap-1"
                title="Command palette (⌘K)"
                aria-label="Open command palette"
                style={{ cursor: "pointer", fontSize: 10 }}
              >
                <Icons.Command size={10} /> K
              </button>
              <span data-tour="hydradb" className="hidden sm:inline-flex pill pill-ok"><span className="w-2 h-2 inline-block accent-pulse" style={{ background: "var(--success)" }} /> HYDRADB</span>
              <button
                onClick={() => spawnSystemApp("notifications")}
                className="pill inline-flex items-center gap-1"
                style={{ background: unreadNotifs > 0 ? "var(--accent)" : "var(--surface)", color: unreadNotifs > 0 ? "var(--on-accent)" : "var(--fg)", border: "1px solid var(--surface-2)", cursor: "pointer", fontSize: 10 }}
                title={`${unreadNotifs} unread notifications`}
                aria-label="Notifications"
              >
                <Icons.Bell size={10} />
                {unreadNotifs > 0 && <span style={{ fontWeight: 700 }}>{unreadNotifs}</span>}
              </button>
              <span className="pill pill-info">{windows.filter((w) => !w.minimized).length} OPEN</span>
              <span suppressHydrationWarning className="font-pixel text-sm tracking-widest" style={{ color: "var(--fg)" }}>
                {now ? now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--:--:--"}
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
            <AgentPulse onOpen={() => spawnSystemApp("assistant")} />
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
              // Stay pinned while desktop is empty (Welcome mat) — onboarding
              // needs the app row visible. Once any window is open the dock
              // auto-hides and peek-reveals on cursor approach.
              autoHide={windows.filter((w) => !w.minimized).length > 0}
            />
          </div>

          {/* SH-1/SH-2 · floating + above dock removed (redundant with
              top-bar APPS pill, ⌘K palette, F4 launchpad). Sticky shortcuts
              note replaces it · always-visible, collapsible to pill, dismissible. */}
          <ShortcutsSticky />

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
            <ContextMenu x={ctxMenu.x} y={ctxMenu.y} onClose={() => setCtxMenu(null)} onPick={async (action) => {
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
              } else if (action === "copy") {
                // Use document.execCommand("copy") first — it correctly grabs
                // selected text from the currently-focused input/textarea
                // without needing clipboard permission. Falls back to
                // navigator.clipboard.writeText with the selection string.
                try {
                  const sel = String(window.getSelection() ?? "");
                  const ok = document.execCommand("copy");
                  if (!ok && sel && navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(sel);
                  }
                  pushToast(sel ? `copied ${sel.slice(0, 24)}` : "copy", "info");
                } catch (e) {
                  pushToast(`copy failed: ${(e as Error).message}`, "bad");
                }
              } else if (action === "cut") {
                try {
                  const sel = String(window.getSelection() ?? "");
                  document.execCommand("cut");
                  if (sel && navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(sel);
                  }
                  pushToast(sel ? `cut ${sel.slice(0, 24)}` : "cut", "info");
                } catch (e) {
                  pushToast(`cut failed: ${(e as Error).message}`, "bad");
                }
              } else if (action === "paste") {
                // execCommand("paste") is widely blocked for security; the
                // modern path is navigator.clipboard.readText. Dispatching
                // a `paste` event into the focused element lets controlled
                // inputs (React-controlled textarea/input) receive the
                // text without bypassing their onChange handler.
                try {
                  const txt = await navigator.clipboard.readText();
                  const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
                  if (el && ("value" in el)) {
                    const start = (el as HTMLInputElement).selectionStart ?? el.value.length;
                    const end = (el as HTMLInputElement).selectionEnd ?? el.value.length;
                    const next = el.value.slice(0, start) + txt + el.value.slice(end);
                    const setter = Object.getOwnPropertyDescriptor(
                      el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
                      "value",
                    )?.set;
                    if (setter) {
                      setter.call(el, next);
                      el.dispatchEvent(new Event("input", { bubbles: true }));
                    } else {
                      el.value = next;
                    }
                    pushToast(`pasted ${txt.length} chars`, "info");
                  } else {
                    pushToast(txt ? "clipboard ready · click an input to paste" : "clipboard empty", "warn");
                  }
                } catch (e) {
                  pushToast(`paste denied: ${(e as Error).message.slice(0, 40)}`, "bad");
                }
              } else if (action === "select-all") {
                try {
                  document.execCommand("selectAll");
                  pushToast("select all", "info");
                } catch (e) {
                  pushToast(`select failed: ${(e as Error).message}`, "bad");
                }
              }
              setCtxMenu(null);
            }} />
          )}

          {/* The floating ⌘K button used to live here (fixed top-14 right-3).
              Now lives in the header chip row to avoid overlap with desktop
              widgets. */}
        </>
      )}
    </div>
  );
}

function ContextMenu({ x, y, onClose, onPick }: { x: number; y: number; onClose: () => void; onPick: (action: string) => void }) {
  const items: Array<{ action: string; label: string; icon: string; section?: string; hint?: string }> = [
    // Clipboard ops at top · most-used and matches native OS menu order.
    { action: "copy",       label: "Copy",          icon: "Copy",         section: "Edit", hint: "⌘C" },
    { action: "cut",        label: "Cut",           icon: "Scissors",     section: "Edit", hint: "⌘X" },
    { action: "paste",      label: "Paste",         icon: "Clipboard",    section: "Edit", hint: "⌘V" },
    { action: "select-all", label: "Select All",    icon: "SquareDashedMousePointer", section: "Edit", hint: "⌘A" },
    { action: "terminal",   label: "New Terminal",  icon: "TerminalSquare", section: "New" },
    { action: "builder",    label: "New Agent App", icon: "Sparkles",     section: "New" },
    { action: "notes",      label: "New Notes",     icon: "BookOpen",     section: "New" },
    { action: "palette",    label: "Command Palette", icon: "Command",    section: "Tools", hint: "⌘K" },
    { action: "wallpaper",  label: "Cycle Wallpaper", icon: "Image",      section: "View" },
    { action: "refresh-all", label: "Refresh All Windows", icon: "RotateCw", section: "View" },
    { action: "close-all",  label: "Close All Windows", icon: "XCircle",  section: "View" },
    { action: "settings",   label: "Settings",      icon: "Settings",     section: "System" },
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
                <span style={{ flex: 1 }}>{it.label}</span>
                {it.hint && (
                  <span style={{ fontSize: 9, color: "var(--muted)", letterSpacing: "0.04em" }}>{it.hint}</span>
                )}
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
          style={{ color: "var(--wp-fg, var(--fg))" }}
        >
          WELCOME TO DEL<span style={{ color: "var(--accent)" }}>OS</span>
        </h1>
        <p
          className="font-mono text-[11px] sm:text-xs mt-3 max-w-md mx-auto wallpaper-text-shadow wall-readable"
          style={{ padding: "6px 12px", borderRadius: 4, display: "inline-block" }}
        >
          browser-OS · agents build apps · ⌘K palette · drag windows
        </p>
        <div className="mt-5 flex justify-center gap-2 flex-wrap">
          <button className="btn-pixel success" onClick={onDemo} title="Auto-launch a guided 4-app tour">▶ DEMO TOUR</button>
          <button className="btn-pixel" style={{ background: "var(--accent)", color: "var(--on-accent)" }} onClick={() => onLaunch("builder")}>★ BUILD APP</button>
          <button className="btn-pixel ghost" onClick={() => onLaunch("assistant")}>ASSISTANT</button>
          <button className="btn-pixel ghost" onClick={() => onLaunch("voice")}>VOICE</button>
        </div>

        <div className="mt-8 grid grid-cols-4 sm:grid-cols-6 gap-2 sm:gap-3 mx-auto">
          {featured.slice(0, 8).map((k) => {
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
                <span className="font-pixel text-[9px] tracking-wider" style={{ color: "var(--wp-fg, var(--fg))" }}>{a.label.toUpperCase()}</span>
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
    { label: "AI AGENTS",      ids: ["assistant", "identity", "arena", "voice"] },
    { label: "BUILDERS",       ids: ["builder", "codebase", "cores", "mission"] },
    { label: "TOOLS",          ids: ["memoryBrowser", "notifications", "schedule", "widgets", "ingest", "terminal", "browser", "marketplace", "analytics"] },
    { label: "FILES & NOTES",  ids: ["files", "notes", "calendar", "calc", "sysinfo"] },
    { label: "GAMES",          ids: ["bourbon", "neon", "snake", "tictactoe", "memory", "minesweeper", "game2048", "doom"] },
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
        // BUG-9 fix · sticky used to live bottom-right under FX widget +
        // Tile/Cascade/Launchpad chiclet row → bottom clipped. Move to
        // bottom-left so it stops fighting with the widget stack.
        left: 16,
        bottom: 80,
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
        <button
          onClick={onDismiss}
          aria-label="Dismiss hints"
          title="Dismiss this tutorial sticky · won't show again"
          style={{
            background: "#1a1a26",
            color: "#fbc531",
            padding: "3px 6px",
            cursor: "pointer",
            border: "none",
            fontSize: 11,
            fontWeight: 700,
            lineHeight: 1,
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <Icons.X size={11} /> CLOSE
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
