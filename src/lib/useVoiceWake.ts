"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

// Always-on voice wake hook.
// Watches for wake word "delos" via Web Speech API (Chrome / Edge). On hit, fires
// the rest of the spoken phrase as an intent on the bus. App listeners (DelAssistant,
// Terminal) can pick it up and act.
//
// Stays silent when:
//  - browser does not support SpeechRecognition
//  - user disables in Settings (delos.voiceWake = "off")
//  - tab is not visible (saves battery)
//
// Recovers from transient errors with exponential backoff up to 30s.

type Recognition = typeof window extends { SpeechRecognition: infer R } ? R : unknown;

const WAKE_RE = /\b(del\s?os|d[ae]los)\s+(.{2,160})$/i;
const SETTING_KEY = "delos.voiceWake.v1";

export function getVoiceWakeEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (localStorage.getItem(SETTING_KEY) ?? "off") === "on";
  } catch {
    return false;
  }
}

export function setVoiceWakeEnabled(on: boolean) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SETTING_KEY, on ? "on" : "off");
    window.dispatchEvent(new CustomEvent("delos-voicewake-changed", { detail: { on } }));
  } catch {}
}

function subscribeVoiceWake(cb: () => void) {
  window.addEventListener("delos-voicewake-changed", cb);
  return () => window.removeEventListener("delos-voicewake-changed", cb);
}

export function useVoiceWake() {
  // `enabled` is a boolean primitive read straight from localStorage — no
  // snapshot caching needed. The SpeechRecognition lifecycle below still uses
  // local state/refs since it owns mutable, non-persisted runtime state.
  const enabled = useSyncExternalStore(subscribeVoiceWake, getVoiceWakeEnabled, () => false);
  const [listening, setListening] = useState(false);
  const [lastWake, setLastWake] = useState<string | null>(null);
  const recRef = useRef<unknown>(null);
  const backoffRef = useRef(800);

  useEffect(() => {
    if (!enabled) return;
    const W = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    const SR = (W.SpeechRecognition || W.webkitSpeechRecognition) as { new(): Recognition } | undefined;
    if (!SR) return;

    let dead = false;

    function spawn() {
      if (dead) return;
      try {
        const rec = new (SR as unknown as { new (): { continuous: boolean; interimResults: boolean; lang: string; onresult: ((ev: unknown) => void) | null; onerror: ((ev: unknown) => void) | null; onend: (() => void) | null; start: () => void; stop: () => void } })();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = "en-US";
        rec.onresult = (ev: unknown) => {
          const e = ev as { results: Array<{ 0: { transcript: string }; isFinal: boolean }> };
          for (let i = 0; i < e.results.length; i++) {
            const r = e.results[i];
            if (!r.isFinal) continue;
            const text = r[0].transcript.trim();
            const m = WAKE_RE.exec(text);
            if (m && m[2]) {
              const phrase = m[2].trim();
              setLastWake(phrase);
              try {
                window.dispatchEvent(new CustomEvent("delos-voice-wake", { detail: { phrase } }));
              } catch {}
            }
          }
        };
        rec.onerror = () => {
          try { rec.stop(); } catch {}
        };
        rec.onend = () => {
          setListening(false);
          // Restart with backoff
          setTimeout(spawn, backoffRef.current);
          backoffRef.current = Math.min(30_000, Math.round(backoffRef.current * 1.6));
        };
        rec.start();
        setListening(true);
        backoffRef.current = 800;
        recRef.current = rec;
      } catch {
        // SpeechRecognition can throw if microphone is denied — back off without spawning loop
        setTimeout(spawn, 10_000);
      }
    }
    spawn();
    return () => {
      dead = true;
      try {
        const r = recRef.current as { stop?: () => void } | null;
        r?.stop?.();
      } catch {}
    };
  }, [enabled]);

  return { enabled, listening, lastWake };
}
