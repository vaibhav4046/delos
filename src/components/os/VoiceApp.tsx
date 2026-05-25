"use client";
import { useEffect, useRef, useState } from "react";
import * as Icons from "lucide-react";
import {
  // VoiceApp uses BROWSER STT directly (not the facade) so interim results
  // stream word-by-word as the user speaks. The facade defaults to Whisper,
  // which only returns text after recording ends — no live transcription.
  useBrowserSTT,
  speak,
  stopSpeaking,
  speechSupported,
  getVoicePrefs,
  interpretCommand,
  type VoiceAction,
} from "@/lib/useSpeech";
import { getModelOverrides } from "@/lib/useModelOverrides";
import { getTenantId } from "@/lib/useTenant";
import { requiresApproval } from "@/lib/skillManifest";
import { requestApproval } from "@/components/os/ApprovalGate";
import { enhanceBuildPrompt } from "@/lib/appPromptEnhancer";

// Voice agent — Claude-style premium voice mode.
//   - Big circular mic at the bottom; tap once to start, tap to stop
//   - Live transcript pane (interim + final), scrollable for long speech
//   - Autonomous coordinator runs by default: voice → plan → execute actions →
//     speak summary aloud. Tasks like "open cohort and ask which model wins for
//     short factual queries" actually happen, not just chat reply.
//   - State pills: idle · listening · transcribing · running plan · speaking

type Turn = {
  role: "user" | "agent" | "action" | "system";
  text: string;
  at: number;
};

type Phase = "idle" | "listening" | "transcribing" | "planning" | "executing" | "speaking" | "error";

export function VoiceApp() {
  const sup = speechSupported();
  const stt = useBrowserSTT();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  // LOOP defaults ON — after each reply, mic re-arms for follow-up like Siri.
  const [continuous, setContinuous] = useState(true);
  const [autonomy, setAutonomy] = useState(true); // ON by default — voice should DO things
  const continuousRef = useRef(continuous);
  continuousRef.current = continuous;
  const logRef = useRef<HTMLDivElement | null>(null);

  // Sync state from STT
  useEffect(() => {
    if (stt.state === "listening" || stt.state === "recording") setPhase("listening");
    else if (stt.state === "transcribing") setPhase("transcribing");
  }, [stt.state]);

  // Load autonomy pref (default ON, override possible)
  useEffect(() => {
    const prefs = getVoicePrefs();
    setAutonomy(prefs.autonomy !== false);
  }, []);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [turns.length, stt.transcript, stt.interim, phase]);

  // Submit on transcript landing
  useEffect(() => {
    if (
      (stt.state === "idle" || stt.state === "error") &&
      stt.transcript.trim() &&
      phase !== "planning" &&
      phase !== "executing" &&
      phase !== "speaking"
    ) {
      submit(stt.transcript.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stt.state, stt.transcript]);

  async function submit(text: string) {
    setTurns((t) => [...t, { role: "user", text, at: Date.now() }]);
    stt.setTranscript("");
    try {
      if (autonomy) {
        await runAutonomous(text);
      } else {
        await runChat(text);
      }
    } catch (e) {
      setPhase("error");
      setTurns((t) => [...t, { role: "agent", text: `error: ${(e as Error).message}`, at: Date.now() }]);
    } finally {
      setPhase("idle");
      if (continuousRef.current) {
        // Make absolutely sure TTS is off before re-opening the mic, or the
        // browser STT picks up the spoken reply as the next "user" turn and
        // the follow-up dies in a feedback loop ("agent: hi → mic hears
        // hi → agent: hi again").
        stopSpeaking();
        // Slightly longer gap (1.2s) so any tail audio + STT readiness flush.
        setTimeout(() => {
          // Re-check continuous flag at fire time — user may have toggled off.
          if (continuousRef.current) stt.start({ continuous: false });
        }, 1200);
      }
    }
  }

  async function runAutonomous(text: string) {
    setPhase("planning");
    // PRIMARY ROUTING: /api/voice-command returns a concrete intent + payload.
    // For "build me X", "run cohort Y", "open Z" — this is the fast path
    // that actually fires the OS to DO the thing, not just describe it.
    let action: VoiceAction | null = null;
    try {
      action = (await interpretCommand(text)) as VoiceAction | null;
    } catch {}

    // Fast path — concrete intents we know how to execute.
    if (action && action.intent !== "unknown" && action.intent !== "answer") {
      // Approval gate for risky intents (deploy / send_email / pay / etc.)
      // Read intents fire immediately — keeps voice feel snappy.
      if (requiresApproval(action.intent)) {
        const approved = await requestApproval({
          intent: action.intent,
          payload: action.payload,
        });
        if (!approved) {
          setTurns((t) => [
            ...t,
            { role: "system", text: `denied: ${action.intent}`, at: Date.now() },
          ]);
          return;
        }
      }
      setPhase("executing");
      setTurns((t) => [
        ...t,
        {
          role: "action",
          text: `${action!.intent}${action!.app ? " · " + action!.app : ""}${action!.payload ? " — " + action!.payload : ""}`,
          at: Date.now(),
        },
      ]);
      await executeVoiceIntent(action);
      if (action.reply) {
        setTurns((t) => [...t, { role: "agent", text: action!.reply, at: Date.now() }]);
        const prefs = getVoicePrefs();
        if (prefs.autoSpeak !== false) {
          setPhase("speaking");
          await speak(action.reply);
        }
      }
      return;
    }

    // For "answer" intent, just speak the answer directly — no coordinator hop.
    if (action && action.intent === "answer") {
      const reply = action.payload || action.reply;
      setTurns((t) => [...t, { role: "agent", text: reply, at: Date.now() }]);
      const prefs = getVoicePrefs();
      if (prefs.autoSpeak !== false) {
        setPhase("speaking");
        await speak(reply);
      }
      return;
    }

    // FALLBACK: coordinator for complex multi-step / ambiguous tasks.
    const r = await fetch("/api/coordinator", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        goal: text,
        tenantId: getTenantId() ?? undefined,
        models: getModelOverrides(),
      }),
    });
    const j = (await r.json()) as {
      summary?: string;
      actions?: Array<{ kind: string; target?: string; detail: string }>;
      error?: string;
    };
    if (j.error) {
      setTurns((t) => [...t, { role: "agent", text: `coordinator error: ${j.error}`, at: Date.now() }]);
      return;
    }
    if (j.summary) {
      setTurns((t) => [...t, { role: "agent", text: j.summary!, at: Date.now() }]);
    }
    setPhase("executing");
    if (j.actions?.length) {
      for (const a of j.actions) {
        setTurns((t) => [
          ...t,
          { role: "action", text: `${a.kind}${a.target ? "·" + a.target : ""} — ${a.detail}`, at: Date.now() },
        ]);
        await executeAction(a);
        await new Promise((res) => setTimeout(res, 180));
      }
    }
    if (j.summary) {
      const prefs = getVoicePrefs();
      if (prefs.autoSpeak !== false) {
        setPhase("speaking");
        await speak(j.summary);
      }
    }
  }

  // Execute a concrete voice intent by dispatching the right OS event with
  // the right payload. Critical: "build_app" must include the prompt so
  // App Builder auto-runs the build — opening it empty is not enough.
  async function executeVoiceIntent(action: VoiceAction) {
    const payload = action.payload ?? "";
    switch (action.intent) {
      case "compound":
        if (Array.isArray(action.chain)) {
          for (const step of action.chain.slice(0, 4)) {
            await executeVoiceIntent({ ...step, reply: "" } as VoiceAction);
            await new Promise((r) => setTimeout(r, 350));
          }
        }
        break;
      case "build_app": {
        // Route every spoken build through VibeCode. VibeCode then auto-promotes
        // serious prompts to the streamed multi-file DelCode path.
        const enhanced = enhanceBuildPrompt(payload).slice(0, 1500);
        window.dispatchEvent(new CustomEvent("delos-launch-app", { detail: { id: "builder" } }));
        // Wait so the window mounts + onIntent listener is alive before firing.
        await new Promise((r) => setTimeout(r, 400));
        window.dispatchEvent(new CustomEvent("delos-intent", { detail: { kind: "builder.build", prompt: enhanced } }));
        break;
      }
      case "run_cohort":
        window.dispatchEvent(new CustomEvent("delos-launch-app", { detail: { id: "cohort" } }));
        await new Promise((r) => setTimeout(r, 400));
        window.dispatchEvent(new CustomEvent("delos-intent", { detail: { kind: "cohort.run", goal: payload } }));
        break;
      case "run_mission":
        window.dispatchEvent(new CustomEvent("delos-launch-app", { detail: { id: "terminal" } }));
        await new Promise((r) => setTimeout(r, 400));
        window.dispatchEvent(new CustomEvent("delos-intent", { detail: { kind: "terminal.run", goal: payload } }));
        break;
      case "recall_memory":
        // "memory" OS app id resolves to the Memory Match game — wrong target.
        // Real memory browser lives at /memory. Open Del Assistant so the user
        // can ask the memory-aware chat, which already recalls HydraDB context.
        window.dispatchEvent(new CustomEvent("delos-launch-app", { detail: { id: "assistant" } }));
        await new Promise((r) => setTimeout(r, 400));
        // Fire memory.search anyway — Del Assistant or future memory browser can listen.
        window.dispatchEvent(new CustomEvent("delos-intent", { detail: { kind: "memory.search", query: payload } }));
        break;
      case "open_app":
        if (action.app) {
          window.dispatchEvent(new CustomEvent("delos-launch-app", { detail: { id: action.app } }));
          // If the user said "open browser show me X" or "open kanban" (which
          // we route to browser), pre-fill the browser's search with the
          // payload so the user lands on a useful page instead of /docs.
          if (action.app === "browser" && payload) {
            await new Promise((r) => setTimeout(r, 300));
            window.dispatchEvent(new CustomEvent("delos-intent", { detail: { kind: "browser.search", query: payload } }));
          }
        }
        break;
      case "close_window":
        window.dispatchEvent(new CustomEvent("delos-close-focused"));
        break;
      case "change_wallpaper":
        window.dispatchEvent(new CustomEvent("delos-wallpaper-cycle"));
        break;
      case "navigate":
        if (payload) window.location.href = payload;
        break;
      // N5 · voice-driven reminders + schedules + PDF + connector flows
      case "set_reminder": {
        // payload is JSON { text, minutes } from voice parser
        let text = "";
        let minutes = 30;
        try {
          const parsed = JSON.parse(payload);
          text = typeof parsed.text === "string" ? parsed.text : payload;
          minutes = typeof parsed.minutes === "number" ? parsed.minutes : 30;
        } catch {
          text = payload;
        }
        // Persist via localStorage (same shape WidgetsApp reads)
        try {
          const raw = localStorage.getItem("delos.reminders.v1");
          const list = raw ? JSON.parse(raw) : [];
          const r = { id: `rm-${Date.now()}`, text, dueAt: Date.now() + minutes * 60_000, done: false };
          localStorage.setItem("delos.reminders.v1", JSON.stringify([r, ...list]));
        } catch {}
        // Surface as a notification immediately so the user sees feedback
        window.dispatchEvent(new CustomEvent("toast", { detail: { text: `Reminder set · ${text} in ${minutes}m`, tone: "ok" } }));
        window.dispatchEvent(new CustomEvent("delos-launch-app", { detail: { id: "widgets" } }));
        break;
      }
      case "create_event": {
        // Call /api/calendar/events with the spoken text · server parses time.
        try {
          const r = await fetch("/api/calendar/events", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: payload.slice(0, 120), when: payload, source: "voice" }),
          });
          const j = (await r.json().catch(() => ({}))) as { event?: { startAt?: number; title?: string } };
          const when = j.event?.startAt ? new Date(j.event.startAt).toLocaleString() : "later";
          window.dispatchEvent(new CustomEvent("toast", { detail: { text: `📅 ${j.event?.title ?? "Event"} · ${when}`, tone: "ok" } }));
        } catch {
          window.dispatchEvent(new CustomEvent("toast", { detail: { text: "Calendar create failed", tone: "bad" } }));
        }
        window.dispatchEvent(new CustomEvent("delos-launch-app", { detail: { id: "calendar" } }));
        break;
      }
      case "schedule_action": {
        // Pop the schedule app; user picks template. Future: parse "daily X" → auto-create.
        window.dispatchEvent(new CustomEvent("delos-launch-app", { detail: { id: "schedule" } }));
        // Auto-create best-fit template if voice mentioned one
        const lower = payload.toLowerCase();
        let kind: "draft_email" | "read_email" | "notion_page" | "notify" | "run_mission" | "cohort" = "notify";
        let everyMs = 86_400_000; // daily default
        if (/email|inbox|gmail/.test(lower)) kind = "read_email";
        else if (/notion|note/.test(lower)) kind = "notion_page";
        else if (/cohort|model|race/.test(lower)) { kind = "cohort"; everyMs = 604_800_000; }
        else if (/mission|research|brief/.test(lower)) kind = "run_mission";
        else if (/hourly/.test(lower)) everyMs = 3_600_000;
        try {
          await fetch("/api/schedule", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              kind,
              label: payload.slice(0, 80),
              payload: kind === "cohort" ? { question: payload } : kind === "run_mission" ? { goal: payload } : { text: payload },
              everyMs,
            }),
          });
          window.dispatchEvent(new CustomEvent("toast", { detail: { text: `Schedule created · ${kind}`, tone: "ok" } }));
        } catch {}
        break;
      }
      case "parse_pdf":
      case "draft_email":
      case "read_email":
      case "create_note":
      case "open_gdrive":
        // Route to Del Assistant — its tryMcpAction handler dispatches to the
        // right connector route. Voice payload becomes the user's chat message.
        window.dispatchEvent(new CustomEvent("delos-launch-app", { detail: { id: "assistant" } }));
        await new Promise((r) => setTimeout(r, 400));
        window.dispatchEvent(new CustomEvent("delos-intent", { detail: { kind: "assistant.ask", prompt: payload } }));
        break;
    }
  }

  async function executeAction(a: { kind: string; target?: string; detail: string }) {
    // Map coordinator action kinds → OS intent events
    switch (a.kind) {
      case "open_app": {
        // target may be raw app id; if not, treat detail as id
        const appId = (a.target ?? a.detail).trim().toLowerCase().replace(/\s+/g, "");
        window.dispatchEvent(new CustomEvent("delos-launch-app", { detail: { id: appId } }));
        break;
      }
      case "ingest":
        window.dispatchEvent(new CustomEvent("delos-launch-app", { detail: { id: "ingest" } }));
        break;
      case "summarize":
      case "organize":
      case "tag":
      case "notify":
        // These don't auto-launch — handled by the spoken summary
        break;
    }
  }

  async function runChat(text: string) {
    setPhase("planning");
    const r = await fetch("/api/quick-agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: text, models: getModelOverrides(), tenantId: getTenantId() }),
    });
    const j = (await r.json()) as { text?: string; error?: string };
    const reply = j.text ?? `(err: ${j.error ?? "unknown"})`;
    setTurns((t) => [...t, { role: "agent", text: reply, at: Date.now() }]);
    const prefs = getVoicePrefs();
    if (prefs.autoSpeak !== false) {
      setPhase("speaking");
      await speak(reply);
    }
  }

  function pressMic() {
    if (stt.state === "listening" || stt.state === "recording") {
      stt.stop();
      return;
    }
    if (stt.state === "transcribing") return;
    stopSpeaking();
    setPhase("listening");
    stt.start({ continuous: false });
  }

  function toggleContinuous() {
    const next = !continuous;
    setContinuous(next);
    if (next && stt.state === "idle" && phase === "idle") stt.start({ continuous: false });
    if (!next) {
      stt.stop();
      stopSpeaking();
    }
  }

  function toggleAutonomy() {
    const next = !autonomy;
    setAutonomy(next);
    const p = getVoicePrefs();
    p.autonomy = next;
    try {
      localStorage.setItem("delos.voicePrefs.v2", JSON.stringify(p));
      window.dispatchEvent(new CustomEvent("delos-voice-changed"));
    } catch {}
  }

  if (!sup.tts && !sup.recorder && !sup.stt) {
    return (
      <div className="p-4 space-y-2 text-sm">
        <div className="font-pixel text-base tracking-wider" style={{ color: "var(--danger)" }}>VOICE UNSUPPORTED</div>
        <p className="font-mono text-xs text-[color:var(--muted)]">
          This browser doesn&apos;t expose speech APIs. Try Chrome / Edge / Safari.
        </p>
      </div>
    );
  }

  const recording = stt.state === "listening" || stt.state === "recording";
  const busy = phase === "planning" || phase === "executing" || phase === "speaking" || phase === "transcribing";
  const ringColor =
    phase === "listening" ? "var(--success)" :
    phase === "transcribing" ? "var(--warn)" :
    phase === "planning" || phase === "executing" ? "var(--accent)" :
    phase === "speaking" ? "var(--info, var(--accent))" :
    phase === "error" ? "var(--danger)" :
    "var(--surface-2)";

  return (
    <div className="p-3 space-y-3 text-xs h-full flex flex-col" style={{ minHeight: 480 }}>
      <div className="flex items-center justify-between flex-wrap gap-1">
        <div className="font-pixel text-sm tracking-wider" style={{ color: "var(--accent)" }}>
          ★ VOICE AGENT
        </div>
        <div className="flex gap-1 flex-wrap items-center">
          <span
            className="pill"
            style={{
              fontSize: 9,
              borderColor: ringColor,
              color: ringColor,
              background: "transparent",
            }}
          >
            ● {phase.toUpperCase()}
          </span>
          <button
            onClick={toggleAutonomy}
            className={`pill ${autonomy ? "pill-ok" : "pill-muted"} cursor-pointer`}
            title="Coordinator executes voice as multi-step plans"
          >
            <Icons.Wand2 size={10} /> {autonomy ? "AUTONOMOUS" : "CHAT MODE"}
          </button>
          <button
            onClick={toggleContinuous}
            className={`pill ${continuous ? "pill-ok" : "pill-muted"} cursor-pointer`}
            title="Auto-restart mic after each reply"
          >
            <Icons.Repeat size={10} /> {continuous ? "LOOP ON" : "LOOP"}
          </button>
          <button onClick={stopSpeaking} className="pill pill-warn cursor-pointer" title="Stop speaking">
            <Icons.VolumeX size={10} />
          </button>
        </div>
      </div>

      {/* Conversation + LIVE transcript pane */}
      <div
        ref={logRef}
        className="flex-1 overflow-y-auto border-2 p-3 space-y-2"
        style={{
          minHeight: 240,
          background: "var(--surface)",
          borderColor: "var(--surface-2)",
          fontFamily: "var(--font-mono)",
        }}
      >
        {turns.length === 0 && phase === "idle" && (
          <div className="text-[color:var(--muted)] space-y-2">
            <div className="font-pixel text-xs tracking-wider" style={{ color: "var(--accent)" }}>
              ★ TAP MIC AND SPEAK
            </div>
            <div className="text-[10px] leading-relaxed">
              Examples (autonomous):
              <ul className="mt-1 space-y-0.5 ml-3 list-disc">
                <li>"Open Del Assistant and ask why graph DBs beat vectors for agent memory"</li>
                <li>"Build me a stopwatch app"</li>
                <li>"Run cohort: best framework for AI agent OS"</li>
                <li>"Open ingest and add my Notion workspace"</li>
                <li>"Summarize my last 5 runs"</li>
              </ul>
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className="flex items-start gap-2">
            <span
              className={`pill mt-0.5 ${
                t.role === "user" ? "pill-info" : t.role === "action" ? "pill-warn" : t.role === "system" ? "pill-muted" : "pill-ok"
              }`}
              style={{ fontSize: 9, flexShrink: 0 }}
            >
              {t.role === "user" ? "YOU" : t.role === "action" ? "DO" : t.role === "system" ? "·" : "AGENT"}
            </span>
            <span
              className="text-[11px] leading-relaxed break-words"
              style={{ color: t.role === "action" ? "var(--warn)" : "var(--fg)" }}
            >
              {t.text}
            </span>
          </div>
        ))}
        {recording && (
          <div className="flex items-start gap-2">
            <span className="pill pill-warn mt-0.5 accent-pulse" style={{ fontSize: 9, flexShrink: 0 }}>
              ● LIVE
            </span>
            <div className="flex-1 min-w-0">
              <span className="text-[11px] leading-relaxed text-[color:var(--fg)] break-words">
                {stt.transcript}
                {stt.interim && (
                  <span style={{ color: "var(--muted)", fontStyle: "italic" }}>
                    {stt.transcript ? " " : ""}
                    {stt.interim}
                  </span>
                )}
                <span className="cursor" />
              </span>
              <VoiceWaveform color="var(--accent)" bars={22} />
            </div>
          </div>
        )}
        {phase === "transcribing" && (
          <div className="flex items-center gap-2 text-[color:var(--muted)]">
            <Icons.Loader2 size={12} className="animate-spin" />
            <span>transcribing via Whisper…</span>
            <VoiceWaveform color="var(--accent)" bars={18} />
          </div>
        )}
        {phase === "planning" && (
          <div className="flex items-center gap-2 text-[color:var(--muted)]">
            <Icons.Loader2 size={12} className="animate-spin" /> coordinator is planning…
          </div>
        )}
        {phase === "executing" && (
          <div className="flex items-center gap-2 text-[color:var(--accent)]">
            <Icons.Loader2 size={12} className="animate-spin" /> executing actions…
          </div>
        )}
        {phase === "speaking" && (
          <div className="flex items-center gap-2 text-[color:var(--success)]">
            <Icons.Volume2 size={12} className="accent-pulse" /> speaking…
          </div>
        )}
      </div>

      {/* Big mic — circular, pulses while listening */}
      <div className="flex flex-col items-center gap-2 pt-1">
        <button
          onClick={pressMic}
          disabled={busy && !recording}
          aria-label={recording ? "Stop listening" : "Tap to speak"}
          title={recording ? "Tap to stop" : "Tap to speak"}
          className="icon-premium dock-icon"
          style={{
            width: 96,
            height: 96,
            borderRadius: "50%",
            border: `3px solid ${ringColor}`,
            background: recording ? "var(--success)" : busy ? "var(--surface-2)" : "var(--accent)",
            color: recording ? "var(--on-accent)" : "var(--on-accent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: busy && !recording ? "not-allowed" : "pointer",
            boxShadow: recording
              ? "0 0 0 4px rgba(106, 176, 76, 0.4), 0 0 24px var(--success), 0 6px 0 0 rgba(0,0,0,0.3)"
              : "0 0 0 2px var(--bg), 0 0 0 4px var(--accent), 0 6px 0 0 var(--accent-shadow), 0 0 32px -8px var(--ring)",
            transition: "all 200ms cubic-bezier(0.34, 1.56, 0.64, 1)",
            position: "relative",
            transform: recording ? "scale(1.04)" : "scale(1)",
          }}
        >
          {recording ? (
            <Icons.MicOff size={42} color="currentColor" strokeWidth={1.75} />
          ) : busy ? (
            <Icons.Loader2 size={42} color="currentColor" strokeWidth={1.75} className="animate-spin" />
          ) : (
            <Icons.Mic size={42} color="currentColor" strokeWidth={1.75} />
          )}
          {recording && (
            <span
              className="absolute inset-0"
              style={{
                borderRadius: "50%",
                border: "3px solid var(--success)",
                animation: "voicePulse 1.4s ease-out infinite",
              }}
              aria-hidden
            />
          )}
        </button>
        <div className="text-[10px] font-mono text-center" style={{ color: "var(--muted)" }}>
          {recording
            ? "Listening — tap to stop"
            : phase === "transcribing"
              ? "Whisper transcribing…"
              : phase === "planning"
                ? "Coordinator planning…"
                : phase === "executing"
                  ? "Running actions…"
                  : phase === "speaking"
                    ? "Speaking…"
                    : autonomy
                      ? "Tap mic · speak any task · agent does it"
                      : "Tap mic · chat reply"}
        </div>
      </div>

      {stt.error && <div className="pill pill-bad self-center">{stt.error}</div>}

      {/* Text fallback · always available so the agent is usable when the
          mic is blocked / unavailable / locked behind a browser permission
          prompt. QA report 2026-05-25 flagged Voice Agent as "unusable
          without microphone". Same submit() path the STT pipeline uses. */}
      <VoiceTextFallback busy={busy} onSubmit={(t) => submit(t)} />
    </div>
  );
}

// Text-input fallback for Voice Agent · always-on type box so users can
// drive the agent without mic permissions / on browsers where Web Speech
// is unavailable. Submits via the same submit() the STT pipeline uses.
function VoiceTextFallback({ busy, onSubmit }: { busy: boolean; onSubmit: (text: string) => void }) {
  const [draft, setDraft] = useState("");
  function send() {
    const t = draft.trim();
    if (!t || busy) return;
    setDraft("");
    onSubmit(t);
  }
  return (
    <div className="mt-2 space-y-1">
      <div className="font-pixel text-[9px] tracking-widest text-center" style={{ color: "var(--muted)" }}>
        — OR TYPE —
      </div>
      <div className="flex gap-2">
        <input
          className="input-pixel flex-1"
          placeholder="type a task… (e.g. 'open browser and search hydration errors')"
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, 800))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
          disabled={busy}
          style={{ fontSize: 11 }}
        />
        <button
          onClick={send}
          disabled={!draft.trim() || busy}
          className="btn-pixel success"
          style={{ padding: "6px 12px", fontSize: 11 }}
        >
          ▶ RUN
        </button>
      </div>
    </div>
  );
}

// Yellow live-audio bars visible during listening + transcribing. Each bar is a
// pre-shuffled CSS animation so the heights look organic without hooking the
// actual mic stream (which would force AudioContext init + worklet plumbing
// and stall Safari). Pure visual cue.
function VoiceWaveform({ color = "var(--accent)", bars = 18 }: { color?: string; bars?: number }) {
  const seeds = Array.from({ length: bars }, (_, i) => ({
    delay: (i * 60) % 900,
    duration: 480 + ((i * 73) % 420),
    minH: 6 + ((i * 11) % 8),
  }));
  return (
    <div
      aria-hidden
      className="voice-waveform"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        height: 22,
        marginTop: 4,
        paddingLeft: 2,
      }}
    >
      {seeds.map((s, i) => (
        <span
          key={i}
          style={{
            display: "inline-block",
            width: 3,
            height: s.minH,
            background: color,
            borderRadius: 1,
            transformOrigin: "center",
            animation: `voiceBar ${s.duration}ms ease-in-out ${s.delay}ms infinite alternate`,
            boxShadow: `0 0 6px ${color}`,
          }}
        />
      ))}
      <style>{`
        @keyframes voiceBar {
          0%   { transform: scaleY(0.4); opacity: 0.55; }
          50%  { transform: scaleY(1.45); opacity: 1; }
          100% { transform: scaleY(0.7); opacity: 0.8; }
        }
      `}</style>
    </div>
  );
}

// Singleton listener registry — fires once per app mount
let busListenerInstalled = false;
export function installVoiceActionBus() {
  if (typeof window === "undefined" || busListenerInstalled) return;
  busListenerInstalled = true;
  void 0;
}
