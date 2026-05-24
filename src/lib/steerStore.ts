type Store = { queues: Map<string, string[]> };
const G = globalThis as unknown as { __delrioSteer?: Store };
G.__delrioSteer ??= { queues: new Map() };
const store = G.__delrioSteer!;

export function pushSteer(runId: string, instruction: string) {
  const q = store.queues.get(runId) ?? [];
  q.push(instruction);
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
