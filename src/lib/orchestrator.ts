import { nanoid } from "nanoid";
import { buildRegistry } from "./tools/builtin";
import type { Tool, ToolCtx } from "./tools/registry";
import { makePlan } from "./agents/planner";
import { pickToolCall, finalAnswer } from "./agents/executor";
import { critique } from "./agents/critic";
import { runQuickAgent } from "./agents/quick";
import type { LLMUsage } from "./agents/jsonGen";
import { ensureTenant, safeAddMemory, safeRecall } from "./hydra";
import { env } from "./env";
import { makeToolPolicy } from "./resilience";
import { popSteer } from "./steerStore";
import type { ChaosKind, RunEvent } from "./types";

export type RunOptions = {
  goal: string;
  chaos?: ChaosKind[];
  interrupt?: { afterSteps: number; newGoal: string };
  maxSteps?: number;
  extraTools?: Tool[];
  tenantId?: string;
};

type Role = "planner" | "executor" | "critic" | "appBuilder" | "subagent";

export async function* orchestrate(opts: RunOptions): AsyncGenerator<RunEvent> {
  const runId = nanoid(10);
  const startedAt = Date.now();
  const chaos = new Set<string>(opts.chaos ?? []);
  const maxSteps = opts.maxSteps ?? 8;
  let goal = opts.goal;
  let originalGoal = opts.goal;
  const initialGoal = opts.goal;

  const usageQueue: RunEvent[] = [];
  const onUsage = (role: Role) => (u: LLMUsage) => {
    usageQueue.push({
      t: "usage",
      role,
      model: u.model,
      promptTokens: u.promptTokens,
      completionTokens: u.completionTokens,
      ms: u.ms,
      at: Date.now(),
    });
  };
  const drain = (): RunEvent[] => {
    const out = usageQueue.splice(0);
    return out;
  };

  yield { t: "meta", runId, at: Date.now() };
  yield { t: "phase", phase: "boot", note: `run ${runId}`, at: Date.now() };

  const tenantId = opts.tenantId ?? env.DELRIO_TENANT_ID;
  await ensureTenant(tenantId);

  yield { t: "phase", phase: "recall", note: "querying HydraDB save-state", at: Date.now() };
  const memHits = await safeRecall({ tenantId, query: goal, topK: 4 });
  yield { t: "memory_recall", query: goal, hits: memHits.length, at: Date.now() };

  const registry = buildRegistry();
  if (opts.extraTools) for (const t of opts.extraTools) registry.register(t);
  const tools = registry.list();

  if (chaos.has("context_flood")) {
    for (let i = 0; i < 20; i++) memHits.push({ text: `noise-${i}: irrelevant memory entry filler`, score: 0.01 });
  }

  yield { t: "phase", phase: "plan", at: Date.now() };
  let plan = await makePlan({ goal, tools, memoryHints: memHits.map((m) => m.text), onUsage: onUsage("planner") });
  for (const e of drain()) yield e;
  yield { t: "thought", agent: "planner", text: plan.rationale, at: Date.now() };

  const scratch: string[] = [];

  // --- Sub-agent fan-out ---
  if (plan.subgoals && plan.subgoals.length > 0) {
    const subIds = plan.subgoals.map((_, i) => `sub-${runId}-${i}`);
    for (let i = 0; i < plan.subgoals.length; i++) {
      yield { t: "subagent", id: subIds[i], goal: plan.subgoals[i], status: "spawn", at: Date.now() };
    }
    const settled = await Promise.allSettled(
      plan.subgoals.map((g) => runQuickAgent({ prompt: g, onUsage: onUsage("subagent") })),
    );
    for (const e of drain()) yield e;
    for (let i = 0; i < settled.length; i++) {
      const s = settled[i];
      if (s.status === "fulfilled") {
        scratch.push(`subagent[${i}] answered "${plan.subgoals[i].slice(0, 60)}": ${s.value.slice(0, 200)}`);
        yield { t: "subagent", id: subIds[i], goal: plan.subgoals[i], status: "done", result: s.value.slice(0, 240), at: Date.now() };
      } else {
        yield { t: "subagent", id: subIds[i], goal: plan.subgoals[i], status: "fail", result: String(s.reason).slice(0, 200), at: Date.now() };
      }
    }
  }

  const toolHistory: Array<{ tool: string; ok: boolean; summary: string }> = [];
  const policy = makeToolPolicy();
  let stepIdx = 0;
  let consecutiveFailures = 0;
  let replans = 0;
  let finalAnswerText: string | null = null;
  let interruptFired = false;
  // Total completed steps counter — survives replans (unlike stepIdx which resets)
  let stepsCompleted = 0;
  const startTime = Date.now();

  while (stepIdx < Math.min(plan.steps.length, maxSteps)) {
    const step = plan.steps[stepIdx];

    // Live steering: pick up any user instructions injected via /api/steer
    const steer = popSteer(runId);
    if (steer) {
      const oldGoal = goal;
      const newGoal = `${originalGoal}\n[LIVE STEER from user]: ${steer}`;
      goal = newGoal;
      originalGoal = newGoal;
      yield { t: "adapt", from: oldGoal.slice(0, 80), to: steer.slice(0, 80), reason: "live human-in-the-loop steer", at: Date.now() };
      yield { t: "phase", phase: "replan", note: "user steered mid-run", at: Date.now() };
      plan = await makePlan({
        goal,
        tools,
        memoryHints: memHits.map((m) => m.text),
        priorAttempt: { what: "prior plan", why: `user steered: ${steer}` },
        onUsage: onUsage("planner"),
      });
      for (const e of drain()) yield e;
      yield { t: "thought", agent: "planner", text: plan.rationale, at: Date.now() };
      stepIdx = 0;
      continue;
    }

    // Interrupt fires once after N completed steps (not stepIdx, which resets on replans)
    if (opts.interrupt && !interruptFired && stepsCompleted >= opts.interrupt.afterSteps) {
      interruptFired = true;
      const oldGoal = goal;
      goal = opts.interrupt.newGoal;
      originalGoal = opts.interrupt.newGoal;
      yield {
        t: "adapt",
        from: oldGoal.slice(0, 120),
        to: goal.slice(0, 120),
        reason: "user_interrupt",
        at: Date.now(),
      };
      yield { t: "phase", phase: "replan", note: `adapting to new goal: ${goal.slice(0, 60)}`, at: Date.now() };
      plan = await makePlan({
        goal,
        tools,
        memoryHints: memHits.map((m) => m.text),
        priorAttempt: { what: `working on: ${oldGoal.slice(0, 80)}`, why: "user switched objective" },
        onUsage: onUsage("planner"),
      });
      for (const e of drain()) yield e;
      yield { t: "thought", agent: "planner", text: plan.rationale, at: Date.now() };
      stepIdx = 0;
      continue;
    }

    yield { t: "phase", phase: "act", note: `step ${stepIdx + 1}/${plan.steps.length}: ${step.intent}`, at: Date.now() };

    const call = await pickToolCall({
      goal,
      stepIntent: step.intent,
      tools,
      scratch,
      lastError: consecutiveFailures > 0 ? toolHistory.at(-1)?.summary : undefined,
      onUsage: onUsage("executor"),
    });
    for (const e of drain()) yield e;
    yield { t: "thought", agent: "executor", text: call.reasoning, at: Date.now() };

    const ctx: ToolCtx = {
      runId,
      chaos,
      emit: (e) => {
        if (e.kind === "scratchpad" && typeof (e.data as { text?: string }).text === "string") {
          scratch.push((e.data as { text: string }).text);
        }
        if (e.kind === "final_answer" && typeof (e.data as { text?: string }).text === "string") {
          finalAnswerText = (e.data as { text: string }).text;
        }
      },
    };

    yield { t: "tool_call", name: call.tool, args: call.args, at: Date.now() };

    let result: { ok: boolean; data?: unknown; error?: string };
    try {
      result = await policy.execute(async () => {
        const r = await registry.execute(call.tool, call.args, ctx);
        if (!r.ok) throw new Error(r.error);
        return { ok: true, data: r.data };
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const fbs = registry.fallbacks(call.tool);
      if (fbs.length > 0) {
        const fb = fbs[0];
        yield { t: "recover", reason: msg, strategy: `switching to fallback tool: ${fb.name}`, at: Date.now() };
        try {
          const fbCall = await pickToolCall({
            goal,
            stepIntent: step.intent + ` (use ${fb.name} instead of ${call.tool})`,
            tools: [fb],
            scratch,
            lastError: msg,
            onUsage: onUsage("executor"),
          });
          for (const e of drain()) yield e;
          yield { t: "tool_call", name: fb.name, args: fbCall.args, at: Date.now() };
          const r2 = await registry.execute(fb.name, fbCall.args, ctx);
          result = r2.ok ? { ok: true, data: r2.data } : { ok: false, error: r2.error };
        } catch (e2) {
          result = { ok: false, error: e2 instanceof Error ? e2.message : String(e2) };
        }
      } else {
        result = { ok: false, error: msg };
      }
    }

    const summary = result.ok ? JSON.stringify(result.data).slice(0, 200) : `error: ${result.error}`;
    yield {
      t: "tool_result",
      name: call.tool,
      ok: result.ok,
      result: result.ok ? result.data : undefined,
      error: result.ok ? undefined : result.error,
      at: Date.now(),
    };
    toolHistory.push({ tool: call.tool, ok: result.ok, summary });

    if (result.ok) {
      consecutiveFailures = 0;
      scratch.push(`${call.tool}: ${summary}`);
      // Short-circuit on final_answer
      if (call.tool === "final_answer" && finalAnswerText) {
        break;
      }
    } else {
      consecutiveFailures += 1;
      if (consecutiveFailures >= 2 && replans < 2) {
        replans += 1;
        yield { t: "recover", reason: `${consecutiveFailures} consecutive failures`, strategy: "replanning with prior failure context", at: Date.now() };
        yield { t: "phase", phase: "replan", at: Date.now() };
        plan = await makePlan({
          goal,
          tools,
          memoryHints: memHits.map((m) => m.text),
          priorAttempt: { what: call.tool, why: result.error ?? "unknown failure" },
          onUsage: onUsage("planner"),
        });
        for (const e of drain()) yield e;
        stepIdx = 0;
        consecutiveFailures = 0;
        continue;
      }
    }

    yield { t: "phase", phase: "critic", at: Date.now() };
    const verdict = await critique({
      originalGoal,
      currentPlanSummary: plan.rationale,
      lastStep: { intent: step.intent, toolResult: summary },
      onUsage: onUsage("critic"),
    });
    for (const e of drain()) yield e;
    yield { t: "thought", agent: "critic", text: `${verdict.verdict} (drift=${verdict.driftScore.toFixed(2)}): ${verdict.critique}`, at: Date.now() };
    yield { t: "metric", key: "drift", value: verdict.driftScore, at: Date.now() };

    if (verdict.verdict === "replan" && replans < 2) {
      replans += 1;
      // Use critic's structured newGoal when provided; fall back to a templated rewrite.
      const cleanNewGoal = (verdict.newGoal && verdict.newGoal.length <= 120 && verdict.newGoal.length >= 10)
        ? verdict.newGoal
        : `Re-attempt: ${originalGoal.slice(0, 100)}`;
      yield {
        t: "adapt",
        from: plan.rationale.slice(0, 80),
        to: cleanNewGoal,
        reason: `drift_${verdict.driftScore.toFixed(2)}_critic_intervention`,
        at: Date.now(),
      };
      yield { t: "phase", phase: "replan", at: Date.now() };
      plan = await makePlan({
        goal,
        tools,
        memoryHints: memHits.map((m) => m.text),
        priorAttempt: { what: "previous plan drifted", why: verdict.critique },
        onUsage: onUsage("planner"),
      });
      for (const e of drain()) yield e;
      stepIdx = 0;
      continue;
    }

    stepIdx += 1;
    stepsCompleted += 1;
  }

  yield { t: "phase", phase: "done", at: Date.now() };
  let answer: string;
  if (finalAnswerText) {
    // Planner included final_answer as last step — use its output directly
    answer = finalAnswerText;
  } else {
    answer = await finalAnswer({ goal, scratch, toolHistory, onUsage: onUsage("executor") });
    for (const e of drain()) yield e;
  }
  yield { t: "answer", text: answer, at: Date.now() };

  yield { t: "phase", phase: "store", at: Date.now() };
  const memText = `Run completed for goal: "${originalGoal}". Final answer: ${answer.slice(0, 200)}. Tools used: ${toolHistory.map((t) => t.tool).join(", ")}.`;
  await safeAddMemory({
    tenantId,
    text: memText,
    metadata: { runId, tags: ["run-summary"], goalFamily: initialGoal.slice(0, 40) },
  });
  yield { t: "memory_write", key: runId, preview: memText.slice(0, 100), at: Date.now() };

  const elapsed = Date.now() - startTime;
  yield { t: "metric", key: "elapsed_ms", value: elapsed, at: Date.now() };
  yield { t: "metric", key: "replans", value: replans, at: Date.now() };
  yield { t: "metric", key: "tool_calls", value: toolHistory.length, at: Date.now() };
  yield { t: "metric", key: "successes", value: toolHistory.filter((t) => t.ok).length, at: Date.now() };
  yield { t: "metric", key: "wall_time_ms", value: Date.now() - startedAt, at: Date.now() };
}
