// Pixel-art renditions of brand marks — vector SVG, theme-aware fills.
// Used for Claude / ChatGPT / Perplexity in dock + chat headers.

export function ClaudeIcon({ size = 24, color = "currentColor" }: { size?: number; color?: string }) {
  // Pixel "C" with serif-like flare reminiscent of Claude brand
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" style={{ display: "block" }}>
      {/* Outer rounded squarish C */}
      <rect x="3" y="2" width="9" height="2" fill={color} />
      <rect x="2" y="3" width="2" height="2" fill={color} />
      <rect x="11" y="3" width="3" height="2" fill={color} />
      <rect x="2" y="5" width="2" height="6" fill={color} />
      <rect x="2" y="11" width="2" height="2" fill={color} />
      <rect x="3" y="12" width="9" height="2" fill={color} />
      <rect x="11" y="11" width="3" height="2" fill={color} />
      {/* Inner negative space — dot accent */}
      <rect x="9" y="7" width="2" height="2" fill={color} opacity="0.5" />
    </svg>
  );
}

export function ChatGPTIcon({ size = 24, color = "currentColor" }: { size?: number; color?: string }) {
  // Pixel knot — interlocking petals reminiscent of OpenAI mark
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" style={{ display: "block" }}>
      {/* Top petal */}
      <rect x="6" y="1" width="4" height="2" fill={color} />
      <rect x="5" y="2" width="6" height="2" fill={color} />
      {/* Right petal */}
      <rect x="11" y="4" width="2" height="6" fill={color} />
      <rect x="12" y="5" width="2" height="4" fill={color} />
      {/* Bottom petal */}
      <rect x="5" y="12" width="6" height="2" fill={color} />
      <rect x="6" y="13" width="4" height="2" fill={color} />
      {/* Left petal */}
      <rect x="3" y="4" width="2" height="6" fill={color} />
      <rect x="2" y="5" width="2" height="4" fill={color} />
      {/* Center void */}
      <rect x="7" y="7" width="2" height="2" fill={color} opacity="0.3" />
    </svg>
  );
}

export function PerplexityIcon({ size = 24, color = "currentColor" }: { size?: number; color?: string }) {
  // Pixel asterisk / compass — radial spokes
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" style={{ display: "block" }}>
      {/* Vertical bar */}
      <rect x="7" y="2" width="2" height="12" fill={color} />
      {/* Horizontal bar */}
      <rect x="2" y="7" width="12" height="2" fill={color} />
      {/* Diagonal pixels */}
      <rect x="4" y="4" width="2" height="2" fill={color} />
      <rect x="10" y="4" width="2" height="2" fill={color} />
      <rect x="4" y="10" width="2" height="2" fill={color} />
      <rect x="10" y="10" width="2" height="2" fill={color} />
      {/* Center hub */}
      <rect x="6" y="6" width="4" height="4" fill={color} />
      <rect x="7" y="7" width="2" height="2" fill="var(--bg)" />
    </svg>
  );
}

export function DelOSIcon({ size = 24, color = "currentColor" }: { size?: number; color?: string }) {
  // Stacked DEL pixel block
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" style={{ display: "block" }}>
      <rect x="2" y="2" width="12" height="2" fill={color} />
      <rect x="2" y="4" width="2" height="8" fill={color} />
      <rect x="12" y="4" width="2" height="8" fill={color} />
      <rect x="2" y="12" width="12" height="2" fill={color} />
      <rect x="6" y="6" width="4" height="4" fill={color} />
    </svg>
  );
}

/* ============================================================
   Premium sleek SVG icons for headline apps.
   strokeWidth 1.75 · rounded caps · subtle accent dots ·
   look hand-tuned, not template-pulled.
   ============================================================ */

const SLEEK = {
  stroke: 1.75,
  cap: "round" as const,
  join: "round" as const,
};

function sleekProps(color: string) {
  return {
    fill: "none",
    stroke: color,
    strokeWidth: SLEEK.stroke,
    strokeLinecap: SLEEK.cap,
    strokeLinejoin: SLEEK.join,
  };
}

export function DelAssistantSleek({ size = 24, color = "currentColor" }: { size?: number; color?: string }) {
  // Spark + chat bubble — agent + conversation
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block" }}>
      <path d="M4 5h16v11H8l-4 4z" {...sleekProps(color)} />
      <path d="M12 7v6M9 10h6" {...sleekProps(color)} />
      <circle cx="12" cy="10" r="0.8" fill={color} />
    </svg>
  );
}

export function IdentitySleek({ size = 24, color = "currentColor" }: { size?: number; color?: string }) {
  // Concentric rings + center — identity / aura
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block" }}>
      <circle cx="12" cy="9" r="3" {...sleekProps(color)} />
      <path d="M5 21c0-4 3-7 7-7s7 3 7 7" {...sleekProps(color)} />
      <circle cx="12" cy="9" r="0.9" fill={color} />
    </svg>
  );
}

export function IngestSleek({ size = 24, color = "currentColor" }: { size?: number; color?: string }) {
  // Funnel with flowing dots
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block" }}>
      <path d="M3 5h18l-7 8v6l-4 2v-8z" {...sleekProps(color)} />
      <circle cx="9" cy="9" r="0.8" fill={color} />
      <circle cx="15" cy="9" r="0.8" fill={color} />
    </svg>
  );
}

export function CohortSleek({ size = 24, color = "currentColor" }: { size?: number; color?: string }) {
  // 3 stacked nodes — multi-agent
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block" }}>
      <circle cx="6" cy="8" r="2.4" {...sleekProps(color)} />
      <circle cx="18" cy="8" r="2.4" {...sleekProps(color)} />
      <circle cx="12" cy="17" r="2.4" {...sleekProps(color)} />
      <path d="M7.7 9.6L10.6 15M16.3 9.6L13.4 15" {...sleekProps(color)} />
    </svg>
  );
}

export function CoresSleek({ size = 24, color = "currentColor" }: { size?: number; color?: string }) {
  // CPU die with central core highlight
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block" }}>
      <rect x="5" y="5" width="14" height="14" rx="2" {...sleekProps(color)} />
      <rect x="9" y="9" width="6" height="6" {...sleekProps(color)} />
      <path d="M9 3v2M15 3v2M9 19v2M15 19v2M3 9h2M3 15h2M19 9h2M19 15h2" {...sleekProps(color)} />
      <circle cx="12" cy="12" r="0.9" fill={color} />
    </svg>
  );
}

export function ArenaSleek({ size = 24, color = "currentColor" }: { size?: number; color?: string }) {
  // Crossed paths — battle / race
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block" }}>
      <path d="M5 5l14 14M19 5L5 19" {...sleekProps(color)} />
      <circle cx="5" cy="5" r="1.4" fill={color} />
      <circle cx="19" cy="5" r="1.4" fill={color} />
      <circle cx="5" cy="19" r="1.4" fill={color} />
      <circle cx="19" cy="19" r="1.4" fill={color} />
    </svg>
  );
}

export function BuilderSleek({ size = 24, color = "currentColor" }: { size?: number; color?: string }) {
  // Sparkle + frame — app builder
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block" }}>
      <path d="M4 8h16v12H4z" {...sleekProps(color)} />
      <path d="M4 8l3-4h10l3 4" {...sleekProps(color)} />
      <path d="M12 12l1.6 2.4L16 13l-1.6 2.4L16 18l-2.4-1.4L12 19l-1.6-2.4L8 18l1.6-2.4L8 13l2.4 1.4z" fill={color} />
    </svg>
  );
}

export function TerminalSleek({ size = 24, color = "currentColor" }: { size?: number; color?: string }) {
  // Terminal with cursor
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block" }}>
      <rect x="3" y="5" width="18" height="14" rx="1.5" {...sleekProps(color)} />
      <path d="M7 10l3 2-3 2M13 14h5" {...sleekProps(color)} />
    </svg>
  );
}

export function MissionSleek({ size = 24, color = "currentColor" }: { size?: number; color?: string }) {
  // Radar pulse
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block" }}>
      <circle cx="12" cy="12" r="3" {...sleekProps(color)} />
      <circle cx="12" cy="12" r="7" {...sleekProps(color)} strokeOpacity="0.55" />
      <path d="M12 5v-2M19 12h2M12 19v2M5 12H3" {...sleekProps(color)} />
      <circle cx="12" cy="12" r="0.9" fill={color} />
    </svg>
  );
}
