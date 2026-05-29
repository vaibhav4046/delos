"use client";

// Install-app CTA. Dispatches the global `delos-install` event that the
// always-mounted <PwaInstall> listens for — which then fires the native
// Chromium install prompt, or surfaces the iOS "Add to Home Screen" sheet.
// Renders nothing once DelOS is already running as an installed app, so the
// button is never a dead end inside the standalone PWA.

import { useEffect, useState } from "react";
import { haptic } from "@/lib/mobile";

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.matchMedia?.("(display-mode: minimal-ui)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function InstallButton({
  className = "btn-pixel",
  style,
  label = "⬇ INSTALL APP",
}: {
  className?: string;
  style?: React.CSSProperties;
  label?: string;
}) {
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    // Client-only capability detection after hydration — intentional mount
    // sync (kept false on the server to avoid a hydration mismatch).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInstalled(isStandalone());
    const onInstalled = () => setInstalled(true);
    window.addEventListener("appinstalled", onInstalled);
    return () => window.removeEventListener("appinstalled", onInstalled);
  }, []);

  if (installed) return null;

  return (
    <button
      type="button"
      className={className}
      style={style}
      onClick={() => {
        haptic("tap");
        window.dispatchEvent(new Event("delos-install"));
      }}
    >
      {label}
    </button>
  );
}
