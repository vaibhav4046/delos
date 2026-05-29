// Lightweight in-memory + localStorage-mirrored calendar. Wired to the
// existing CalendarApp UI + voice "schedule meeting Tuesday 4pm with Andy"
// intent. Future: bridge to Google Calendar via OAuth.

export type CalendarEvent = {
  id: string;
  title: string;
  startAt: number;
  endAt: number;
  notes?: string;
  attendees?: string[];
  source: "manual" | "voice" | "schedule";
  createdAt: number;
};

const G = globalThis as unknown as { __delos_calendar?: Map<string, CalendarEvent[]> };
G.__delos_calendar ??= new Map();
const store = G.__delos_calendar;

function key(tenantId: string): string {
  return tenantId || "anon";
}

export function listEvents(tenantId: string, fromMs?: number, toMs?: number): CalendarEvent[] {
  const all = store.get(key(tenantId)) ?? [];
  const min = fromMs ?? 0;
  const max = toMs ?? Number.MAX_SAFE_INTEGER;
  return all
    .filter((e) => e.startAt >= min && e.startAt <= max)
    .sort((a, b) => a.startAt - b.startAt);
}

const MAX_EVENTS_PER_TENANT = 500;
const MAX_TENANTS = 1000;

export function createEvent(tenantId: string, input: Omit<CalendarEvent, "id" | "createdAt" | "source"> & { source?: CalendarEvent["source"] }): CalendarEvent {
  const k = key(tenantId);
  // Bound tenant count · evict the oldest tenant bucket when a brand-new tenant
  // would exceed the cap. Stops unbounded Map growth from many distinct anon
  // tenants over a long-lived process.
  if (!store.has(k) && store.size >= MAX_TENANTS) {
    const oldestTenant = store.keys().next().value;
    if (oldestTenant !== undefined) store.delete(oldestTenant);
  }
  const list = store.get(k) ?? [];
  const event: CalendarEvent = {
    ...input,
    source: input.source ?? "manual",
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  };
  list.push(event);
  // Bound per-tenant events · keep the most recent MAX_EVENTS_PER_TENANT.
  if (list.length > MAX_EVENTS_PER_TENANT) list.splice(0, list.length - MAX_EVENTS_PER_TENANT);
  store.set(k, list);
  return event;
}

export function removeEvent(tenantId: string, id: string): boolean {
  const list = store.get(key(tenantId)) ?? [];
  const next = list.filter((e) => e.id !== id);
  if (next.length === list.length) return false;
  store.set(key(tenantId), next);
  return true;
}

// Parse natural-language time fragments into absolute startAt.
// Handles: "tomorrow at 4pm", "in 30 minutes", "Tuesday 2pm", "now", "tonight 8pm".
// Returns null when no time can be parsed (caller falls back to "now").
export function parseWhen(text: string, ref: Date = new Date()): { startAt: number; endAt: number } | null {
  const t = text.toLowerCase();
  const base = new Date(ref);

  // in N (minutes|hours|days)
  const inN = t.match(/\bin\s+(\d+)\s*(min(?:ute)?s?|hours?|hrs?|days?)\b/);
  if (inN) {
    const n = parseInt(inN[1], 10);
    const unit = inN[2];
    let ms = n * 60_000;
    if (/hour|hr/.test(unit)) ms = n * 3_600_000;
    if (/day/.test(unit)) ms = n * 86_400_000;
    const startAt = base.getTime() + ms;
    return { startAt, endAt: startAt + 1_800_000 };
  }

  // "tomorrow at HH(am|pm)" or "today at HH(am|pm)" or "tonight HH(pm)"
  const dayMatch = t.match(/\b(today|tonight|tomorrow|day\s+after\s+tomorrow)\s*(?:at)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (dayMatch) {
    const dayWord = dayMatch[1];
    let h = parseInt(dayMatch[2], 10);
    const m = dayMatch[3] ? parseInt(dayMatch[3], 10) : 0;
    const ampm = dayMatch[4];
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    if (!ampm && dayWord === "tonight" && h < 12) h += 12;
    const d = new Date(base);
    if (dayWord === "tomorrow") d.setDate(d.getDate() + 1);
    if (dayWord.startsWith("day after")) d.setDate(d.getDate() + 2);
    d.setHours(h, m, 0, 0);
    return { startAt: d.getTime(), endAt: d.getTime() + 1_800_000 };
  }

  // Weekday names — Monday, Tuesday, etc.
  const wkMatch = t.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*(?:at)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (wkMatch) {
    const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const targetIdx = names.indexOf(wkMatch[1]);
    let h = parseInt(wkMatch[2], 10);
    const m = wkMatch[3] ? parseInt(wkMatch[3], 10) : 0;
    const ampm = wkMatch[4];
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    const d = new Date(base);
    const todayIdx = d.getDay();
    let delta = targetIdx - todayIdx;
    if (delta <= 0) delta += 7;
    d.setDate(d.getDate() + delta);
    d.setHours(h, m, 0, 0);
    return { startAt: d.getTime(), endAt: d.getTime() + 1_800_000 };
  }

  // "at 4pm" or "4pm" alone — interpret as today
  const todayMatch = t.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (todayMatch) {
    let h = parseInt(todayMatch[1], 10);
    const m = todayMatch[2] ? parseInt(todayMatch[2], 10) : 0;
    const ampm = todayMatch[3];
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    const d = new Date(base);
    d.setHours(h, m, 0, 0);
    // If already passed today, roll to tomorrow.
    if (d.getTime() < base.getTime()) d.setDate(d.getDate() + 1);
    return { startAt: d.getTime(), endAt: d.getTime() + 1_800_000 };
  }

  return null;
}
