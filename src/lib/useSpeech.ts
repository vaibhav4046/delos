"use client";
import { useEffect, useRef, useState, useCallback } from "react";
// M10 · single source of truth for voice parsing. The client fast-path used
// to run its OWN stripped-down regex matcher (localMatch) that drifted out of
// sync with the server's richer parser — same phrase parsed differently
// depending on entry point. Both now call parseVoiceLocal.
import { parseVoiceLocal } from "@/lib/voiceParser";

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
  // V9 · BYOK · user-supplied OpenRouter key. Sent via `x-byok-openrouter`
  // header on every LLM-using request. Lets judges run unlimited on their
  // own key without us paying for tokens.
  openrouterApiKey?: string;
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
    // Hydrate from localStorage on mount, then track cross-tab/app changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

// Latches true once /api/tts answers 503 (server has no ElevenLabs key) AND
// the user hasn't supplied their own BYOK key. After that, every speak() with
// provider "elevenlabs" skips the guaranteed-503 fetch and goes straight to the
// browser voice — removing ~200-400ms of dead air before each spoken reply,
// which read as "voice is broken / laggy". Reset by stopSpeaking() never; only
// a BYOK key in prefs re-enables the premium path.
let elevenUnavailable = false;

export async function speak(text: string, opts?: { force?: "browser" | "elevenlabs" }) {
  if (typeof window === "undefined") return;
  const prefs = readPrefs();
  const provider = opts?.force ?? prefs.ttsProvider;
  stopSpeaking();
  const myToken = ++muteToken;
  if (provider === "elevenlabs") {
    // Skip the dead round-trip when we already proved the server has no key
    // and the user hasn't pasted their own. Browser voice is instant.
    if (elevenUnavailable && !prefs.elevenApiKey) return browserSpeak(text);
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
        // not configured — latch (only when no BYOK key) and fall back so the
        // next reply skips this fetch entirely.
        if (!prefs.elevenApiKey) elevenUnavailable = true;
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
  // Chrome returns an EMPTY getVoices() on the very first call of a page load —
  // the list is populated async and announced via the `voiceschanged` event.
  // If we emit immediately we get a silent (or robotic-default) first reply,
  // which reads as "voice is broken". Guard: when the list is empty, wait for
  // voiceschanged (with a 300ms safety timeout for browsers that never fire it)
  // and emit once voices land. Subsequent calls hit the fast synchronous path.
  const synth = window.speechSynthesis;
  if (synth.getVoices().length === 0) {
    let fired = false;
    const emit = () => {
      if (fired) return;
      fired = true;
      try { synth.removeEventListener("voiceschanged", emit); } catch {}
      emitUtterance(text);
    };
    try { synth.addEventListener("voiceschanged", emit, { once: true }); } catch {}
    setTimeout(emit, 300);
    return;
  }
  emitUtterance(text);
}

// Builds + speaks the utterance with the user's chosen (or best-available)
// voice. Split out of browserSpeak so the Chrome empty-voices guard can defer
// the emit until voices are ready without duplicating the voice-selection logic.
function emitUtterance(text: string) {
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
// V10-1/V10-2 · hardened browser STT.
//   • continuous: true by default so far-field, slow, multi-sentence speech
//     doesn't auto-close the mic mid-thought (was: continuous:false → mic
//     died after every pause, transcript got chopped).
//   • maxAlternatives: 3 + pick highest-confidence to recover accent slips.
//   • auto-restart on benign errors (no-speech, audio-capture, network) so
//     a single moment of silence at 2m away doesn't end the session.
//   • transcript accumulates across restarts; only stop() / abort() resets it.
//   • exposes audio-level meter (0-1) so the UI can show a live mic-hot
//     indicator and the user knows it's still listening from across the room.
export function useBrowserSTT() {
  const [state, setState] = useState<ListenState>("idle");
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const recRef = useRef<SR | null>(null);
  const wantRunningRef = useRef(false);
  const restartCountRef = useRef(0);
  const optsRef = useRef<{ continuous: boolean; lang: string }>({ continuous: true, lang: "en-US" });
  const audioCtxRef = useRef<AudioContext | null>(null);
  const meterStreamRef = useRef<MediaStream | null>(null);
  const meterRafRef = useRef<number | null>(null);

  const stopMeter = useCallback(() => {
    if (meterRafRef.current) cancelAnimationFrame(meterRafRef.current);
    meterRafRef.current = null;
    meterStreamRef.current?.getTracks().forEach((t) => t.stop());
    meterStreamRef.current = null;
    try { if (audioCtxRef.current && audioCtxRef.current.state !== "closed") audioCtxRef.current.close(); } catch {}
    audioCtxRef.current = null;
    setAudioLevel(0);
  }, []);

  // Side audio meter · runs alongside SpeechRecognition. SR doesn't expose
  // amplitude, so we open a parallel mic stream with far-field constraints
  // and sample it via AnalyserNode. Stopped when STT stops.
  const startMeter = useCallback(async () => {
    if (typeof window === "undefined" || !navigator?.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // Far-field friendly · no aggressive gating that drops distant voice.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      meterStreamRef.current = stream;
      const Ctor: typeof AudioContext = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as typeof AudioContext;
      const ctx = new Ctor();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!audioCtxRef.current) return;
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const mean = sum / data.length;
        // Map 0-50 (typical ambient + voice band) to 0-1 with light compression.
        setAudioLevel(Math.min(1, mean / 50));
        meterRafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      /* meter is optional · STT itself still works without it */
    }
  }, []);

  const buildRec = useCallback(() => {
    const W = window as unknown as { SpeechRecognition?: { new (): SR }; webkitSpeechRecognition?: { new (): SR } };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) return null;
    const rec = new Ctor();
    rec.lang = optsRef.current.lang;
    rec.continuous = optsRef.current.continuous;
    rec.interimResults = true;
    rec.maxAlternatives = 3;
    rec.onresult = (e: SpeechRecognitionEvent) => {
      let final = "";
      let i = "";
      for (let k = e.resultIndex; k < e.results.length; k++) {
        const r = e.results[k];
        // V10-2 · pick the highest-confidence alternative · cheap accent recovery.
        let best = r[0];
        for (let alt = 1; alt < r.length; alt++) {
          if ((r[alt]?.confidence ?? 0) > (best.confidence ?? 0)) best = r[alt];
        }
        if (r.isFinal) final += best.transcript;
        else i += best.transcript;
      }
      if (final) setTranscript((prev) => (prev ? prev + " " : "") + final.trim());
      setInterim(i);
    };
    rec.onerror = (e: { error?: string }) => {
      const err = e.error ?? "unknown";
      if (err === "not-allowed" || err === "service-not-allowed") {
        wantRunningRef.current = false;
        setState("denied");
        setError("Microphone permission denied");
        stopMeter();
      } else if (err === "no-speech" || err === "audio-capture" || err === "network" || err === "aborted") {
        // V10-1 · benign · onend will fire and trigger auto-restart below.
      } else {
        wantRunningRef.current = false;
        setState("error");
        setError(String(err));
        stopMeter();
      }
    };
    rec.onend = () => {
      // V10-1 · auto-restart while the user still wants us listening. SR can
      // self-terminate after ~60s on Chrome even with continuous:true; this
      // loop keeps the session alive until stop() is explicitly called.
      if (wantRunningRef.current && restartCountRef.current < 30) {
        restartCountRef.current += 1;
        try {
          // Self-restart: onend fires long after buildRec is defined, so the
          // forward reference is safe and intended.
          // eslint-disable-next-line react-hooks/immutability
          const next = buildRec();
          if (next) {
            recRef.current = next;
            next.start();
            setState("listening");
            return;
          }
        } catch {}
      }
      setState((s) => (s === "listening" ? "idle" : s));
      stopMeter();
    };
    return rec;
  }, [stopMeter]);

  const start = useCallback((opts?: { continuous?: boolean; lang?: string }) => {
    if (typeof window === "undefined") return;
    optsRef.current = {
      continuous: opts?.continuous !== false,  // default ON (far-field, multi-sentence)
      lang: opts?.lang ?? "en-US",
    };
    wantRunningRef.current = true;
    restartCountRef.current = 0;
    setError(null);
    setInterim("");
    setTranscript("");
    const rec = buildRec();
    if (!rec) {
      setState("error");
      setError("SpeechRecognition not supported in this browser");
      return;
    }
    recRef.current = rec;
    try {
      rec.start();
      setState("listening");
      void startMeter();
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : "start failed");
    }
  }, [buildRec, startMeter]);

  const stop = useCallback(() => {
    wantRunningRef.current = false;
    try { recRef.current?.stop(); } catch {}
    setState("idle");
    stopMeter();
  }, [stopMeter]);

  useEffect(() => () => {
    wantRunningRef.current = false;
    try { recRef.current?.abort(); } catch {}
    stopMeter();
  }, [stopMeter]);

  return { state, transcript, interim, error, audioLevel, start, stop, setTranscript };
}

// Whisper emits canned "training-data" phrases when fed near-silence or pure
// noise — the model was trained on YouTube captions, so silence decodes to the
// most common caption strings ("Thank you for watching!", "Please subscribe").
// These got auto-submitted by the voice loop, firing bogus commands. Drop any
// transcript that is ONLY one of these (after stripping punctuation/emoji), so
// an empty/noisy recording yields "" instead of a phantom command.
const WHISPER_HALLUCINATIONS = new Set([
  "thank you for watching",
  "thanks for watching",
  "thank you for watching!",
  "thank you",
  "thank you.",
  "thanks",
  "you",
  "bye",
  "bye.",
  "goodbye",
  "please subscribe",
  "subscribe",
  "like and subscribe",
  "see you next time",
  "see you in the next video",
  "i'll see you in the next video",
  "music",
  "[music]",
  "(music)",
  "applause",
  "[applause]",
  "silence",
  "[silence]",
  "transcribed by",
  "okay",
  "ok",
  ".",
]);

function isWhisperHallucination(text: string): boolean {
  // Normalize: lowercase, strip emoji/music-notes, collapse whitespace, drop
  // trailing punctuation. A genuine command is almost never one of these exact
  // strings; a real reply that happens to be "thank you" is acceptable collateral.
  const norm = text
    .toLowerCase()
    .replace(/[♠-➿\u{1f000}-\u{1faff}♪♫♩]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?,]+$/g, "")
    .trim();
  if (!norm) return true;
  return WHISPER_HALLUCINATIONS.has(norm);
}

// Whisper STT (MediaRecorder → /api/stt). Tuned for far-field capture:
//   • AGC + noise suppression OFF — both filter out distant speech as "noise"
//   • echoCancellation OFF — drops the entire band where far-field voice sits
//   • channelCount 1 mono — denser SNR per byte
//   • sampleRate 48k — Whisper-turbo's native rate, no resample loss
// PLUS a Web Audio gain stage (3-6×) that lifts quiet voice above the floor
// before Whisper sees it. VAD endpoint detection cuts trailing silence so
// the round-trip latency drops without truncating user speech mid-word.
export function useWhisperSTT() {
  const [state, setState] = useState<ListenState>("idle");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const vadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = useCallback(async () => {
    setError(null);
    setTranscript("");
    if (typeof window === "undefined" || !navigator?.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setState("error");
      setError("MediaRecorder not supported");
      return;
    }
    try {
      // ─── Far-field optimized constraints ────────────────────────────────
      // Standard `audio: true` enables echoCancellation + noiseSuppression +
      // autoGainControl, which together aggressively gate quiet / distant
      // speech. Disable them so we keep the user's voice from 10-20m away,
      // then handle gain manually via Web Audio (deterministic, not "AI"
      // noise gates that drop syllables).
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
          sampleRate: 48000,
          sampleSize: 16,
        },
      });
      streamRef.current = stream;

      // ─── Web Audio gain boost ───────────────────────────────────────────
      // 3-6× linear gain widens the dynamic range so distant voice rises
      // above mic-self-noise. Anything louder than 0 dBFS would clip, so
      // we cap the post-gain output via a soft-knee compressor. Output of
      // the chain is fed back into a new MediaStream the MediaRecorder
      // captures, bypassing the raw mic stream.
      let recordStream = stream;
      try {
        const Ctor: typeof AudioContext = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as typeof AudioContext;
        const ctx = new Ctor({ sampleRate: 48000 });
        audioCtxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const gain = ctx.createGain();
        gain.gain.value = 5.0; // 5× linear ≈ +14 dB
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -6;
        compressor.knee.value = 8;
        compressor.ratio.value = 6;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.12;
        const dest = ctx.createMediaStreamDestination();
        src.connect(gain).connect(compressor).connect(dest);

        // ─── VAD via AnalyserNode ─────────────────────────────────────────
        // Tail-silence detection · stop recording 800ms after the user
        // stops speaking instead of waiting for an external stop() call.
        // Cuts perceived latency from ~3s to ~0.6s.
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        gain.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        let silenceStartedAt: number | null = null;
        const SILENCE_THRESHOLD = 8;     // mean amplitude below this counts as silence
        const SILENCE_TAIL_MS = 900;     // stop after this many ms of silence
        const HARD_CAP_MS = 12_000;      // belt-and-suspenders max recording length
        const recordStartAt = Date.now();
        function tick() {
          // NB: read the live recorder state via the ref — never the `state`
          // closure, which is frozen at "idle" (start() has [] deps) and would
          // short-circuit VAD so the mic never auto-stops.
          if (!recRef.current || recRef.current.state !== "recording") return;
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          const mean = sum / data.length;
          if (mean < SILENCE_THRESHOLD) {
            if (silenceStartedAt == null) silenceStartedAt = Date.now();
            else if (Date.now() - silenceStartedAt > SILENCE_TAIL_MS) {
              // Stop recording — Whisper round-trip starts immediately.
              try { recRef.current?.stop(); } catch {}
              return;
            }
          } else {
            silenceStartedAt = null;
          }
          if (Date.now() - recordStartAt > HARD_CAP_MS) {
            try { recRef.current?.stop(); } catch {}
            return;
          }
          vadTimerRef.current = setTimeout(tick, 80);
        }
        vadTimerRef.current = setTimeout(tick, 600); // 600ms grace before VAD arms
        recordStream = dest.stream;
      } catch (gainErr) {
        // Audio context unavailable (Safari quirk, etc.) — just use raw stream.
        console.warn("[stt] audio gain stage skipped:", gainErr);
      }

      const mimeCandidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
      const mime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
      const rec = mime
        ? new MediaRecorder(recordStream, { mimeType: mime, audioBitsPerSecond: 128_000 })
        : new MediaRecorder(recordStream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        try {
          const blob = new Blob(chunksRef.current, { type: mime || "audio/webm" });
          streamRef.current?.getTracks().forEach((t) => t.stop());
          try { if (audioCtxRef.current && audioCtxRef.current.state !== "closed") audioCtxRef.current.close(); } catch {}
          if (vadTimerRef.current) clearTimeout(vadTimerRef.current);
          if (blob.size < 500) {
            setState("idle");
            return;
          }
          setState("transcribing");
          const fd = new FormData();
          fd.set("file", blob, "speech.webm");
          // whisper-large-v3 is the higher-accuracy variant. Turbo is faster
          // but loses tail consonants in far-field audio · v3 wins on the
          // 10-20m use case. Keep both flags so the server can pick.
          fd.set("model", "whisper-large-v3");
          fd.set("prompt", "Voice command for DelOS desktop. Apps: terminal, browser, builder, cohort, voice, mission. Verbs: open, build, run, race, summarize, recall, close. Math: plus minus times over.");
          const r = await fetch("/api/stt", { method: "POST", body: fd });
          const j = (await r.json()) as { text?: string; error?: string };
          if (j.error) {
            setError(j.error);
            setState("error");
            return;
          }
          // Drop Whisper's silence-hallucinations ("Thank you for watching!")
          // so a quiet/noisy recording doesn't auto-fire a phantom command.
          const clean = j.text && isWhisperHallucination(j.text) ? "" : (j.text ?? "");
          setTranscript(clean);
          setState("idle");
        } catch (e) {
          setError(e instanceof Error ? e.message : "transcribe failed");
          setState("error");
        }
      };
      // 250ms chunks so the partial buffer is small if VAD fires fast.
      rec.start(250);
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
    // Stable identity by design; 'state' is only read for branching, not deps.
  }, []);

  const stop = useCallback(() => {
    if (vadTimerRef.current) clearTimeout(vadTimerRef.current);
    try {
      recRef.current?.stop();
    } catch {}
  }, []);

  useEffect(
    () => () => {
      try {
        if (vadTimerRef.current) clearTimeout(vadTimerRef.current);
        recRef.current?.stop();
        streamRef.current?.getTracks().forEach((t) => t.stop());
        if (audioCtxRef.current && audioCtxRef.current.state !== "closed") audioCtxRef.current.close();
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
    // Hydrate the chosen STT provider on mount, then track pref changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    // N5 + V1 · expanded voice-driven OS control
    | "draft_email"
    | "read_email"
    | "create_note"
    | "schedule_action"
    | "set_reminder"
    | "create_event"
    | "parse_pdf"
    | "open_gdrive"
    | "store_memory"
    | "clear_memory"
    // VP-4 · server-side connector intents returned by /api/voice-command
    | "gmail_draft_reply"
    | "gmail_send"
    | "gmail_list_recent"
    | "notion_create_page"
    | "notion_search"
    | "gdrive_list_recent"
    | "gdrive_read_pdf"
    | "github_create_repo"
    | "github_create_issue"
    | "compound"
    | "unknown";
  // VP-4 · envelope fields the server includes for connector routing
  kind?: "integration_unavailable" | "integration_call" | "fulfilled" | "awaiting_approval";
  provider?: string;
  deepLink?: string;
  app?: string;
  payload?: string;
  reply: string;
  // Compound chain — server-side parser emits this when one transcript
  // contains two imperatives (e.g. "open terminal and 17 times 19"). The
  // OS shell fires each step sequentially.
  chain?: Array<{ intent: VoiceAction["intent"]; app?: string; payload?: string }>;
};

// Local regex fast-path → delegates to the canonical parseVoiceLocal so the
// client and server resolve identical intents (M10). parseVoiceLocal returns
// the narrower voiceParser.VoiceAction union; it is structurally assignable to
// the superset VoiceAction the voice client uses, so we widen with a cast.
function localMatch(raw: string): VoiceAction | null {
  return parseVoiceLocal(raw) as VoiceAction | null;
}

// Network-resilient command interpreter. Retries up to 2 times on transient
// failure (5xx / network) with exponential backoff. Hard-fail after 10s total.
// Falls back to a local "answer" payload so the voice loop never silently
// stalls — user always hears something.
export async function interpretCommand(transcript: string): Promise<VoiceAction | null> {
  // Fast path · regex matcher resolves common intents in ~0ms without an LLM
  // round trip. Removes the failure mode where the LLM mis-classified
  // "Build me an app named Vaibhav" as a chat "answer" and returned 200 words
  // of "create new project npx create-react-app…" instructions.
  const fast = localMatch(transcript);
  if (fast) return fast;

  const deadline = Date.now() + 10_000;
  let attempt = 0;
  let lastErr: unknown = null;
  while (Date.now() < deadline && attempt < 3) {
    attempt += 1;
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 6500);
    try {
      const r = await fetch("/api/voice-command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
        signal: ctrl.signal,
      });
      clearTimeout(timeout);
      if (r.status === 429) {
        // rate limited — surface to caller, don't retry
        return { intent: "answer", reply: "Slow down — voice agent is rate-limited. Try again in a moment." };
      }
      if (r.status >= 500) {
        lastErr = new Error(`http ${r.status}`);
        await sleep(250 * attempt);
        continue;
      }
      if (!r.ok) return null;
      const j = (await r.json()) as VoiceAction;
      return j;
    } catch (e) {
      clearTimeout(timeout);
      lastErr = e;
      // network blip / abort — back off and retry
      await sleep(250 * attempt);
    }
  }
  if (lastErr) {
    // Suppress noise for our own intentional aborts (the 6.5s timeout
    // we set above). Real network/server failures still log.
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    if (!/AbortError|aborted without reason/i.test(msg)) {
      console.warn("[voice] interpretCommand failed after retries:", lastErr);
    }
  }
  // Friendly fallback so TTS still says something.
  return { intent: "answer", reply: "I lost the network connection. Please try again." };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
