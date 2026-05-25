// Zero-dep tz-aware NL time parser. Fixes the +1h bug where "tomorrow at 4pm"
// in Europe/London landed at 17:00 BST. Uses only Intl.DateTimeFormat to compute
// the active offset of any IANA tz at any UTC instant, then converts a local
// wall-clock into a correct UTC ms.
//
// Returns null when nothing recognisable matched. Caller (calendar route) is
// responsible for past_time / low_confidence policy.

export type ParseWhenZeroDep = {
  at: Date;
  tz: string;
  raw: string;
  confidence: number;
  durationMs: number;
};

const HOURS = /\b([01]?\d|2[0-3])(?::([0-5]\d))?\s*(am|pm)?\b/i;

const DAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

// Offset of `tz` at a given UTC instant, in minutes (positive east of UTC).
function tzOffsetMinutes(tz: string, atUtc: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(atUtc).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  );
  const asUTC = Date.UTC(
    +parts.year,
    +parts.month - 1,
    +parts.day,
    +parts.hour,
    +parts.minute,
    +parts.second,
  );
  return (asUTC - atUtc.getTime()) / 60_000;
}

// Convert (Y,M,D,H,Min) wall-clock in `tz` into a UTC Date.
function zonedToUtc(y: number, m: number, d: number, h: number, min: number, tz: string): Date {
  // First guess assuming UTC equals local · then adjust by the offset.
  const guess = new Date(Date.UTC(y, m - 1, d, h, min, 0));
  const offMin = tzOffsetMinutes(tz, guess);
  return new Date(guess.getTime() - offMin * 60_000);
}

// Return [year, month, day] for `now` rendered in `tz`.
function localYMD(now: Date, tz: string): { y: number; m: number; d: number; dow: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(now).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  );
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    y: +parts.year,
    m: +parts.month,
    d: +parts.day,
    dow: weekdayMap[parts.weekday] ?? 0,
  };
}

export function parseWhenZeroDep(raw: string, opts: { tz: string; now?: Date }): ParseWhenZeroDep | null {
  const tz = opts.tz;
  const now = opts.now ?? new Date();
  const t = raw.toLowerCase().trim();
  if (!t) return null;

  // "now" / "right now"
  if (/^(?:right\s+)?now$/.test(t)) {
    return { at: new Date(now), tz, raw, confidence: 0.6, durationMs: 1_800_000 };
  }

  // "in N (min|hour|day|week)" · relative to NOW in UTC · no tz adjustment needed
  const relIn = t.match(/\bin\s+(\d+)\s*(min(?:ute)?s?|hours?|hrs?|days?|weeks?)\b/);
  if (relIn) {
    const n = parseInt(relIn[1], 10);
    let ms = n * 60_000;
    if (/hour|hr/.test(relIn[2])) ms = n * 3_600_000;
    if (/day/.test(relIn[2])) ms = n * 86_400_000;
    if (/week/.test(relIn[2])) ms = n * 7 * 86_400_000;
    return { at: new Date(now.getTime() + ms), tz, raw, confidence: 0.9, durationMs: 1_800_000 };
  }

  // Past markers · return very-low confidence
  if (/\b(yesterday|last\s+(?:week|month|year)|\d+\s*(?:hours?|days?|weeks?)\s+ago)\b/.test(t)) {
    const past = new Date(now.getTime() - 86_400_000);
    return { at: past, tz, raw, confidence: 0.05, durationMs: 1_800_000 };
  }

  // Compute today's wall-clock components in `tz`
  const today = localYMD(now, tz);
  let { y, m, d } = today;

  // Day shift words
  if (/\b(?:day\s+after\s+tomorrow)\b/i.test(t)) {
    const shifted = new Date(zonedToUtc(y, m, d, 12, 0, tz).getTime() + 2 * 86_400_000);
    const sh = localYMD(shifted, tz);
    y = sh.y; m = sh.m; d = sh.d;
  } else if (/\btomorrow\b/i.test(t)) {
    const shifted = new Date(zonedToUtc(y, m, d, 12, 0, tz).getTime() + 86_400_000);
    const sh = localYMD(shifted, tz);
    y = sh.y; m = sh.m; d = sh.d;
  } else if (/\btonight\b/i.test(t)) {
    // same day · ensure pm if hour < 12
    // y/m/d unchanged
  }

  // Weekday name shift · "Monday at 10am", "Tuesday 2pm"
  const wkMatch = t.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (wkMatch && !/today|tonight|tomorrow|day\s+after/.test(t)) {
    const target = DAYS[wkMatch[1]];
    let delta = target - today.dow;
    if (delta <= 0) delta += 7;
    const shifted = new Date(zonedToUtc(today.y, today.m, today.d, 12, 0, tz).getTime() + delta * 86_400_000);
    const sh = localYMD(shifted, tz);
    y = sh.y; m = sh.m; d = sh.d;
  }

  // Hour/min match
  const hh = t.match(HOURS);
  if (!hh) {
    // No time component · default to 9am local
    return {
      at: zonedToUtc(y, m, d, 9, 0, tz),
      tz, raw, confidence: 0.5, durationMs: 1_800_000,
    };
  }
  let h = parseInt(hh[1], 10);
  const min = hh[2] ? parseInt(hh[2], 10) : 0;
  const ap = hh[3]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (!ap && /tonight/i.test(t) && h < 12) h += 12;

  // If today-only (no shift) AND the resulting local time has already passed, roll to tomorrow.
  // Use rough comparison against current local hour.
  if (
    !wkMatch &&
    !/tomorrow|day\s+after|tonight/i.test(t)
  ) {
    const cand = zonedToUtc(y, m, d, h, min, tz);
    if (cand.getTime() < now.getTime() - 60_000) {
      const tomorrow = new Date(zonedToUtc(y, m, d, 12, 0, tz).getTime() + 86_400_000);
      const sh = localYMD(tomorrow, tz);
      y = sh.y; m = sh.m; d = sh.d;
    }
  }

  const at = zonedToUtc(y, m, d, h, min, tz);
  return { at, tz, raw, confidence: 0.9, durationMs: 1_800_000 };
}
