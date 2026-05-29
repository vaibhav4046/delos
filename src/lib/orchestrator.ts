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
  // Wall-clock budget for the STEP LOOP. We stop starting new steps past this
  // and synthesize a best-effort answer, leaving headroom for final synthesis
  // before the route's maxDuration (60s) hard-kills the function with no answer.
  deadlineMs?: number;
  // Client-disconnect signal · when the SSE consumer (browser fetch reader)
  // goes away the route aborts this, so we stop starting new steps and burning
  // LLM calls on a run nobody is listening to. Checked at the top of each step.
  signal?: AbortSignal;
};

type Role = "planner" | "executor" | "critic" | "appBuilder" | "subagent";

// Input bounds — keep prompts from growing without limit across replans, long
// runs, or the `context_flood` chaos mode (which injects 20 noise memories).
// Unbounded memory hints + scratchpad inflate every planner/executor/critic
// prompt, driving latency, token cost, and provider context-limit errors.
const MAX_HINTS = 8;
const MAX_HINT_LEN = 500;
const MAX_SCRATCH = 16;
const MAX_SCRATCH_ENTRY = 300;

function boundedHints(hits: Array<{ text: string }>): string[] {
  return hits.slice(0, MAX_HINTS).map((h) => h.text.slice(0, MAX_HINT_LEN));
}

// Append to the scratchpad with per-entry length + sliding-window size caps.
function pushScratch(scratch: string[], entry: string): void {
  scratch.push(entry.slice(0, MAX_SCRATCH_ENTRY));
  if (scratch.length > MAX_SCRATCH) scratch.splice(0, scratch.length - MAX_SCRATCH);
}

function extractExactFacts(goal: string): Array<{ key: string; value: string }> {
  if (!/\b(remember|store|save|pin)\b/i.test(goal)) return [];
  const facts: Array<{ key: string; value: string }> = [];
  // Split the goal on conjunction-like separators so multiple "k=v"
  // pairs in a single sentence don't collide into one greedy match.
  // Before: "remember user_name=Varun and response_style=terse and
  // project_codename=Foo" produced a single fact where user_name's
  // value swallowed the rest of the sentence. Now we split first and
  // match k=v inside each segment.
  const segments = goal
    .split(/(?:[;,\.]|\s+(?:and|then|also)\s+)/i)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const seg of segments) {
    const m = seg.match(/\b([a-z][a-z0-9_]{1,60})\s*=\s*(.+)$/i);
    if (m) {
      const value = m[2].trim().replace(/^["']|["']$/g, "").slice(0, 400);
      if (value) facts.push({ key: m[1], value });
    }
  }
  const name = goal.match(/\b(?:call me|my name is|name is)\s+([A-Z][a-zA-Z0-9_-]{1,60})/);
  if (name && !facts.some((f) => f.key === "user_name")) facts.push({ key: "user_name", value: name[1] });
  const style = goal.match(/\b(?:prefer|use)\s+([^.;]{3,80}?\b(?:answers?|style|bullets?|format))/i);
  if (style && !facts.some((f) => f.key === "response_style")) facts.push({ key: "response_style", value: style[1].trim() });
  return facts.filter((f) => f.key && f.value);
}

function formatPinnedFacts(hits: Array<{ text: string; score: number }>, goal: string): string | null {
  if (!/\b(recall|using memory|from memory|what are|what should|remembered)\b/i.test(goal)) return null;
  const facts = new Map<string, string>();
  for (const h of hits) {
    // Only parse lines that are explicit user facts — skip run-summary entries
    // which contain metric k=v pairs (tokens=1247, drift=0.08, ms=520) that
    // polluted recall output in the QA run 2026-05-25.
    if (!h.text.includes("User fact")) continue;
    const pinned = h.text.match(/User fact\s*[·-]\s*([a-z][a-z0-9_]{1,60})\s*=\s*(.+)$/i);
    if (pinned) facts.set(pinned[1], pinned[2].trim());
  }
  if (facts.size === 0) return null;
  return [...facts.entries()].map(([key, value]) => `${key}: ${value}`).join("\n");
}

export async function* orchestrate(opts: RunOptions): AsyncGenerator<RunEvent> {
  const runId = nanoid(10);
  const startedAt = Date.now();
  const chaos = new Set<string>(opts.chaos ?? []);
  const maxSteps = opts.maxSteps ?? 8;
  // Stop starting new steps after this. 45s leaves ~15s of the route's 60s
  // maxDuration for final-answer synthesis + the memory write, so the run
  // ALWAYS emits an `answer` rather than getting hard-killed mid-step.
  const deadlineAt = startedAt + (opts.deadlineMs ?? 45_000);
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

  const exactFacts = extractExactFacts(goal);
  if (exactFacts.length > 0) {
    for (const fact of exactFacts) {
      const text = `User fact · ${fact.key} = ${fact.value}`;
      await safeAddMemory({
        tenantId,
        text,
        metadata: { runId, tags: ["pinned", "user-fact"], pinKey: fact.key, pinValue: fact.value },
      });
      yield { t: "memory_write", key: fact.key, preview: text, at: Date.now() };
    }
    yield { t: "answer", text: exactFacts.map((f) => `${f.key}: ${f.value}`).join("\n"), at: Date.now() };
    return;
  }

  yield { t: "phase", phase: "recall", note: "querying HydraDB save-state", at: Date.now() };
  const memHits = await safeRecall({ tenantId, query: goal, topK: 4 });
  yield { t: "memory_recall", query: goal, hits: memHits.length, at: Date.now() };
  const pinnedAnswer = formatPinnedFacts(memHits, goal);
  if (pinnedAnswer) {
    yield { t: "answer", text: pinnedAnswer, at: Date.now() };
    return;
  }

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
  // Pin queue · memory_pin tool emits into this list synchronously, then
  // we flush each pin into Hydra after the tool returns. Surfaced as
  // separate events so the user can SEE which facts pinned (vs the old
  // single "memory_write" line that hid Hydra failures).
  const pendingPins: Array<{ key: string; value: string }> = [];

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
        pushScratch(scratch, `subagent[${i}] answered "${plan.subgoals[i].slice(0, 60)}": ${s.value.slice(0, 200)}`);
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
  // Per-step retry budget · the critic can return verdict="retry" when a step
  // succeeded-but-insufficient (drift) or failed in a way the SAME approach
  // can recover. Previously "retry" fell through to stepIdx+=1, silently
  // advancing past the unsatisfied step (and the heuristic fallback critic
  // returns "retry" by default when all LLM providers are down). Re-run the
  // same step up to MAX_STEP_RETRIES times, then give up and advance.
  let stepRetries = 0;
  const MAX_STEP_RETRIES = 2;
  let finalAnswerText: string | null = null;
  let interruptFired = false;
  // Total completed steps counter — survives replans (unlike stepIdx which resets)
  let stepsCompleted = 0;
  const startTime = Date.now();

  while (stepIdx < Math.min(plan.steps.length, maxSteps)) {
    // Client-disconnect guard · if the SSE consumer went away, stop immediately.
    // No point spending planner/executor/critic LLM calls whose output can't be
    // delivered. Return (not break) so we skip final-answer synthesis too.
    if (opts.signal?.aborted) {
      yield {
        t: "recover",
        reason: "client disconnected",
        strategy: "aborting run — consumer gone, skipping further LLM work",
        at: Date.now(),
      };
      return;
    }

    // Wall-clock budget guard · stop starting new steps once we're past the
    // deadline and fall through to best-effort synthesis. Prevents the platform
    // from killing the function mid-step (which would strand the stream with no
    // answer event). Checked BEFORE any per-step LLM work so we never start a
    // call we can't afford to finish.
    if (Date.now() > deadlineAt) {
      yield {
        t: "recover",
        reason: `wall-clock budget exhausted after ${stepsCompleted} step(s)`,
        strategy: "stopping step loop; synthesizing best-effort answer from partial results",
        at: Date.now(),
      };
      break;
    }

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
        memoryHints: boundedHints(memHits),
        priorAttempt: { what: "prior plan", why: `user steered: ${steer}` },
        onUsage: onUsage("planner"),
      });
      for (const e of drain()) yield e;
      yield { t: "thought", agent: "planner", text: plan.rationale, at: Date.now() };
      stepIdx = 0;
      stepRetries = 0;
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
        memoryHints: boundedHints(memHits),
        priorAttempt: { what: `working on: ${oldGoal.slice(0, 80)}`, why: "user switched objective" },
        onUsage: onUsage("planner"),
      });
      for (const e of drain()) yield e;
      yield { t: "thought", agent: "planner", text: plan.rationale, at: Date.now() };
      stepIdx = 0;
      stepRetries = 0;
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
          pushScratch(scratch, (e.data as { text: string }).text);
        }
        if (e.kind === "final_answer" && typeof (e.data as { text?: string }).text === "string") {
          finalAnswerText = (e.data as { text: string }).text;
        }
        if (e.kind === "memory_pin") {
          const d = e.data as { key?: string; value?: string };
          if (typeof d.key === "string" && typeof d.value === "string") {
            pendingPins.push({ key: d.key, value: d.value });
          }
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
      result = { ok: false, error: msg };
      // Try EVERY same-tag fallback in order until one succeeds. Previously
      // only fbs[0] was attempted, so a tag with several fallbacks (e.g.
      // web_search → [serp, duckduckgo, wiki]) gave up after the first miss.
      for (const fb of fbs) {
        yield { t: "recover", reason: result.error ?? msg, strategy: `switching to fallback tool: ${fb.name}`, at: Date.now() };
        try {
          const fbCall = await pickToolCall({
            goal,
            stepIntent: step.intent + ` (use ${fb.name} instead of ${call.tool})`,
            tools: [fb],
            scratch,
            lastError: result.error ?? msg,
            onUsage: onUsage("executor"),
          });
          for (const e of drain()) yield e;
          yield { t: "tool_call", name: fb.name, args: fbCall.args, at: Date.now() };
          const r2 = await registry.execute(fb.name, fbCall.args, ctx);
          if (r2.ok) {
            result = { ok: true, data: r2.data };
            break;
          }
          result = { ok: false, error: r2.error };
        } catch (e2) {
          result = { ok: false, error: e2 instanceof Error ? e2.message : String(e2) };
        }
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

    // Flush any memory_pin emissions from this tool call. We persist
    // each as a SEPARATE Hydra row tagged "pinned" with the key as
    // metadata, then yield a discrete event so the user sees whether
    // the pin landed or Hydra rejected it (the old code silently lost
    // failed writes inside safeAddMemory).
    while (pendingPins.length > 0) {
      const p = pendingPins.shift()!;
      const pinText = `User fact · ${p.key} = ${p.value}`;
      let ok = false;
      let err: string | undefined;
      try {
        await safeAddMemory({
          tenantId,
          text: pinText,
          metadata: { runId, tags: ["pinned", "user-fact"], pinKey: p.key, pinValue: p.value },
        });
        ok = true;
      } catch (e) {
        err = e instanceof Error ? e.message : String(e);
      }
      yield {
        t: ok ? "memory_write" : "error",
        ...(ok ? { key: p.key, preview: pinText } : { message: `memory_pin failed for ${p.key}: ${err}` }),
        at: Date.now(),
      } as RunEvent;
    }

    if (result.ok) {
      consecutiveFailures = 0;
      pushScratch(scratch, `${call.tool}: ${summary}`);
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
          memoryHints: boundedHints(memHits),
          priorAttempt: { what: call.tool, why: result.error ?? "unknown failure" },
          onUsage: onUsage("planner"),
        });
        for (const e of drain()) yield e;
        stepIdx = 0;
        stepRetries = 0;
        consecutiveFailures = 0;
        continue;
      }
      // Both replans spent and the plan is STILL failing. Don't grind through
      // the remaining steps re-failing and burning LLM calls (and risking
      // maxDuration) — abort and synthesize a best-effort answer from whatever
      // partial results we have. Graceful degradation > silent timeout.
      if (replans >= 2 && consecutiveFailures >= 2) {
        yield {
          t: "recover",
          reason: `${consecutiveFailures} failures after ${replans} replans exhausted`,
          strategy: "aborting plan; synthesizing best-effort answer from partial results",
          at: Date.now(),
        };
        break;
      }
    }

    yield { t: "phase", phase: "critic", at: Date.now() };
    const verdict = await critique({
      originalGoal,
      currentPlanSummary: plan.rationale,
      lastStep: { intent: step.intent, toolResult: summary },
      memoryHits: memHits.length,
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
        memoryHints: boundedHints(memHits),
        priorAttempt: { what: "previous plan drifted", why: verdict.critique },
        onUsage: onUsage("planner"),
      });
      for (const e of drain()) yield e;
      stepIdx = 0;
      stepRetries = 0;
      continue;
    }

    // Critic says the step intent isn't satisfied yet but the SAME approach can
    // recover — re-run this step (do NOT advance) up to the retry budget, and
    // feed the critique into scratch so the executor adapts its next tool call.
    // Previously "retry" fell straight through to stepIdx+=1, silently skipping
    // the unsatisfied step.
    if (verdict.verdict === "retry" && stepRetries < MAX_STEP_RETRIES) {
      stepRetries += 1;
      const fixHint = verdict.fix ? ` Fix: ${verdict.fix}` : "";
      pushScratch(
        scratch,
        `critic[retry ${stepRetries}/${MAX_STEP_RETRIES}] step "${step.intent}" not satisfied — ${verdict.critique}.${fixHint}`.trim(),
      );
      yield {
        t: "recover",
        reason: `critic verdict=retry (drift=${verdict.driftScore.toFixed(2)}): ${verdict.critique}`,
        strategy: `re-attempting step ${stepIdx + 1} (${stepRetries}/${MAX_STEP_RETRIES})`,
        at: Date.now(),
      };
      continue;
    }

    stepIdx += 1;
    stepsCompleted += 1;
    stepRetries = 0;
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
