// Judge demo state machine. One minute total. Five visible steps. Each
// step carries a short title plus a one sentence explanation card so a
// viewer who never used DelOS understands what just fired and why.
//
// runJudgeDemo wires steps to a handler object the caller supplies
// (spawn an app, emit an intent, push an overlay card, push a toast).
// Returns a cancel function so users can abort mid run by hitting Esc
// or by re clicking the button.

export type JudgeAppKey =
  | "assistant"
  | "builder"
  | "mission"
  | "memoryBrowser"
  | "memory"
  | "voice";

export type JudgeIntent =
  | { kind: "assistant.ask"; text: string }
  | { kind: "builder.build"; prompt: string }
  | { kind: "memory.search"; query: string };

export type JudgeStep = {
  // 1 indexed step number for the badge.
  index: number;
  // Short eyebrow label, all caps, shown at the top of the card.
  label: string;
  // Long explanation, two short sentences max, what the step is doing.
  // Read aloud by judges if they pause the demo.
  explainer: string;
  // App to open before the side effect fires. null keeps the focus on
  // whatever is already open.
  open: JudgeAppKey | null;
  // Optional follow up intent fired about 300ms after the open call so
  // the target app has time to mount its listeners.
  intent: JudgeIntent | null;
  // Milliseconds to wait BEFORE this step fires. Cumulative offsets are
  // computed by the runner. Tuned so the whole demo finishes in 60 s.
  hold: number;
};

// Five steps. Total runtime fits a 60 s window. Each card holds about
// 12 s, the last card holds longer so the closing line can land.
export const JUDGE_DEMO_STEPS: JudgeStep[] = [
  {
    index: 1,
    label: "GMAIL",
    explainer:
      "Del Assistant writes a real Gmail draft for the judges. Demo mode returns a simulated preview when no Google account is connected.",
    open: "assistant",
    intent: {
      kind: "assistant.ask",
      text: "draft email to judges@delrio.app about hackathon final demo recap",
    },
    hold: 0,
  },
  {
    index: 2,
    label: "NOTION",
    explainer:
      "Same conversation now creates a Notion page titled DelOS Hackathon Demo Recap. Tagged as MCP so memory can find it later.",
    open: null,
    intent: {
      kind: "assistant.ask",
      text: "create notion page titled DelOS Hackathon Demo Recap",
    },
    hold: 11000,
  },
  {
    index: 3,
    label: "GITHUB",
    explainer:
      "Del Assistant lists your live GitHub repositories without leaving the chat. Real repos via the GitHub API on the public path.",
    open: null,
    intent: { kind: "assistant.ask", text: "list my github repos" },
    hold: 11000,
  },
  {
    index: 4,
    label: "VIBECODE",
    explainer:
      "VibeCode opens and streams a working Investor CRM with warm intro graph and pipeline kanban. Files land live into DelCode.",
    open: "builder",
    intent: {
      kind: "builder.build",
      prompt:
        "Investor CRM with warm intro graph. Investor list with stage, check size, thesis. Mutual connection chips per row. Intro request composer. Pipeline kanban from sourced to met to diligence to term sheet to closed. Follow up reminder dock.",
    },
    hold: 12000,
  },
  {
    index: 5,
    label: "MEMORY",
    explainer:
      "Memory Browser opens with a recall pre filled. Every action above wrote a typed memory. Cross action recall in one tab.",
    open: "memoryBrowser",
    intent: { kind: "memory.search", query: "investor CRM and demo recap" },
    hold: 13000,
  },
];

// Total demo runtime including the closing pulse.
export const JUDGE_DEMO_TOTAL_MS = JUDGE_DEMO_STEPS.reduce((s, x) => s + x.hold, 0) + 13000;

export type JudgeOverlayCard = {
  index: number;
  total: number;
  label: string;
  explainer: string;
};

export type JudgeHandlers = {
  // Bring the named app to the foreground. Must be synchronous from
  // the caller perspective; the runner relies on its return having
  // mounted the app intent listeners by the time the 300ms follow up
  // intent fires.
  spawn: (app: JudgeAppKey) => void;
  // Side effect dispatch. Usually a thin wrapper over the global
  // emitIntent bus used by the OS shell.
  emit: (intent: JudgeIntent) => void;
  // Optional toast pump. Older callers still use this for the corner
  // notification stack. New overlay supersedes it but both can coexist.
  toast?: (text: string, tone?: "ok" | "info") => void;
  // Overlay card pump. Caller renders a fullscreen narration card.
  card?: (card: JudgeOverlayCard | null) => void;
  // Optional. Called once the final step has fired so the caller can
  // light up a demo complete pulse, log telemetry, etc.
  onDone?: () => void;
};

export type JudgeRunController = { cancel: () => void };

// Fire the script. Returns a controller so the caller can cancel any
// pending steps if the user re clicks the button mid run.
export function runJudgeDemo(
  handlers: JudgeHandlers,
  steps: JudgeStep[] = JUDGE_DEMO_STEPS,
): JudgeRunController {
  const timers: ReturnType<typeof setTimeout>[] = [];
  let cancelled = false;
  let offset = 0;
  const total = steps.length;
  for (const step of steps) {
    offset += step.hold;
    const at = offset;
    const t = setTimeout(() => {
      if (cancelled) return;
      handlers.toast?.(`judge ${step.index}/${total} · ${step.label}`, "ok");
      handlers.card?.({ index: step.index, total, label: step.label, explainer: step.explainer });
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
          handlers.toast?.("judge demo complete · five pillars green", "info");
          handlers.card?.(null);
          handlers.onDone?.();
        }, 13000);
        timers.push(w);
      }
    }, at);
    timers.push(t);
  }
  return {
    cancel: () => {
      cancelled = true;
      handlers.card?.(null);
      for (const t of timers) clearTimeout(t);
    },
  };
}
