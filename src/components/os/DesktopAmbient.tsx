"use client";
import { useMemo } from "react";

// Lightweight ambient sparkles / drifting dots — CSS animation only, low GPU cost.
export function DesktopAmbient({ density = 18 }: { density?: number }) {
  const dots = useMemo(
    () =>
      Array.from({ length: density }, (_, i) => ({
        x: (i * 53 + 17) % 100,
        y: (i * 31 + 7) % 100,
        size: 1 + ((i * 7) % 3),
        delay: (i % 6) * 0.7,
        which: i % 2 === 0 ? "twinkle" : "drift-slow",
      })),
    [density],
  );
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
      {dots.map((d, i) => (
        <span
          key={i}
          className={d.which}
          style={{
            position: "absolute",
            left: `${d.x}%`,
            top: `${d.y}%`,
            width: d.size,
            height: d.size,
            background: "var(--accent)",
            opacity: 0.18,
            borderRadius: 0,
            animationDelay: `${d.delay}s`,
          }}
        />
      ))}
    </div>
  );
}
