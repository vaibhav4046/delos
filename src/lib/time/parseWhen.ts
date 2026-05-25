// SINGLE SOURCE for natural-language time parsing.
// All callers (calendar, voice reminders, scheduler templates) import from here.
// No duplicated parsers anywhere else.
//
// Returns { at, confidence, tz, raw } or null. Callers decide what to do
// with low confidence — calendar route rejects < 0.4, reminders accept anything.

export type ParseWhen = {
  at: Date;
  confidence: number;  // 0..1 · higher = more concrete time tokens matched
  tz: string;
  raw: string;
  // Echoed back when caller wants both start + a sensible end (default +30m).
  durationMs: number;
};

const DAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

const SMALL_NUM: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12,
};

function parseHour(h: string, ampm?: string): number {
  let n = parseInt(h, 10);
  if (isNaN(n)) n = SMALL_NUM[h.toLowerCase()] ?? NaN;
  if (isNaN(n)) return -1;
  if (ampm === "pm" && n < 12) n += 12;
  if (ampm === "am" && n === 12) n = 0;
  return n;
}

export function parseWhen(raw: string, opts?: { tz?: string; now?: Date }): ParseWhen | null {
  const tz = opts?.tz ?? (typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC");
  const now = opts?.now ?? new Date();
  const t = raw.toLowerCase().trim();
  if (!t) return null;

  // "now" or "right now"
  if (/^(?:right\s+)?now$/.test(t)) {
    return { at: new Date(now), confidence: 0.6, tz, raw, durationMs: 1_800_000 };
  }

  // F10 · explicit past markers ALWAYS yield past timestamps so caller
  // (validateCalendarParse) can reject. Was previously letting "yesterday
  // at 4pm" fall through to todayMatch and roll forward to tomorrow.
  if (/\b(yesterday|last\s+(?:week|month|year)|\d+\s*(?:hours?|days?|weeks?)\s+ago)\b/.test(t)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return { at: d, confidence: 0.05, tz, raw, durationMs: 1_800_000 };
  }

  // in N minutes/hours/days/weeks
  const inN = t.match(/\bin\s+(\d+)\s*(min(?:ute)?s?|hours?|hrs?|days?|weeks?)\b/);
  if (inN) {
    const n = parseInt(inN[1], 10);
    const unit = inN[2];
    let ms = n * 60_000;
    if (/hour|hr/.test(unit)) ms = n * 3_600_000;
    if (/day/.test(unit)) ms = n * 86_400_000;
    if (/week/.test(unit)) ms = n * 7 * 86_400_000;
    return { at: new Date(now.getTime() + ms), confidence: 0.9, tz, raw, durationMs: 1_800_000 };
  }

  // today/tonight/tomorrow [at] HH(:MM)?(am|pm)?
  const dayMatch = t.match(/\b(today|tonight|tomorrow|day\s+after\s+tomorrow)\b(?:.*?(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/);
  if (dayMatch) {
    const dayWord = dayMatch[1];
    const d = new Date(now);
    if (dayWord === "tomorrow") d.setDate(d.getDate() + 1);
    else if (dayWord.startsWith("day after")) d.setDate(d.getDate() + 2);
    if (dayMatch[2]) {
      const h = parseHour(dayMatch[2], dayMatch[4] ?? (dayWord === "tonight" ? "pm" : undefined));
      const m = dayMatch[3] ? parseInt(dayMatch[3], 10) : 0;
      d.setHours(h, m, 0, 0);
      return { at: d, confidence: 0.95, tz, raw, durationMs: 1_800_000 };
    }
    // Default time = 9am if unspecified
    d.setHours(9, 0, 0, 0);
    return { at: d, confidence: 0.6, tz, raw, durationMs: 1_800_000 };
  }

  // Weekday name [at] HH(:MM)?(am|pm)? · "Monday at 10am", "Tuesday 2pm"
  const wkMatch = t.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b(?:.*?(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/);
  if (wkMatch) {
    const targetIdx = DAYS[wkMatch[1]];
    const d = new Date(now);
    let delta = targetIdx - d.getDay();
    if (delta <= 0) delta += 7;
    d.setDate(d.getDate() + delta);
    if (wkMatch[2]) {
      const h = parseHour(wkMatch[2], wkMatch[4]);
      const m = wkMatch[3] ? parseInt(wkMatch[3], 10) : 0;
      d.setHours(h, m, 0, 0);
      return { at: d, confidence: 0.95, tz, raw, durationMs: 1_800_000 };
    }
    d.setHours(9, 0, 0, 0);
    return { at: d, confidence: 0.6, tz, raw, durationMs: 1_800_000 };
  }

  // HH:MM 24h · "at 23:59", "23:59"
  const time24 = t.match(/\b(?:at\s+)?(\d{1,2}):(\d{2})\b(?!\s*(?:am|pm))/);
  if (time24) {
    const h = parseInt(time24[1], 10);
    const m = parseInt(time24[2], 10);
    if (h <= 23 && m <= 59) {
      const d = new Date(now);
      d.setHours(h, m, 0, 0);
      if (d.getTime() < now.getTime()) d.setDate(d.getDate() + 1);
      return { at: d, confidence: 0.9, tz, raw, durationMs: 1_800_000 };
    }
  }

  // HH(am|pm) · "at 4pm", "4pm", "10am"
  const todayMatch = t.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (todayMatch) {
    const h = parseHour(todayMatch[1], todayMatch[3]);
    const m = todayMatch[2] ? parseInt(todayMatch[2], 10) : 0;
    if (h >= 0 && h <= 23) {
      const d = new Date(now);
      d.setHours(h, m, 0, 0);
      if (d.getTime() < now.getTime()) d.setDate(d.getDate() + 1);
      return { at: d, confidence: 0.85, tz, raw, durationMs: 1_800_000 };
    }
  }

  // Past markers — return very-low confidence so caller rejects.
  // We still return a date (yesterday) so the caller can show the
  // "past_time" error specifically rather than a generic parse failure.
  if (/\b(yesterday|last\s+(?:week|month|year)|ago)\b/.test(t)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return { at: d, confidence: 0.1, tz, raw, durationMs: 1_800_000 };
  }

  return null;
}

// F11 · pre-validate raw text for obvious nonsense. Used before parsing
// to reject "three eels from sunday" rather than letting the weekday
// regex pick up the bare "sunday" and pretend it parsed.
export function isCoherentTimeText(raw: string): boolean {
  const t = raw.toLowerCase().trim();
  if (!t || t.length < 3) return false;
  // Has at least one strong time signal:
  //   - relative time number ("in 5 minutes", "in 2 hours", "in 3 days")
  //   - day-relative word + nothing else weird
  //   - explicit clock time HH(:MM)?(am|pm) or HH:MM 24h
  //   - "now" / "tonight"
  const hasRelativeNumber = /\bin\s+\d+\s*(?:min|hour|hr|day|week)/i.test(t);
  const hasClockTime = /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.test(t) || /\b\d{1,2}:\d{2}\b/.test(t);
  const hasDayRelative = /\b(?:tomorrow|tonight|today|day\s+after\s+tomorrow|now)\b/i.test(t);
  const hasWeekday = /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(t);
  // Weekday alone is too weak unless combined with a clock time
  if (hasRelativeNumber || hasClockTime || hasDayRelative) return true;
  if (hasWeekday && hasClockTime) return true;
  return false;
}

// Helper · reject past + low confidence at the calendar/server boundary.
// Reminders may accept lower confidence; calendar requires >= 0.4 + future.
export function validateCalendarParse(p: ParseWhen | null, now: Date = new Date()): { ok: true; at: Date } | { ok: false; reason: string } {
  if (!p) return { ok: false, reason: "unparseable_time" };
  if (p.at.getTime() < now.getTime() - 60_000) return { ok: false, reason: "past_time" };
  if (p.confidence < 0.4) return { ok: false, reason: "low_confidence" };
  return { ok: true, at: p.at };
}
