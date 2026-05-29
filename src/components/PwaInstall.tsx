"use client";

// PWA install affordance — global, mounted once in the root layout.
//
//   • Chromium/Android/desktop: captures `beforeinstallprompt`, shows a
//     dismissible banner with a one-tap Install button.
//   • iOS Safari: never fires beforeinstallprompt, so we show a gentle
//     "Add to Home Screen" hint with the exact steps instead.
//   • Already installed (standalone): renders nothing.
//   • Other surfaces can trigger it imperatively by dispatching
//     `window.dispatchEvent(new Event("delos-install"))` (used by the
//     landing-page "Install App" CTA).
//
// Dismissals are remembered for DISMISS_DAYS so we never nag.

import { useCallback, useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "delos.installDismissed";
const DISMISS_DAYS = 14;

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.matchMedia?.("(display-mode: minimal-ui)").matches ||
    // iOS Safari legacy flag
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const phone = /iphone|ipad|ipod/i.test(ua);
  // iPadOS 13+ masquerades as macOS — disambiguate via touch points.
  const iPadOS = /Macintosh/.test(ua) && (navigator as unknown as { maxTouchPoints?: number }).maxTouchPoints! > 1;
  return phone || iPadOS;
}

function dismissedRecently(): boolean {
  try {
    const v = localStorage.getItem(DISMISS_KEY);
    if (!v) return false;
    return Date.now() - Number(v) < DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

export function PwaInstall() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [banner, setBanner] = useState(false);
  const [iosSheet, setIosSheet] = useState(false);
  const [hidden, setHidden] = useState(false);

  const doInstall = useCallback(async () => {
    if (deferred) {
      try {
        await deferred.prompt();
        await deferred.userChoice;
      } catch {
        /* user dismissed or unsupported */
      }
      setDeferred(null);
      setBanner(false);
      return;
    }
    if (isIOS()) setIosSheet(true);
  }, [deferred]);

  useEffect(() => {
    if (isStandalone()) {
      // Client-only detection after hydration — already installed, so render
      // nothing. Intentional mount sync.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHidden(true);
      return;
    }

    function onBIP(e: Event) {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      if (!dismissedRecently()) setBanner(true);
    }
    function onInstalled() {
      setHidden(true);
      setBanner(false);
      setIosSheet(false);
      setDeferred(null);
    }

    window.addEventListener("beforeinstallprompt", onBIP);
    window.addEventListener("appinstalled", onInstalled);

    // iOS: no install event — surface the hint banner after first paint.
    let t: ReturnType<typeof setTimeout> | undefined;
    if (isIOS() && !dismissedRecently()) {
      t = setTimeout(() => setBanner(true), 2800);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBIP);
      window.removeEventListener("appinstalled", onInstalled);
      if (t) clearTimeout(t);
    };
  }, []);

  // Imperative trigger from other surfaces (landing CTA, /install page).
  useEffect(() => {
    function onReq() {
      if (deferred) void doInstall();
      else if (isIOS()) setIosSheet(true);
      else setBanner(true);
    }
    window.addEventListener("delos-install", onReq);
    return () => window.removeEventListener("delos-install", onReq);
  }, [deferred, doInstall]);

  function dismiss() {
    setBanner(false);
    setIosSheet(false);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* private mode */
    }
  }

  if (hidden) return null;

  const showIos = iosSheet || (banner && isIOS());

  return (
    <>
      {/* iOS Add-to-Home-Screen sheet */}
      {showIos && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Install DelOS"
          onClick={dismiss}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10000,
            background: "rgba(7,7,16,0.72)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            paddingBottom: "max(20px, env(safe-area-inset-bottom))",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(440px, 94vw)",
              background: "#15151f",
              border: "1px solid #2a2a3a",
              borderRadius: 18,
              padding: "20px 20px 22px",
              color: "#f4f4f5",
              fontFamily: "var(--font-mono-google, ui-monospace), monospace",
              boxShadow: "0 -10px 40px rgba(0,0,0,0.5)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icon.svg" alt="" width={40} height={40} style={{ borderRadius: 10, imageRendering: "pixelated" }} />
              <div>
                <div style={{ fontWeight: 700, color: "#fbc531", letterSpacing: "0.03em" }}>Install DelOS</div>
                <div style={{ fontSize: 12, color: "#a1a1aa" }}>Full-screen app · home-screen icon</div>
              </div>
            </div>
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.9, color: "#d4d4d8" }}>
              <li>Tap the <strong style={{ color: "#fbc531" }}>Share</strong> button in Safari&apos;s toolbar.</li>
              <li>Scroll and choose <strong style={{ color: "#fbc531" }}>Add to Home Screen</strong>.</li>
              <li>Tap <strong style={{ color: "#fbc531" }}>Add</strong> — DelOS launches like a native app.</li>
            </ol>
            <button
              onClick={dismiss}
              style={{
                marginTop: 18,
                width: "100%",
                minHeight: 44,
                border: 0,
                borderRadius: 10,
                background: "#fbc531",
                color: "#1b1b2e",
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {/* Chromium/desktop install banner */}
      {banner && !showIos && (
        <div
          style={{
            position: "fixed",
            left: "50%",
            transform: "translateX(-50%)",
            bottom: "max(16px, env(safe-area-inset-bottom))",
            zIndex: 9999,
            width: "min(460px, calc(100vw - 24px))",
            display: "flex",
            alignItems: "center",
            gap: 12,
            background: "#15151f",
            border: "1px solid #2a2a3a",
            borderRadius: 14,
            padding: "12px 12px 12px 14px",
            color: "#f4f4f5",
            fontFamily: "var(--font-mono-google, ui-monospace), monospace",
            boxShadow: "0 8px 30px rgba(0,0,0,0.45)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" width={34} height={34} style={{ borderRadius: 8, imageRendering: "pixelated", flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#fbc531" }}>Install DelOS</div>
            <div style={{ fontSize: 11, color: "#a1a1aa" }}>Add to your home screen — full-screen, offline-ready.</div>
          </div>
          <button
            onClick={doInstall}
            style={{
              minHeight: 40,
              padding: "0 14px",
              border: 0,
              borderRadius: 9,
              background: "#fbc531",
              color: "#1b1b2e",
              fontWeight: 700,
              fontSize: 12,
              cursor: "pointer",
              fontFamily: "inherit",
              flexShrink: 0,
            }}
          >
            Install
          </button>
          <button
            onClick={dismiss}
            aria-label="Dismiss"
            style={{
              width: 40,
              height: 40,
              border: 0,
              borderRadius: 9,
              background: "transparent",
              color: "#71717a",
              fontSize: 18,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
