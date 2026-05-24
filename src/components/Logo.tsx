// DelOS logo — clean wordmark only.
// No chip, no Δ glyph. Just text with accent dot. Reads on every wallpaper + every theme.

import type { CSSProperties } from "react";

export function Logo({
  size = 40,
  className,
  withText = true,
}: {
  size?: number;
  className?: string;
  withText?: boolean;
}) {
  if (!withText) return <LogoMark size={size} />;
  const fontSize = Math.round(size * 0.7);
  return (
    <span
      className={`delos-logo inline-flex items-baseline gap-1 ${className ?? ""}`}
      style={{ lineHeight: 1 }}
    >
      <span
        className="font-pixel tracking-wider"
        style={{
          fontSize,
          color: "var(--fg)",
          letterSpacing: "0.04em",
          lineHeight: 1,
          whiteSpace: "nowrap",
          fontWeight: 800,
          textShadow:
            "0 1px 0 var(--shadow), 0 2px 4px rgba(0,0,0,0.45), 0 0 12px rgba(0,0,0,0.35)",
        }}
      >
        Del<span style={{ color: "var(--accent)" }}>OS</span>
      </span>
      <span
        aria-hidden
        style={{
          width: Math.round(fontSize * 0.18),
          height: Math.round(fontSize * 0.18),
          background: "var(--success)",
          borderRadius: 0,
          marginBottom: Math.round(fontSize * 0.08),
          boxShadow: `0 0 ${Math.round(fontSize * 0.3)}px var(--success)`,
        }}
      />
    </span>
  );
}

// Compact mark for favicons / dock / chips — minimal accent square with bold pixel "D".
export function LogoMark({ size = 32, style }: { size?: number; style?: CSSProperties }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="DelOS"
      shapeRendering="crispEdges"
      style={{
        filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.4))",
        ...style,
      }}
    >
      {/* Accent block */}
      <rect x="2" y="2" width="28" height="28" fill="var(--accent)" />
      {/* Inner shadow border */}
      <rect x="2" y="2" width="28" height="3" fill="rgba(255,255,255,0.2)" />
      <rect x="2" y="27" width="28" height="3" fill="rgba(0,0,0,0.2)" />
      {/* Pixel D shape */}
      <g fill="var(--on-accent)">
        <rect x="8" y="8" width="3" height="16" />
        <rect x="8" y="8" width="10" height="3" />
        <rect x="8" y="21" width="10" height="3" />
        <rect x="18" y="11" width="3" height="10" />
        <rect x="21" y="13" width="2" height="6" />
      </g>
      {/* Status dot */}
      <rect x="24" y="6" width="3" height="3" fill="var(--success)" />
    </svg>
  );
}

export function Wordmark({
  className,
  size = 32,
}: {
  className?: string;
  size?: number;
}) {
  return <Logo size={size} withText className={className} />;
}
