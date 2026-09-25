import type { CalendarDay, ZonedWallTime } from "../time/zoned";
import { getZonedParts, zonedToInstant } from "../time/zoned";

/** A runtime date value: a date-only calendar day or an instant (UTC ISO datetime). */
export type ParsedDateValue =
  | { kind: "date"; day: CalendarDay }
  | { kind: "datetime"; instant: Date };

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(n: number, width: number): string {
  return String(Math.abs(n)).padStart(width, "0");
}

/** True for a valid "YYYY-MM-DD" calendar day string. */
export function isDateOnly(s: string): boolean {
  return parseDateOnly(s) !== null;
}

function parseDateOnly(s: string): CalendarDay | null {
  const m = DATE_ONLY_RE.exec(s);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/** Parses a date-only or ISO datetime string; returns null when unparseable. */
export function parseDateValue(s: string): ParsedDateValue | null {
  const day = parseDateOnly(s);
  if (day) return { kind: "date", day };
  if (!s.includes("T")) return null;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return { kind: "datetime", instant: new Date(t) };
}

export function formatCalendarDay(day: CalendarDay): string {
  return `${day.year < 0 ? "-" : ""}${pad(day.year, 4)}-${pad(day.month, 2)}-${pad(day.day, 2)}`;
}

export function daysInMonth(year: number, month: number): number {
  const d = new Date(0);
  d.setUTCFullYear(year, month, 0);
  return d.getUTCDate();
}

/** Adds calendar months, clamping the day to the end of the target month. */
export function addCalendarMonths(day: CalendarDay, n: number): CalendarDay {
  const total = day.year * 12 + (day.month - 1) + n;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  return { year, month, day: Math.min(day.day, daysInMonth(year, month)) };
}

/** Days from `a` to `b` (b − a) on the calendar. */
export function calendarDayDiff(a: CalendarDay, b: CalendarDay): number {
  const ms = (d: CalendarDay): number => {
    const x = new Date(0);
    x.setUTCFullYear(d.year, d.month - 1, d.day);
    return x.getTime();
  };
  return Math.round((ms(b) - ms(a)) / 86_400_000);
}

/** Wall-clock parts (with ms) of a parsed value in `tz`; date-only values are midnight. */
export function toWallTime(v: ParsedDateValue, tz: string): Required<ZonedWallTime> {
  if (v.kind === "date") {
    return { ...v.day, hour: 0, minute: 0, second: 0, millisecond: 0 };
  }
  const p = getZonedParts(v.instant, tz);
  return {
    year: p.year,
    month: p.month,
    day: p.day,
    hour: p.hour,
    minute: p.minute,
    second: p.second,
    millisecond: v.instant.getUTCMilliseconds(),
  };
}

/** Instant of a parsed value; date-only values are the start of that day in `tz`. */
export function toInstant(v: ParsedDateValue, tz: string): Date {
  return v.kind === "datetime" ? v.instant : zonedToInstant(v.day, tz);
}

