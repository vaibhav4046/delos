import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "DelOS · DelOS · agents that flow under pressure";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          width: "100%",
          background: "linear-gradient(135deg, #0f0f1b 0%, #1b1b2e 100%)",
          color: "#fbc531",
          padding: "60px 80px",
          fontFamily: "system-ui, sans-serif",
          position: "relative",
        }}
      >
        {/* Grid bg */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0.18,
            background:
              "repeating-linear-gradient(0deg, transparent 0 38px, rgba(244,241,222,0.06) 38px 40px), repeating-linear-gradient(90deg, transparent 0 38px, rgba(244,241,222,0.06) 38px 40px)",
            display: "flex",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 22, color: "#8a8aab", letterSpacing: 4, display: "flex" }}>
            ★ AGENTS UNDER PRESSURE · HYDRADB 2026
          </span>
        </div>
        <div
          style={{
            fontSize: 120,
            fontWeight: 800,
            lineHeight: 1,
            marginTop: 40,
            color: "#f4f1de",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <span style={{ display: "flex" }}>agents that</span>
          <span style={{ display: "flex" }}>
            <span style={{ color: "#fbc531" }}>flow</span>&nbsp;under
          </span>
          <span style={{ color: "#c0392b", display: "flex" }}>pressure.</span>
        </div>
        <div
          style={{
            marginTop: "auto",
            fontSize: 28,
            color: "#b8b8d4",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <span style={{ display: "flex" }}>Memory · Tools · Recovery · Adaptation</span>
          <span style={{ display: "flex", color: "#6ab04c", fontSize: 22 }}>
            24 apps · 17 tools · 7 LLMs · 0 hidden mocks · delrio.vercel.app
          </span>
        </div>
      </div>
    ),
    { ...size },
  );
}
