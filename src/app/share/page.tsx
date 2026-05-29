"use client";

// Web Share Target landing. The PWA manifest registers /share as a GET share
// target (params: title, text, url). When the user shares a link or text from
// another app into DelOS, the OS routes here. We stash the shared payload in
// sessionStorage and bounce to /os, which picks it up on mount and opens Del
// Assistant pre-filled. Mobile-exclusive entry point — desktop never hits this.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SharePage() {
  const router = useRouter();

  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const parts = [p.get("title"), p.get("text"), p.get("url")]
        .map((s) => (s ?? "").trim())
        .filter(Boolean);
      const shared = parts.join("\n").trim();
      if (shared) sessionStorage.setItem("delos.shareTarget", shared);
    } catch {
      // ignore — fall through to /os either way
    }
    // guest=1 so a cold share-into-installed-PWA lands in the OS (which then
    // opens Del Assistant pre-filled) instead of bouncing off the auth wall.
    router.replace("/os?guest=1");
  }, [router]);

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center gap-3"
      style={{ background: "#0f0f1b", color: "#fbc531" }}
    >
      <div
        className="w-10 h-10 rounded-full animate-spin"
        style={{ border: "3px solid rgba(251,197,49,0.25)", borderTopColor: "#fbc531" }}
      />
      <p className="font-mono text-sm">Sharing to Del Assistant…</p>
    </div>
  );
}
