"use client";

// Tiny intent bus — used to push voice-derived actions into already-mounted system apps.

export type AppIntent =
  | { kind: "terminal.run"; goal: string }
  | { kind: "builder.build"; prompt: string }
  // M7 · `cohort.run` retired — the Cohort app was removed from the product
  // and its component deleted. The run_cohort voice intent now routes to the
  // assistant, so nothing emits or listens for this kind anymore.
  | { kind: "assistant.ask"; text: string }
  | { kind: "memory.search"; query: string };

export function emitIntent(intent: AppIntent) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("delos-intent", { detail: intent }));
}

export function onIntent<K extends AppIntent["kind"]>(
  kind: K,
  handler: (intent: Extract<AppIntent, { kind: K }>) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  function listener(e: Event) {
    const d = (e as CustomEvent<AppIntent>).detail;
    if (d?.kind === kind) handler(d as Extract<AppIntent, { kind: K }>);
  }
  window.addEventListener("delos-intent", listener);
  return () => window.removeEventListener("delos-intent", listener);
}

// Broadcast agent activity for AgentPulse widget — non-blocking
export function broadcastAgent(id: string, status: "thinking" | "tool" | "done" | "idle" | "error") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("delos-agent-activity", { detail: { id, status } }));
}
