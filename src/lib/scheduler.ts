// Scheduled actions engine · in-memory store keyed by globalThis so HMR and
// warm-Lambda reuse don't lose state. Firing is DRIVEN EXTERNALLY: the in-OS
// ScheduleTicker (client) POSTs /api/schedule/tick every 45s, which walks due
// actions and dispatches them. We deliberately do NOT run a server-side
// setInterval — serverless functions freeze between requests, so an in-process
// timer would never fire reliably. recordFire() re-arms recurring actions.
//
// Action kinds:
//   - draft_email · stages a Gmail draft via /api/connectors/gmail/draft
//   - read_email · summarizes recent inbox via /api/connectors/gmail/list
//   - notion_page · creates a Notion page from a template
//   - notify · pushes a system notification with custom text
//   - run_mission · kicks off /api/run with a goal
//   - cohort · runs /api/cohort with a question
//
// Scheduling: either `runAt` (one-shot ISO) or `everyMs` (recurring interval).
// Persistence: in-memory globalThis cache so HMR doesn't lose state.

export type ScheduledActionKind =
  | "draft_email"
  | "read_email"
  | "notion_page"
  | "notify"
  | "run_mission"
  | "cohort";

export type ScheduledAction = {
  id: string;
  tenantId: string;
  kind: ScheduledActionKind;
  label: string;
  payload: Record<string, unknown>;
  createdAt: number;
  runAt?: number;     // one-shot fire time (unix ms)
  everyMs?: number;   // recurring interval
  lastRunAt?: number;
  nextRunAt: number;
  enabled: boolean;
  history: Array<{ at: number; ok: boolean; note?: string }>;
};

const G = globalThis as unknown as {
  __delos_scheduled?: Map<string, ScheduledAction>;
};
G.__delos_scheduled ??= new Map();
const store = G.__delos_scheduled;

// Drop disabled one-shot actions that already fired more than RETAIN_FIRED_MS
// ago. recordFire() disables one-shots after they run but left them in the Map
// forever; over a long-lived process they accumulate. Recurring actions and
// still-armed one-shots are always kept.
const RETAIN_FIRED_MS = 60 * 60_000; // keep fired one-shots 1h for the history UI
function pruneFired() {
  const now = Date.now();
  for (const [id, a] of store) {
    if (!a.enabled && !a.everyMs && a.lastRunAt && now - a.lastRunAt > RETAIN_FIRED_MS) {
      store.delete(id);
    }
  }
}

export function listActions(tenantId: string): ScheduledAction[] {
  return [...store.values()]
    .filter((a) => a.tenantId === tenantId)
    .sort((a, b) => a.nextRunAt - b.nextRunAt);
}

export function getAction(id: string): ScheduledAction | undefined {
  return store.get(id);
}

export function addAction(input: Omit<ScheduledAction, "id" | "createdAt" | "nextRunAt" | "enabled" | "history">): ScheduledAction {
  pruneFired();
  const id = `sa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  const nextRunAt = input.runAt ?? (input.everyMs ? now + input.everyMs : now);
  const action: ScheduledAction = {
    ...input,
    id,
    createdAt: now,
    nextRunAt,
    enabled: true,
    history: [],
  };
  store.set(id, action);
  return action;
}

export function removeAction(id: string): boolean {
  return store.delete(id);
}

export function toggleAction(id: string, enabled: boolean): ScheduledAction | undefined {
  const a = store.get(id);
  if (!a) return undefined;
  a.enabled = enabled;
  store.set(id, a);
  return a;
}

// Mark an action as fired. Re-arm if recurring. Cap history to last 12.
export function recordFire(id: string, ok: boolean, note?: string): void {
  const a = store.get(id);
  if (!a) return;
  const now = Date.now();
  a.lastRunAt = now;
  a.history = [{ at: now, ok, note }, ...a.history].slice(0, 12);
  if (a.everyMs) {
    a.nextRunAt = now + a.everyMs;
  } else {
    // One-shot · disable after fire
    a.enabled = false;
  }
  store.set(id, a);
}

// Single tick · finds all due actions and fires them. Idempotent; caller
// runs this on an interval. Returns the list of fired ids.
export async function runDueActions(
  baseUrl: string,
  dispatcher: (action: ScheduledAction) => Promise<{ ok: boolean; note?: string }>,
): Promise<string[]> {
  const now = Date.now();
  const fired: string[] = [];
  for (const action of store.values()) {
    if (!action.enabled) continue;
    if (action.nextRunAt > now) continue;
    try {
      const result = await dispatcher(action);
      recordFire(action.id, result.ok, result.note);
      fired.push(action.id);
    } catch (e) {
      recordFire(action.id, false, e instanceof Error ? e.message : String(e));
    }
  }
  return fired;
}

// Server-side dispatcher · maps a kind to an API call. The caller passes
// `fetch` (or a stub for testing) and the base URL so this works in both
// Node and browser contexts.
export async function defaultDispatcher(
  action: ScheduledAction,
  baseUrl: string,
): Promise<{ ok: boolean; note?: string }> {
  const url = (p: string) => `${baseUrl.replace(/\/$/, "")}${p}`;
  switch (action.kind) {
    case "draft_email": {
      const { to, subject, body } = action.payload as { to?: string; subject?: string; body?: string };
      const r = await fetch(url("/api/connectors/gmail/draft"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject, body, tenantId: action.tenantId }),
      });
      return { ok: r.ok, note: r.ok ? `draft saved to gmail` : `gmail draft ${r.status}` };
    }
    case "read_email": {
      const r = await fetch(url(`/api/connectors/gmail/list?tenantId=${encodeURIComponent(action.tenantId)}&max=5`));
      const j = (await r.json().catch(() => ({}))) as { items?: Array<{ subject?: string }>; error?: string };
      const count = j.items?.length ?? 0;
      return { ok: r.ok, note: r.ok ? `${count} threads scanned` : j.error ?? `gmail ${r.status}` };
    }
    case "notion_page": {
      const r = await fetch(url("/api/connectors/notion/create-page"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...action.payload, tenantId: action.tenantId }),
      });
      return { ok: r.ok, note: r.ok ? "notion page created" : `notion ${r.status}` };
    }
    case "run_mission": {
      const { goal } = action.payload as { goal?: string };
      const r = await fetch(url("/api/run"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: goal, tenantId: action.tenantId }),
      });
      return { ok: r.ok, note: r.ok ? "mission started" : `run ${r.status}` };
    }
    case "cohort": {
      const { question } = action.payload as { question?: string };
      const r = await fetch(url("/api/cohort"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: question, tenantId: action.tenantId }),
      });
      return { ok: r.ok, note: r.ok ? "cohort dispatched" : `cohort ${r.status}` };
    }
    case "notify": {
      const r = await fetch(url("/api/notify"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...action.payload, tenantId: action.tenantId }),
      });
      return { ok: r.ok, note: r.ok ? "notification queued" : `notify ${r.status}` };
    }
    default:
      return { ok: true, note: "queued" };
  }
}
