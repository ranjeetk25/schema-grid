import { type CalendarDay, DEFAULT_TIME_ZONE, addCalendarDays, getZonedParts, zonedToInstant } from "../time/zoned";
import type { DateRange, RelativeDate } from "./types";

export type RelativeDateResult = DateRange | { error: string };

/**
 * Resolves a relative date to a half-open `[from, to)` range of UTC ISO strings,
 * using calendar days in `tz`. Weeks start on Monday. Never throws.
 */
export function resolveRelativeDate(
  rd: RelativeDate,
  now: Date,
  tz: string = DEFAULT_TIME_ZONE,
): RelativeDateResult {
  if (Number.isNaN(now.getTime())) return { error: "Invalid 'now' date" };
  let today: CalendarDay & { weekday: number };
  try {
    const p = getZonedParts(now, tz);
    today = { year: p.year, month: p.month, day: p.day, weekday: p.weekday };
  } catch {
    return { error: `Invalid time zone: ${tz}` };
  }

  const at = (day: CalendarDay): string => zonedToInstant(day, tz).toISOString();
  const span = (from: CalendarDay, to: CalendarDay): DateRange => ({ from: at(from), to: at(to) });
  const shift = (n: number): CalendarDay => addCalendarDays(today, n);
  const firstOfMonth = (monthOffset: number): CalendarDay => {
    const idx = today.year * 12 + (today.month - 1) + monthOffset;
    return { year: Math.floor(idx / 12), month: (((idx % 12) + 12) % 12) + 1, day: 1 };
  };
  const validN = (n: number | undefined): n is number =>
    typeof n === "number" && Number.isInteger(n) && n > 0;

  switch (rd.relative) {
    case "today":
      return span(shift(0), shift(1));
    case "yesterday":
      return span(shift(-1), shift(0));
    case "tomorrow":
      return span(shift(1), shift(2));
    case "thisWeek": {
      const monday = 1 - today.weekday;
      return span(shift(monday), shift(monday + 7));
    }
    case "lastWeek": {
      const monday = 1 - today.weekday;
      return span(shift(monday - 7), shift(monday));
    }
    case "thisMonth":
      return span(firstOfMonth(0), firstOfMonth(1));
    case "lastMonth":
      return span(firstOfMonth(-1), firstOfMonth(0));
    case "lastNDays":
      if (!validN(rd.n)) return { error: "lastNDays requires a positive integer n" };
      return span(shift(-(rd.n - 1)), shift(1));
    case "nextNDays":
      if (!validN(rd.n)) return { error: "nextNDays requires a positive integer n" };
      return span(shift(0), shift(rd.n));
    default:
      return { error: `Unknown relative date: ${String((rd as { relative: unknown }).relative)}` };
  }
}
