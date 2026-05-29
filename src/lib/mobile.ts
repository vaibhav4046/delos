// Mobile-exclusive capabilities — thin, SSR-safe wrappers around device APIs
// that only exist (or only matter) on phones/tablets. Every function degrades
// to a no-op on unsupported platforms so callers never need to feature-detect.

export function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(pointer: coarse)").matches || "ontouchstart" in window;
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.matchMedia?.("(display-mode: minimal-ui)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

// ---- Haptics --------------------------------------------------------------
// Short, tasteful vibrations on key OS interactions. Only fires on touch
// hardware that supports the Vibration API (Android Chrome, some others;
// iOS Safari ignores it, which is fine — it's purely additive feedback).

export type HapticKind = "tap" | "soft" | "success" | "warn" | "error";

const PATTERNS: Record<HapticKind, number | number[]> = {
  tap: 8,
  soft: 4,
  success: [10, 40, 10],
  warn: [20, 60, 20],
  error: [40, 30, 40, 30, 40],
};

export function haptic(kind: HapticKind = "tap"): void {
  if (typeof navigator === "undefined") return;
  if (!isTouchDevice()) return; // don't buzz desktops with a touchscreen-less vibrate
  try {
    navigator.vibrate?.(PATTERNS[kind]);
  } catch {
    /* unsupported — no-op */
  }
}

// ---- Native share ---------------------------------------------------------
// Web Share API → the OS share sheet (mobile-exclusive UX). Falls back to
// clipboard copy on desktop/unsupported so the action is never a dead end.

export function canNativeShare(): boolean {
  if (typeof navigator === "undefined") return false;
  return typeof navigator.share === "function";
}

export type ShareResult = "shared" | "copied" | "failed";

export async function shareContent(data: {
  title?: string;
  text?: string;
  url?: string;
}): Promise<ShareResult> {
  // Native sheet first.
  if (canNativeShare()) {
    try {
      await navigator.share(data);
      return "shared";
    } catch (e) {
      // AbortError = user cancelled the sheet — treat as a clean no-op.
      if (e instanceof DOMException && e.name === "AbortError") return "failed";
      // fall through to clipboard
    }
  }
  // Clipboard fallback.
  try {
    const blob = [data.title, data.text, data.url].filter(Boolean).join("\n");
    if (blob && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(blob);
      return "copied";
    }
  } catch {
    /* ignore */
  }
  return "failed";
}
