"use client";

// Pull-to-refresh — a mobile-exclusive gesture for the DelOS window shell.
// Touch only: on a fine pointer (mouse) the hook attaches nothing, so the
// desktop experience is completely untouched. Engages only when the scroll
// container is already at the top AND the finger drags down, so it never
// fights normal scrolling. Nested scrollers (a list inside the window that's
// mid-scroll) suppress the gesture so you don't yank a refresh while flicking
// through content.
//
// Returns { pull, refreshing } for rendering a spinner/affordance. `pull` is
// the damped pull distance in px (0 when idle); `refreshing` is true during
// the brief settle after a successful trigger.

import { useEffect, useRef, useState } from "react";

type Options = {
  /** px the finger must travel (after damping) to fire a refresh. */
  threshold?: number;
  /** max damped pull distance — caps the rubber-band. */
  max?: number;
  /** master switch; the hook is also internally gated to coarse pointers. */
  enabled?: boolean;
};

export function usePullToRefresh(
  ref: React.RefObject<HTMLElement | null>,
  onRefresh: () => void,
  opts: Options = {},
): { pull: number; refreshing: boolean } {
  const { threshold = 64, max = 96, enabled = true } = opts;
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Refs mirror state so the (once-attached) listeners read live values
  // without re-subscribing on every pointer move.
  const startY = useRef<number | null>(null);
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);
  const cbRef = useRef(onRefresh);
  // Keep the latest callback without re-subscribing the listeners. Synced in
  // an effect (not during render) so we never mutate a ref mid-render.
  useEffect(() => {
    cbRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    if (typeof window === "undefined") return;
    // Touch-only — never interfere with mouse/desktop scrolling.
    if (!window.matchMedia?.("(pointer: coarse)").matches) return;

    const setPullBoth = (v: number) => {
      pullRef.current = v;
      setPull(v);
    };

    // Walk from the touched node up to the scroll container; if anything in
    // between is itself scrolled away from its top, the user is interacting
    // with a nested list — leave the gesture alone.
    const nestedScrolled = (target: EventTarget | null): boolean => {
      let n = target as HTMLElement | null;
      while (n && n !== el) {
        if (n.scrollTop > 0) return true;
        n = n.parentElement;
      }
      return false;
    };

    const onStart = (e: TouchEvent) => {
      if (refreshingRef.current || e.touches.length !== 1) {
        startY.current = null;
        return;
      }
      if (el.scrollTop > 0 || nestedScrolled(e.target)) {
        startY.current = null;
        return;
      }
      startY.current = e.touches[0].clientY;
    };

    const onMove = (e: TouchEvent) => {
      if (startY.current == null || refreshingRef.current) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0 || el.scrollTop > 0) {
        if (pullRef.current) setPullBoth(0);
        return;
      }
      // We own this gesture now — stop the page rubber-band / scroll.
      e.preventDefault();
      setPullBoth(Math.min(max, dy * 0.5));
    };

    const onEnd = () => {
      if (startY.current == null) return;
      startY.current = null;
      if (pullRef.current >= threshold) {
        refreshingRef.current = true;
        setRefreshing(true);
        setPullBoth(threshold);
        window.setTimeout(() => {
          cbRef.current();
          refreshingRef.current = false;
          setRefreshing(false);
          setPullBoth(0);
        }, 450);
      } else {
        setPullBoth(0);
      }
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [ref, enabled, threshold, max]);

  return { pull, refreshing };
}
