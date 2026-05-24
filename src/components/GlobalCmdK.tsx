"use client";
import { useEffect, useState } from "react";
import { CommandPalette, type Command } from "@/components/os/CommandPalette";
import { useRouter } from "next/navigation";

// Site-wide ⌘K palette. Mounted in app/layout.
// Auto-disables when /os is the active route — that page already mounts its own with richer commands.

const ROUTES: Array<{ id: string; label: string; hint: string; href: string; icon: string }> = [
  { id: "os", label: "Open DelOS", hint: "browser-OS desktop", href: "/os", icon: "Monitor" },
  { id: "play", label: "Run Chaos Demo", hint: "chaos engineering with live trace", href: "/play", icon: "PlayCircle" },
  { id: "arena", label: "Open Arena", hint: "3-model battle royale", href: "/arena", icon: "Swords" },
  { id: "live", label: "Open Live Feed", hint: "real-time run dashboard", href: "/live", icon: "Activity" },
  { id: "memory", label: "Browse Memory", hint: "HydraDB graph + local fallback", href: "/memory", icon: "Database" },
  { id: "scorecard", label: "Open Scorecard", hint: "hackathon rubric self-grade", href: "/scorecard", icon: "ClipboardCheck" },
  { id: "leaderboard", label: "Open Leaderboard", hint: "cheapest os-builder runs", href: "/leaderboard", icon: "Trophy" },
  { id: "extension", label: "Chrome Extension", hint: "side panel install", href: "/extension", icon: "Chrome" },
  { id: "demo", label: "Open Canned Demo", hint: "offline-safe trace replay", href: "/demo", icon: "Film" },
  { id: "docs", label: "API Docs", hint: "every endpoint + event schema", href: "/docs", icon: "Book" },
  { id: "pricing", label: "Pricing", hint: "Free / Pro / Enterprise", href: "/pricing", icon: "DollarSign" },
  { id: "status", label: "Status", hint: "uptime probes", href: "/status", icon: "Heart" },
  { id: "home", label: "Home", hint: "landing", href: "/", icon: "Home" },
];

export function GlobalCmdK() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(true);

  useEffect(() => {
    // Don't double-bind when /os is mounted (it has its own palette)
    if (typeof window !== "undefined" && window.location.pathname.startsWith("/os")) {
      setActive(false);
      return;
    }
    function onKey(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!active) return null;

  const commands: Command[] = ROUTES.map((r) => ({
    id: r.id,
    label: r.label,
    hint: r.hint,
    icon: r.icon,
    section: r.href.startsWith("/api") ? "API" : "Navigate",
    run: () => router.push(r.href),
  }));

  return <CommandPalette open={open} onClose={() => setOpen(false)} commands={commands} />;
}
