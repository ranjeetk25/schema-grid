/**
 * Pure calendar-day arithmetic with no timezone involvement — everything is
 * computed via `Date.UTC`/`getUTC*`, used purely as a proleptic Gregorian
 * calendar calculator (never as an instant).
 */

export interface Ymd {
  year: number;
  /** 1-12 */
  month: number;
  /** 1-31 */
  day: number;
}

const MS_PER_DAY = 86_400_000;

export const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Number of days in `month` (1-12) of `year`. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** True when (year, month, day) is a real calendar day. */
export function isValidYmd(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  return true;
}

/** Maps a calendar day onto a contiguous day-number line (epoch day, UTC-based). */
export function ymdToDayNumber(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

/** Inverse of `ymdToDayNumber`. */
export function dayNumberToYmd(dayNumber: number): Ymd {
  const d = new Date(dayNumber * MS_PER_DAY);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Adds `months` (may be negative) to (year, month, day), clamping the day to the target month's end. */
export function addMonthsClamped(year: number, month: number, day: number, months: number): Ymd {
  const total = year * 12 + (month - 1) + months;
  const outYear = Math.floor(total / 12);
  const outMonth = total - outYear * 12 + 1;
  return { year: outYear, month: outMonth, day: Math.min(day, daysInMonth(outYear, outMonth)) };
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/** Formats (year, month, day) in the given display style. */
export function formatYmd(year: number, month: number, day: number, style: "iso" | "dmy" | "mdy" | "long"): string {
  const y = String(year).padStart(4, "0");
  switch (style) {
    case "dmy":
      return `${pad(day, 2)}/${pad(month, 2)}/${y}`;
    case "mdy":
      return `${pad(month, 2)}/${pad(day, 2)}/${y}`;
    case "long":
      return `${day} ${MONTH_NAMES[month - 1]} ${year}`;
    default:
      return `${y}-${pad(month, 2)}-${pad(day, 2)}`;
  }
}
