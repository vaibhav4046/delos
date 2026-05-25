// Judge-demo state machine · brand QA P0-12. Single source of truth for
// the autonomous demo path so the OS shell does not bury 100 lines of
// inlined `setTimeout` glue. Each step is a pure declaration of:
//   • the toast the judge sees,
//   • the side-effects to fire,
//   • the delay before the NEXT step starts.
//
// `runJudgeDemo` wires steps to a handler object the caller supplies
// (spawn an app, emit an intent, push a toast). Returns a cancel
// function so users can abort mid-run by hitting Esc or re-clicking
// the button.
//
// Why a state machine instead of a giant chain of setTimeouts:
//   • Steps are introspectable — tests can assert "5 steps, each ≤6s".
//   • Cancelling a half-run no longer leaks pending setTimeouts.
//   • The same script can be replayed in /demo for cold-load judges.

export type JudgeAppKey =
  | "assistant"
  | "builder"
  | "mission"
  | "memory"
  | "voice";

export type JudgeIntent =
  | { kind: "assistant.ask"; text: string }
  | { kind: "builder.build"; prompt: string }
  | { kind: "memory.search"; query: string };

export type JudgeStep = {
  // 1-indexed step number for the toast label.
  index: number;
  // What the judge reads in the corner toast.
  label: string;
  // App to open before the side-effect fires. `null` keeps the focus
  // on whatever is already open.
  open: JudgeAppKey | null;
  // Optional follow-up intent fired ~300ms after the open call so the
  // target app has time to mount its listeners.
  intent: JudgeIntent | null;
  // Milliseconds to wait BEFORE this step fires. Cumulative offsets
  // are computed by the runner.
  hold: number;
};

// 5 steps · brand QA P0-12 requirement. Tight enough to fit a judge's
// attention window (~30s total), wide enough to exercise every pillar:
//   1. MCP autonomous · Gmail draft
//   2. MCP autonomous · Notion page
//   3. MCP autonomous · GitHub list
//   4. VibeCode build · investor CRM (domain cockpit, not a clone)
//   5. Memory recall · pin-then-recall round trip
export const JUDGE_DEMO_STEPS: JudgeStep[] = [
  {
    index: 1,
    label: "GMAIL MCP — drafting an email…",
    open: "assistant",
    intent: {
      kind: "assistant.ask",
      text: "draft email to judges@delrio.app about hackathon final demo recap",
    },
    hold: 0,
  },
  {
    index: 2,
    label: "NOTION MCP — creating a recap page…",
    open: null,
    intent: {
      kind: "assistant.ask",
      text: "create notion page titled DelOS Hackathon Demo Recap",
    },
    hold: 5500,
  },
  {
    index: 3,
    label: "GITHUB MCP — listing repositories…",
    open: null,
    intent: { kind: "assistant.ask", text: "list my github repos" },
    hold: 5500,
  },
  {
    index: 4,
    label: "VIBECODE — building an Investor CRM cockpit…",
    open: "builder",
    intent: {
      kind: "builder.build",
      prompt:
        "Investor CRM with warm-intro graph — investor list with stage / check-size / thesis, mutual-connection chips per row, intro request composer, pipeline kanban (sourced → met → diligence → TS → closed), follow-up reminder dock.",
    },
    hold: 6000,
  },
  {
    index: 5,
    label: "MISSION CONTROL — pinned-memory recall",
    open: "mission",
    intent: { kind: "memory.search", query: "investor CRM and demo recap" },
    hold: 6000,
  },
];

export type JudgeHandlers = {
  // Bring the named app to the foreground. Must be synchronous from
  // the caller's perspective; the runner relies on its return having
  // mounted the app's intent listeners by the time the 300ms follow-up
  // intent fires.
  spawn: (app: JudgeAppKey) => void;
  // Side-effect dispatch — usually a thin wrapper over the global
  // `emitIntent` bus used by the OS shell.
  emit: (intent: JudgeIntent) => void;
  // Surface the step label as a toast. Tone is always "ok" except for
  // the final wrap-up which the caller can promote to "info".
  toast: (text: string, tone?: "ok" | "info") => void;
  // Optional · called once the final step has fired so the caller can
  // light up a "demo complete" pulse, log telemetry, etc.
  onDone?: () => void;
};

export type JudgeRunController = { cancel: () => void };

// Fire the script. Returns a controller so the caller can cancel any
// pending steps if the user re-clicks the button mid-run.
export function runJudgeDemo(
  handlers: JudgeHandlers,
  steps: JudgeStep[] = JUDGE_DEMO_STEPS,
): JudgeRunController {
  const timers: ReturnType<typeof setTimeout>[] = [];
  let cancelled = false;
  let offset = 0;
  for (const step of steps) {
    offset += step.hold;
    const at = offset;
    const t = setTimeout(() => {
      if (cancelled) return;
      handlers.toast(`★ judge ${step.index}/${steps.length} · ${step.label}`, "ok");
      if (step.open) handlers.spawn(step.open);
      if (step.intent) {
        // 300ms grace lets the target app subscribe to the intent bus
        // before we dispatch. Matches the inline setTimeout the OS
        // shell used to do in runDemoTour.
        const i = setTimeout(() => {
          if (cancelled) return;
          handlers.emit(step.intent!);
        }, 300);
        timers.push(i);
      }
      if (step.index === steps.length) {
        const w = setTimeout(() => {
          if (cancelled) return;
          handlers.toast("★ judge demo complete · all 5 pillars green", "info");
          handlers.onDone?.();
        }, 1800);
        timers.push(w);
      }
    }, at);
    timers.push(t);
  }
  return {
    cancel: () => {
      cancelled = true;
      for (const t of timers) clearTimeout(t);
    },
  };
}
