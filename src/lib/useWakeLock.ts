"use client";

// Screen Wake Lock — keeps the display awake while an agent run is streaming
// so a phone doesn't dim/lock mid-mission. Mobile-exclusive value (desktops
// don't sleep on a timer the same way). Pass `active=true` while a run is in
// flight; the hook acquires the lock and auto-reacquires it if the tab is
// backgrounded and returns to the foreground (the browser drops the lock on
// visibility change). No-ops where the API is unsupported (e.g. iOS < 16.4).

import { useEffect, useRef } from "react";

type WakeLockSentinelLike = { release: () => Promise<void>; released?: boolean };
type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
};

export function useWakeLock(active: boolean): void {
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    if (!active) return;
    if (typeof navigator === "undefined") return;
    const nav = navigator as WakeLockNavigator;
    if (!nav.wakeLock) return;

    let cancelled = false;

    const acquire = async () => {
      try {
        const s = await nav.wakeLock!.request("screen");
        if (cancelled) {
          void s.release();
          return;
        }
        sentinelRef.current = s;
      } catch {
        /* denied or unsupported — silently skip */
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible" && active && !sentinelRef.current?.released) {
        void acquire();
      }
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      const s = sentinelRef.current;
      sentinelRef.current = null;
      if (s) void s.release().catch(() => {});
    };
  }, [active]);
}
