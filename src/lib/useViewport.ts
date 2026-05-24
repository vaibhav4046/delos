"use client";
import { useEffect, useState } from "react";

// Single source of truth for "are we on a phone, tablet, or desktop right now."
// Returns flags + raw width so callers can branch render logic.
//
// Breakpoints chosen to align with Tailwind defaults:
//   mobile  < 640px   (sm)
//   tablet  640–1023  (md/lg)
//   desktop ≥ 1024    (lg+)
//
// On the server (no window) returns desktop defaults so SSR renders the full
// experience and the mobile override kicks in after hydration. Acceptable —
// the layout shifts gracefully because everything is CSS-driven downstream.

export type Viewport = {
  width: number;
  height: number;
  mobile: boolean;
  tablet: boolean;
  desktop: boolean;
  /** True when device exposes coarse pointer (finger). */
  touch: boolean;
};

export function useViewport(): Viewport {
  const [vp, setVp] = useState<Viewport>(() => {
    if (typeof window === "undefined") {
      return { width: 1440, height: 900, mobile: false, tablet: false, desktop: true, touch: false };
    }
    return measure();
  });

  useEffect(() => {
    function onResize() {
      setVp(measure());
    }
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  return vp;
}

function measure(): Viewport {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const touch = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  return {
    width: w,
    height: h,
    mobile: w < 640,
    tablet: w >= 640 && w < 1024,
    desktop: w >= 1024,
    touch,
  };
}
