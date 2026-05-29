type Store = { queues: Map<string, string[]> };
const G = globalThis as unknown as { __delrioSteer?: Store };
G.__delrioSteer ??= { queues: new Map() };
const store = G.__delrioSteer!;

// Bounds so an abandoned or spammed run can't grow the in-process map without
// limit (no run ever drains its queue if the orchestrator died mid-run).
const MAX_PER_RUN = 50; // drop oldest instruction past this depth
const MAX_RUNS = 500; // evict oldest run once this many distinct runs exist

export function pushSteer(runId: string, instruction: string) {
  // Evict the oldest run when the map is full and this is a new run. Map keeps
  // insertion order, so the first key is the oldest.
  if (!store.queues.has(runId) && store.queues.size >= MAX_RUNS) {
    const oldest = store.queues.keys().next().value;
    if (oldest !== undefined) store.queues.delete(oldest);
  }
  const q = store.queues.get(runId) ?? [];
  q.push(instruction);
  if (q.length > MAX_PER_RUN) q.splice(0, q.length - MAX_PER_RUN);
  store.queues.set(runId, q);
}

export function popSteer(runId: string): string | null {
  const q = store.queues.get(runId);
  if (!q || q.length === 0) return null;
  const next = q.shift()!;
  if (q.length === 0) store.queues.delete(runId);
  return next;
}

export function hasSteer(runId: string): boolean {
  return (store.queues.get(runId)?.length ?? 0) > 0;
}
