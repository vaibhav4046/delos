"use client";
import { useEffect, useRef, useState, useCallback } from "react";

type SR = SpeechRecognition;

export type VoicePrefs = {
  voiceName: string;
  rate: number;
  pitch: number;
  autoSpeak: boolean;
  continuous: boolean;
  sttProvider: "browser" | "whisper";
  ttsProvider: "browser" | "elevenlabs";
  elevenVoiceId: string;
  // Bring-your-own ElevenLabs key. Stored client-side only. Passed with /api/tts
  // requests so users get premium voice without us needing server-side keys.
  elevenApiKey?: string;
  autonomy: boolean;
};

/**
 * Auto-pick the highest-quality available browser voice. Prefers Google + Microsoft
 * neural voices known to sound natural. Falls back to first English voice.
 */
export function pickBestVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const preferred = [
    "Google US English",
    "Microsoft Aria Online (Natural) - English (United States)",
    "Microsoft Jenny Online (Natural) - English (United States)",
    "Microsoft Guy Online (Natural) - English (United States)",
    "Samantha", // macOS premium
    "Karen",    // macOS AU
    "Daniel",   // macOS UK
  ];
  for (const name of preferred) {
    const hit = voices.find((v) => v.name === name);
    if (hit) return hit;
  }
  // Any en-US voice
  const enUs = voices.find((v) => v.lang === "en-US");
  if (enUs) return enUs;
  // Any English
  return voices.find((v) => v.lang.startsWith("en")) ?? voices[0];
}

const STORE_KEY = "delos.voicePrefs.v2";

const DEFAULTS: VoicePrefs = {
  voiceName: "",
  rate: 1,
  pitch: 1,
  autoSpeak: true,
  continuous: false,
  sttProvider: "whisper",
  ttsProvider: "elevenlabs",
  elevenVoiceId: "",
  autonomy: false,
};

function readPrefs(): VoicePrefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<VoicePrefs>) };
  } catch {
    return DEFAULTS;
  }
}
function writePrefs(v: VoicePrefs) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(v));
    window.dispatchEvent(new CustomEvent("delos-voice-changed"));
  } catch {}
}
export function getVoicePrefs(): VoicePrefs {
  return readPrefs();
}
export function useVoicePrefs(): [VoicePrefs, (next: VoicePrefs) => void] {
  const [v, setV] = useState<VoicePrefs>(DEFAULTS);
  useEffect(() => {
    setV(readPrefs());
    function onChange() {
      setV(readPrefs());
    }
    window.addEventListener("delos-voice-changed", onChange);
    return () => window.removeEventListener("delos-voice-changed", onChange);
  }, []);
  return [
    v,
    (next) => {
      writePrefs(next);
      setV(next);
    },
  ];
}

export function speechSupported(): { stt: boolean; tts: boolean; recorder: boolean } {
  if (typeof window === "undefined") return { stt: false, tts: false, recorder: false };
  const W = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown; speechSynthesis?: unknown; MediaRecorder?: unknown };
  return {
    stt: Boolean(W.SpeechRecognition || W.webkitSpeechRecognition),
    tts: Boolean(W.speechSynthesis),
    recorder: Boolean(W.MediaRecorder && navigator?.mediaDevices?.getUserMedia),
  };
}

export function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    function update() {
      setVoices(window.speechSynthesis.getVoices());
    }
    update();
    window.speechSynthesis.addEventListener("voiceschanged", update);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", update);
  }, []);
  return voices;
}

let currentAudio: HTMLAudioElement | null = null;

// Tracks whether user explicitly asked us to stop — guards against a slow
// /api/tts response landing AFTER mute and starting playback.
let muteToken = 0;

export async function speak(text: string, opts?: { force?: "browser" | "elevenlabs" }) {
  if (typeof window === "undefined") return;
  const prefs = readPrefs();
  const provider = opts?.force ?? prefs.ttsProvider;
  stopSpeaking();
  const myToken = ++muteToken;
  if (provider === "elevenlabs") {
    try {
      const r = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voiceId: prefs.elevenVoiceId || undefined,
          // BYOK — when user pasted their own key in Settings, send it so server
          // doesn't need ELEVENLABS_API_KEY env var configured.
          apiKey: prefs.elevenApiKey || undefined,
        }),
      });
      // If user muted while we were fetching, bail.
      if (myToken !== muteToken) return;
      if (r.status === 503) {
        // not configured — fall back
        return browserSpeak(text);
      }
      if (!r.ok) {
        console.warn("[tts] elevenlabs failed", await r.text().catch(() => ""));
        return browserSpeak(text);
      }
      const blob = await r.blob();
      if (myToken !== muteToken) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      // Register currentAudio BEFORE play() so mute click during loading still works
      audio.onended = () => URL.revokeObjectURL(url);
      currentAudio = audio;
      try {
        await audio.play();
      } catch {
        // Autoplay may be blocked or user already muted
      }
      return;
    } catch (e) {
      console.warn("[tts] elevenlabs error, fallback to browser:", e);
      return browserSpeak(text);
    }
  }
  browserSpeak(text);
}

function browserSpeak(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const prefs = readPrefs();
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = prefs.rate;
  u.pitch = prefs.pitch;
  const voices = window.speechSynthesis.getVoices();
  let chosen: SpeechSynthesisVoice | null = null;
  if (prefs.voiceName) {
    chosen = voices.find((x) => x.name === prefs.voiceName) ?? null;
  }
  // Auto-pick best-available voice when user hasn't chosen one. Beats the OS
  // default ("Microsoft David", robotic) on every platform.
  if (!chosen) chosen = pickBestVoice(voices);
  if (chosen) u.voice = chosen;
  window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (typeof window === "undefined") return;
  // Bump token so any in-flight /api/tts response will skip starting playback.
  muteToken++;
  try { window.speechSynthesis?.cancel(); } catch {}
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio.src = "";
      currentAudio.load();
    } catch {}
    currentAudio = null;
  }
}

export type ListenState = "idle" | "listening" | "recording" | "transcribing" | "denied" | "error";

// Browser STT (Web Speech API)
export function useBrowserSTT() {
  const [state, setState] = useState<ListenState>("idle");
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SR | null>(null);

  const start = useCallback((opts?: { continuous?: boolean; lang?: string }) => {
    if (typeof window === "undefined") return;
    const W = window as unknown as { SpeechRecognition?: { new (): SR }; webkitSpeechRecognition?: { new (): SR } };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) {
      setState("error");
      setError("SpeechRecognition not supported in this browser");
      return;
    }
    const rec = new Ctor();
    rec.lang = opts?.lang ?? "en-US";
    rec.continuous = opts?.continuous ?? false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e: SpeechRecognitionEvent) => {
      let final = "";
      let i = "";
      for (let k = e.resultIndex; k < e.results.length; k++) {
        const r = e.results[k];
        if (r.isFinal) final += r[0].transcript;
        else i += r[0].transcript;
      }
      if (final) setTranscript((prev) => (prev ? prev + " " : "") + final.trim());
      setInterim(i);
    };
    rec.onerror = (e: { error?: string }) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setState("denied");
        setError("Microphone permission denied");
      } else if (e.error === "no-speech") {
        // benign
      } else {
        setState("error");
        setError(String(e.error ?? "unknown"));
      }
    };
    rec.onend = () => setState((s) => (s === "listening" ? "idle" : s));
    recRef.current = rec;
    setError(null);
    setInterim("");
    setTranscript("");
    try {
      rec.start();
      setState("listening");
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : "start failed");
    }
  }, []);

  const stop = useCallback(() => {
    try { recRef.current?.stop(); } catch {}
    setState("idle");
  }, []);

  useEffect(() => () => { try { recRef.current?.abort(); } catch {} }, []);
  return { state, transcript, interim, error, start, stop, setTranscript };
}

// Whisper STT (MediaRecorder → /api/stt)
export function useWhisperSTT() {
  const [state, setState] = useState<ListenState>("idle");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const start = useCallback(async () => {
    setError(null);
    setTranscript("");
    if (typeof window === "undefined" || !navigator?.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setState("error");
      setError("MediaRecorder not supported");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeCandidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
      const mime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        try {
          const blob = new Blob(chunksRef.current, { type: mime || "audio/webm" });
          streamRef.current?.getTracks().forEach((t) => t.stop());
          if (blob.size < 500) {
            setState("idle");
            return;
          }
          setState("transcribing");
          const fd = new FormData();
          fd.set("file", blob, "speech.webm");
          fd.set("model", "whisper-large-v3-turbo");
          const r = await fetch("/api/stt", { method: "POST", body: fd });
          const j = (await r.json()) as { text?: string; error?: string };
          if (j.error) {
            setError(j.error);
            setState("error");
            return;
          }
          setTranscript(j.text ?? "");
          setState("idle");
        } catch (e) {
          setError(e instanceof Error ? e.message : "transcribe failed");
          setState("error");
        }
      };
      rec.start();
      recRef.current = rec;
      setState("recording");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "mic permission denied";
      if (msg.includes("Permission") || msg.includes("denied") || msg.includes("not allowed")) {
        setState("denied");
      } else {
        setState("error");
      }
      setError(msg);
    }
  }, []);

  const stop = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {}
  }, []);

  useEffect(
    () => () => {
      try {
        recRef.current?.stop();
        streamRef.current?.getTracks().forEach((t) => t.stop());
      } catch {}
    },
    [],
  );
  return { state, transcript, interim: "", error, start, stop, setTranscript };
}

// Unified facade — picks browser vs whisper based on prefs.
export function useSpeechToText() {
  const browser = useBrowserSTT();
  const whisper = useWhisperSTT();
  const [provider, setProvider] = useState<"browser" | "whisper">(DEFAULTS.sttProvider);
  useEffect(() => {
    setProvider(readPrefs().sttProvider);
    function onChange() {
      setProvider(readPrefs().sttProvider);
    }
    window.addEventListener("delos-voice-changed", onChange);
    return () => window.removeEventListener("delos-voice-changed", onChange);
  }, []);
  const active = provider === "whisper" ? whisper : browser;
  return active;
}

export type VoiceAction = {
  intent:
    | "open_app"
    | "run_mission"
    | "build_app"
    | "run_cohort"
    | "recall_memory"
    | "change_wallpaper"
    | "close_window"
    | "navigate"
    | "answer"
    | "unknown";
  app?: string;
  payload?: string;
  reply: string;
};

export async function interpretCommand(transcript: string): Promise<VoiceAction | null> {
  try {
    const r = await fetch("/api/voice-command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript }),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as VoiceAction;
    return j;
  } catch {
    return null;
  }
}
