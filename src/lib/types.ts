export type RunPhase =
  | "boot"
  | "plan"
  | "act"
  | "observe"
  | "critic"
  | "replan"
  | "recall"
  | "store"
  | "done"
  | "fail";

export type ChaosKind =
  | "tool_flake"
  | "tool_outage"
  | "goal_drift"
  | "context_flood"
  | "user_interrupt";

export type RunEvent =
  | { t: "meta"; runId: string; at: number }
  | { t: "phase"; phase: RunPhase; note?: string; at: number }
  | { t: "thought"; text: string; agent: "planner" | "executor" | "critic"; at: number }
  | { t: "tool_call"; name: string; args: unknown; at: number }
  | { t: "tool_result"; name: string; ok: boolean; result?: unknown; error?: string; at: number }
  | { t: "memory_write"; key: string; preview: string; at: number }
  | { t: "memory_recall"; query: string; hits: number; at: number }
  | { t: "recover"; reason: string; strategy: string; at: number }
  | { t: "adapt"; from: string; to: string; reason: string; at: number }
  | { t: "metric"; key: string; value: number; at: number }
  | { t: "usage"; role: "planner" | "executor" | "critic" | "appBuilder" | "subagent"; model: string; promptTokens: number; completionTokens: number; ms: number; at: number }
  | { t: "subagent"; id: string; goal: string; status: "spawn" | "done" | "fail"; result?: string; at: number }
  | { t: "answer"; text: string; at: number }
  | { t: "error"; message: string; at: number };

export type Plan = {
  goal: string;
  steps: Array<{ id: string; intent: string; tool?: string; args?: Record<string, unknown> }>;
  rationale: string;
  subgoals?: string[];
};

export type ToolResult = { ok: true; data: unknown } | { ok: false; error: string };

export type StoredMemory = {
  id: string;
  runId: string;
  text: string;
  tags: string[];
  createdAt: number;
};
