"use client";
import { useEffect, useState } from "react";

// Detects DelOS Chrome ext via `data-delos-ext` attribute set by content-sync.js.
// Polls for 8 seconds after mount in case ext injects late.

export function ExtStatusBanner() {
  const [status, setStatus] = useState<"checking" | "linked" | "missing">("checking");
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let attempts = 0;
    const maxAttempts = 16; // 16 × 500ms = 8s window

    function probe() {
      if (!alive) return;
      const linked = document.documentElement.getAttribute("data-delos-ext") === "linked";
      const v = document.documentElement.getAttribute("data-delos-ext-version");
      if (linked) {
        setStatus("linked");
        setVersion(v);
        return;
      }
      attempts++;
      if (attempts >= maxAttempts) {
        setStatus("missing");
        return;
      }
      setTimeout(probe, 500);
    }

    probe();
    return () => { alive = false; };
  }, []);

  if (status === "checking") {
    return (
      <div className="card-pixel" style={{ padding: 10, borderColor: "var(--surface-2)" }}>
        <div className="flex items-center gap-2 font-mono text-[11px]" style={{ color: "var(--muted)" }}>
          <span>⏳</span>
          <span>Checking for DelOS Chrome extension…</span>
        </div>
      </div>
    );
  }

  if (status === "linked") {
    return (
      <div className="card-pixel" style={{ padding: 10, borderColor: "var(--success)", background: "rgba(106,176,76,0.10)" }}>
        <div className="flex items-center gap-2 font-mono text-[12px]" style={{ color: "var(--success)" }}>
          <span>● DelOS ext linked{version ? ` · v${version}` : ""}</span>
        </div>
        <div className="text-[10px] mt-1" style={{ color: "var(--muted)" }}>
          Side panel: Ctrl+Shift+D (Cmd+Shift+D on Mac). Settings + memory + MCP servers sync from /os automatically.
        </div>
      </div>
    );
  }

  return (
    <div className="card-pixel" style={{ padding: 10, borderColor: "var(--warn)", background: "rgba(255,180,0,0.08)" }}>
      <div className="flex items-center gap-2 font-mono text-[11px]" style={{ color: "var(--warn)" }}>
        <span>⚠</span>
        <span>Extension not detected on this page.</span>
      </div>
      <div className="text-[10px] mt-1" style={{ color: "var(--muted)" }}>
        Download zip below, unzip it, then chrome://extensions → Developer mode → Load unpacked → pick the unzipped folder. Reload this page after install.
      </div>
    </div>
  );
}
