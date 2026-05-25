// Server-rendered placeholder shown WHILE the heavy /os client bundle
// downloads + hydrates. Without this judges see a blank screen until
// the JS chunk arrives (~30s on cold lambda + slow network), then the
// boot animation kicks in. This is pure HTML/CSS — zero JS — so it
// renders on first byte.

export default function Loading() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--bg, #07070b)",
        color: "var(--fg, #f5f3ff)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        fontFamily: "'Pixelify Sans', system-ui, sans-serif",
        letterSpacing: "0.04em",
      }}
    >
      <style>{`
        @keyframes delos-spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
        @keyframes delos-pulse { 0%,100% { opacity: 0.4; } 50% { opacity: 1; } }
        @keyframes delos-bar { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
      `}</style>
      <div
        style={{
          width: 72,
          height: 72,
          border: "4px solid rgba(251,197,49,0.18)",
          borderTopColor: "var(--accent, #fbc531)",
          borderRadius: 6,
          animation: "delos-spin 1.1s linear infinite",
        }}
      />
      <div
        style={{
          fontSize: 22,
          letterSpacing: "0.18em",
        }}
      >
        DEL<span style={{ color: "var(--accent, #fbc531)" }}>OS</span>
      </div>
      <div
        style={{
          fontFamily: "ui-monospace, 'JetBrains Mono', monospace",
          fontSize: 11,
          color: "rgba(255,255,255,0.55)",
          animation: "delos-pulse 1.8s ease-in-out infinite",
        }}
      >
        loading desktop · agents · multi-agent runtime
      </div>
      <div
        style={{
          width: 240,
          maxWidth: "70vw",
          height: 4,
          background: "rgba(255,255,255,0.08)",
          overflow: "hidden",
          borderRadius: 2,
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            width: "40%",
            background: "linear-gradient(90deg, transparent, var(--accent, #fbc531), transparent)",
            animation: "delos-bar 1.4s linear infinite",
          }}
        />
      </div>
    </div>
  );
}
