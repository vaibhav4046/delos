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
          if (state === "idle" || !recRef.current || recRef.current.state !== "recording") return;
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
          try { audioCtxRef.current?.close(); } catch {}
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
          setTranscript(j.text ?? "");
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
        audioCtxRef.current?.close();
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
    | "compound"
    | "unknown";
  app?: string;
  payload?: string;
  reply: string;
  // Compound chain — server-side parser emits this when one transcript
  // contains two imperatives (e.g. "open terminal and 17 times 19"). The
  // OS shell fires each step sequentially.
  chain?: Array<{ intent: VoiceAction["intent"]; app?: string; payload?: string }>;
};

// Local regex fast-path. Catches "build me X named Y", "open Z", "run cohort
// on X", "close", "wallpaper", and obvious math/greetings BEFORE we hit the
// LLM. Cuts latency to ~0ms for the common commands and removes the failure
// mode where the LLM mis-classifies "build me app" as an "answer" intent.
// Returns null if no local pattern matches — caller falls through to LLM.
function localMatch(raw: string): VoiceAction | null {
  const text = raw.trim();
  const lower = text.toLowerCase();

  // Greetings → speak directly
  if (/^(hi|hello|hey|yo|hola|hiya|sup)[\s.,!?]*$/i.test(lower)) {
    return { intent: "answer", payload: "Hey — what should we build?", reply: "Hey — what should we build?" };
  }

  // Basic math · "what is 2 + 2" / "calculate 5 times 7" / "23 plus 9"
  const math = lower.match(/(?:what\s+(?:is|are)\s+)?(\d+(?:\.\d+)?)\s*(plus|minus|times|over|divided\s+by|\+|-|\*|x|\/)\s*(\d+(?:\.\d+)?)/i);
  if (math) {
    const a = parseFloat(math[1]);
    const b = parseFloat(math[3]);
    const op = math[2].toLowerCase();
    let v: number | null = null;
    if (op === "plus" || op === "+") v = a + b;
    else if (op === "minus" || op === "-") v = a - b;
    else if (op === "times" || op === "*" || op === "x") v = a * b;
    else if (op === "over" || op === "divided by" || op === "/") v = b === 0 ? null : a / b;
    if (v != null) {
      const r = Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, "");
      return { intent: "answer", payload: r, reply: r };
    }
  }

  // "build me an app/application named/called X" / "build me X" / "create X app"
  // Strips the conversational shell ("hello hello, please build me…") so the
  // payload sent to App Builder is just the actual subject.
  const build = lower.match(/(?:^|[.,!]\s*)(?:please\s+)?(?:can\s+you\s+)?(?:could\s+you\s+)?(?:build|make|create)\s+(?:me\s+)?(?:an?\s+|the\s+)?(?:app(?:lication)?|tool|widget|clone\s+of|website|webapp)?\s*(?:named|called|for)?\s*(.{2,200}?)$/i);
  if (build) {
    const subject = build[1].trim().replace(/^["'`]|["'`]$/g, "");
    if (subject && !/^(it|that|one|this)$/i.test(subject)) {
      return {
        intent: "build_app",
        payload: subject,
        reply: `Building ${subject.length > 40 ? subject.slice(0, 40) + "…" : subject}.`,
      };
    }
  }

  // "run cohort on X" / "council X" / "race the models on X"
  const cohort = lower.match(/(?:run\s+(?:a\s+)?cohort|council|race\s+(?:the\s+)?models?)\s+(?:on|about|for|with)?\s+(.{3,200})$/i);
  if (cohort) {
    return { intent: "run_cohort", payload: cohort[1].trim(), reply: `Racing the models on ${cohort[1].slice(0, 30)}.` };
  }

  // "open X" — exact app id pass-through
  const open = lower.match(/^(?:please\s+)?(?:open|launch|start)\s+(?:the\s+)?([a-z0-9 _-]{2,30})(?:\s+app)?[.!?]*$/i);
  if (open) {
    const raw = open[1].trim().toLowerCase().replace(/\s+/g, "");
    const ALIASES: Record<string, string> = {
      delassistant: "assistant", chat: "assistant", del: "assistant",
      kanban: "builder", pomodoro: "builder", timer: "builder",
      doom: "doom", deldoom: "doom",
      music: "browser", youtube: "browser", google: "browser",
    };
    const app = ALIASES[raw] ?? raw;
    return { intent: "open_app", app, payload: "", reply: `Opening ${app}.` };
  }

  // "close" / "close this" / "close window"
  if (/^(close|dismiss|exit)(\s+(this|window|the\s+window))?[.!?]*$/i.test(lower)) {
    return { intent: "close_window", reply: "Closed." };
  }

  // "next/change wallpaper"
  if (/(change|next|cycle|swap)\s+(?:the\s+)?(?:wall\s*paper|background)/i.test(lower)) {
    return { intent: "change_wallpaper", reply: "Wallpaper changed." };
  }

  return null;
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
    console.warn("[voice] interpretCommand failed after retries:", lastErr);
  }
  // Friendly fallback so TTS still says something.
  return { intent: "answer", reply: "I lost the network connection. Please try again." };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
