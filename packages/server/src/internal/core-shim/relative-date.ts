/**
 * TEMPORARY minimal port of core's zoned-time helpers + resolveRelativeDate
 * (core plan Task 8). Intl-only; weeks start Monday; ranges are half-open
 * `[from, to)` UTC ISO strings; lastNDays/nextNDays include today.
 * TODO(core): replace with @masai/schema-grid-core exports.
 */
import type { DateRange, RelativeDate } from "./types";

export const DEFAULT_TIME_ZONE = "Asia/Kolkata";

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 1 = Monday … 7 = Sunday */
  weekday: number;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function getZonedParts(instant: Date, tz: string): ZonedParts {
  const out: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(instant)) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WEEKDAYS[out.weekday ?? "Mon"] ?? 1,
  };
}

function offsetMs(instant: Date, tz: string): number {
  const p = getZonedParts(instant, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Wall-clock parts in `tz` → instant. Iterative offset fix-up handles DST. */
export function zonedToInstant(
  parts: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number },
  tz: string,
): Date {
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0);
  let guess = wall - offsetMs(new Date(wall), tz);
  for (let i = 0; i < 3; i++) {
    const next = wall - offsetMs(new Date(guess), tz);
    if (next === guess) break;
    guess = Math.max(guess, next);
  }
  return new Date(guess);
}

export function addCalendarDays(
  ymd: { year: number; month: number; day: number },
  n: number,
): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function startOfZonedDay(instant: Date, tz: string): Date {
  const p = getZonedParts(instant, tz);
  return zonedToInstant({ year: p.year, month: p.month, day: p.day }, tz);
}

export function resolveRelativeDate(
  rd: RelativeDate,
  now: Date,
  tz: string = DEFAULT_TIME_ZONE,
): DateRange | { error: string } {
  const p = getZonedParts(now, tz);
  const today = { year: p.year, month: p.month, day: p.day };
  const at = (ymd: { year: number; month: number; day: number }) => zonedToInstant(ymd, tz).toISOString();
  const range = (a: typeof today, b: typeof today): DateRange => ({ from: at(a), to: at(b) });
  const needN = (): number | { error: string } =>
    typeof rd.n === "number" && Number.isInteger(rd.n) && rd.n > 0
      ? rd.n
      : { error: `${rd.relative} requires a positive integer n` };
  switch (rd.relative) {
    case "today":
      return range(today, addCalendarDays(today, 1));
    case "yesterday":
      return range(addCalendarDays(today, -1), today);
    case "tomorrow":
      return range(addCalendarDays(today, 1), addCalendarDays(today, 2));
    case "thisWeek": {
      const monday = addCalendarDays(today, -(p.weekday - 1));
      return range(monday, addCalendarDays(monday, 7));
    }
    case "lastWeek": {
      const monday = addCalendarDays(today, -(p.weekday - 1));
      return range(addCalendarDays(monday, -7), monday);
    }
    case "thisMonth": {
      const first = { year: p.year, month: p.month, day: 1 };
      const next = p.month === 12 ? { year: p.year + 1, month: 1, day: 1 } : { year: p.year, month: p.month + 1, day: 1 };
      return range(first, next);
    }
    case "lastMonth": {
      const first = { year: p.year, month: p.month, day: 1 };
      const prev = p.month === 1 ? { year: p.year - 1, month: 12, day: 1 } : { year: p.year, month: p.month - 1, day: 1 };
      return range(prev, first);
    }
    case "lastNDays": {
      const n = needN();
      if (typeof n !== "number") return n;
      return range(addCalendarDays(today, -(n - 1)), addCalendarDays(today, 1));
    }
    case "nextNDays": {
      const n = needN();
      if (typeof n !== "number") return n;
      return range(today, addCalendarDays(today, n));
    }
    default:
      return { error: `unknown relative date ${String((rd as { relative: unknown }).relative)}` };
  }
}
