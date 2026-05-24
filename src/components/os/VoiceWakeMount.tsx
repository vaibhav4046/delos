"use client";
import { useEffect } from "react";
import { useVoiceWake } from "@/lib/useVoiceWake";

// Mounted once at the OS root. When voice wake fires "delos …", hits
// /api/voice-command to parse intent, then dispatches into the OS intent bus so
// apps respond identically to manual launches. Also speaks the reply via
// browser TTS so the user gets audible confirmation hands-free.
//
// Handles every intent the voice-command endpoint can return — earlier version
// only wired up `open_app`, which made voice feel broken when users asked it
// to build apps, change wallpaper, recall memory, etc.

type VoiceResp = {
  intent?: string;
  app?: string;
  payload?: string;
  reply?: string;
};

function speak(text: string) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    u.pitch = 1.0;
    u.volume = 0.9;
    synth.speak(u);
  } catch {}
}

function toast(text: string, tone: "ok" | "warn" | "info" = "ok") {
  try {
    window.dispatchEvent(new CustomEvent("toast", { detail: { text, tone } }));
  } catch {}
}

// Map app id → the intent bus `kind` and payload key the app listens for.
// Without this, opening (e.g.) the builder doesn't trigger a build — only a
// blank window. Intent bus expects `kind` field, not `type`.
const INTENT_MAP: Record<string, { kind: string; key: string } | undefined> = {
  builder: { kind: "builder.build", key: "prompt" },
  cohort: { kind: "cohort.run", key: "goal" },
  terminal: { kind: "terminal.run", key: "goal" },
  memory: { kind: "memory.search", key: "query" },
};

function launchApp(id: string, payload?: string) {
  window.dispatchEvent(new CustomEvent("delos-launch-app", { detail: { id } }));
  if (!payload) return;
  const route = INTENT_MAP[id];
  if (!route) return;
  // Wait for window to mount + onIntent listener to bind before firing.
  setTimeout(() => {
    window.dispatchEvent(
      new CustomEvent("delos-intent", {
        detail: { kind: route.kind, [route.key]: payload },
      }),
    );
  }, 400);
}

export function VoiceWakeMount() {
  const { enabled, listening } = useVoiceWake();

  useEffect(() => {
    function onWake(ev: Event) {
      const d = (ev as CustomEvent).detail as { phrase: string };
      if (!d?.phrase) return;
      fetch("/api/voice-command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: d.phrase }),
      })
        .then((r) => r.json())
        .then((j: VoiceResp) => {
          const reply = (j.reply ?? "").slice(0, 240);
          switch (j.intent) {
            case "open_app":
              if (j.app) launchApp(j.app, j.payload);
              break;
            case "run_mission":
              launchApp("terminal", j.payload);
              break;
            case "build_app":
              launchApp("builder", j.payload);
              break;
            case "run_cohort":
              launchApp("cohort", j.payload);
              break;
            case "recall_memory":
              launchApp("memory", j.payload);
              break;
            case "change_wallpaper":
              window.dispatchEvent(new CustomEvent("delos-wallpaper-cycle"));
              break;
            case "close_window":
              window.dispatchEvent(new CustomEvent("delos-close-focused"));
              break;
            case "navigate":
              if (j.payload) window.location.href = j.payload;
              break;
            case "answer":
              // Pure spoken answer, no app surface.
              break;
            case "unknown":
            default:
              toast(`voice · didn't understand "${d.phrase.slice(0, 40)}"`, "warn");
              break;
          }
          if (reply) {
            speak(reply);
            toast(`voice · ${reply}`, "ok");
          }
        })
        .catch(() => toast("voice · network error", "warn"));
    }
    window.addEventListener("delos-voice-wake", onWake as EventListener);
    return () => window.removeEventListener("delos-voice-wake", onWake as EventListener);
  }, []);

  if (!enabled) return null;
  return (
    <div
      aria-hidden
      className="fixed pointer-events-none"
      style={{
        bottom: 88,
        left: 12,
        zIndex: 9000,
        background: "rgba(34, 197, 94, 0.18)",
        color: "#22c55e",
        border: "1px solid #22c55e",
        padding: "3px 8px",
        fontFamily: "ui-monospace, monospace",
        fontSize: 10,
        letterSpacing: 1,
      }}
    >
      ● voice wake {listening ? "active" : "idle"} · say "delos …"
    </div>
  );
}
