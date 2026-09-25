/**
 * Time-zone helpers built only on `Intl.DateTimeFormat` (no tz database dependency).
 *
 * DST policy for `zonedToInstant`:
 * - Gap (wall time does not exist, e.g. 02:30 on spring-forward day): the later valid
 *   instant is chosen, i.e. the wall time is interpreted with the pre-transition offset,
 *   which lands after the gap (02:30 EST-nominal -> 03:30 EDT).
 * - Overlap (wall time occurs twice, e.g. 01:30 on fall-back day): the earlier (first)
 *   occurrence is chosen.
 */

export const DEFAULT_TIME_ZONE = "Asia/Kolkata";

export interface CalendarDay {
  year: number;
  /** 1-12 */
  month: number;
  /** 1-31 */
  day: number;
}

export interface ZonedParts extends CalendarDay {
  /** 0-23 */
  hour: number;
  minute: number;
  second: number;
  /** 1 = Monday ... 7 = Sunday */
  weekday: number;
}

export interface ZonedWallTime extends CalendarDay {
  hour?: number;
  minute?: number;
  second?: number;
  millisecond?: number;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(tz: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(tz);
  if (!fmt) {
    // Throws RangeError for an unknown time zone.
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      weekday: "short",
      era: "short",
    });
    formatterCache.set(tz, fmt);
  }
  return fmt;
}

/** Wall-clock parts of `instant` in `tz`. Throws RangeError for an unknown tz. */
export function getZonedParts(instant: Date, tz: string): ZonedParts {
  const out: ZonedParts = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0, weekday: 0 };
  let bc = false;
  for (const part of getFormatter(tz).formatToParts(instant)) {
    switch (part.type) {
      case "year":
        out.year = Number(part.value);
        break;
      case "month":
        out.month = Number(part.value);
        break;
      case "day":
        out.day = Number(part.value);
        break;
      case "hour":
        // Some engines report midnight as "24" even with h23.
        out.hour = Number(part.value) % 24;
        break;
      case "minute":
        out.minute = Number(part.value);
        break;
      case "second":
        out.second = Number(part.value);
        break;
      case "weekday":
        out.weekday = WEEKDAYS[part.value] ?? 0;
        break;
      case "era":
        bc = part.value === "BC" || part.value === "B";
        break;
      default:
        break;
    }
  }
  if (bc) out.year = 1 - out.year;
  return out;
}

/** Wall time interpreted as if it were UTC, in epoch ms (safe for years 0-99). */
function wallAsUtcMs(p: ZonedWallTime): number {
  const d = new Date(0);
  d.setUTCFullYear(p.year, p.month - 1, p.day);
  d.setUTCHours(p.hour ?? 0, p.minute ?? 0, p.second ?? 0, p.millisecond ?? 0);
  return d.getTime();
}

/** Offset of `tz` from UTC at epoch ms `t`, in ms (positive east of UTC). */
function offsetAt(t: number, tz: string): number {
  const whole = Math.floor(t / 1000) * 1000;
  return wallAsUtcMs(getZonedParts(new Date(whole), tz)) - whole;
}

/**
 * Converts a wall-clock time in `tz` to an instant. See module doc for the DST policy.
 * Throws RangeError for an unknown tz.
 */
export function zonedToInstant(parts: ZonedWallTime, tz: string): Date {
  const wall = wallAsUtcMs(parts);
  const DAY = 86_400_000;
  // Candidate offsets: those in effect around this wall time (covers any single transition).
  const offsets = new Set([offsetAt(wall - DAY, tz), offsetAt(wall, tz), offsetAt(wall + DAY, tz)]);
  const valid: number[] = [];
  const all: number[] = [];
  for (const o of offsets) {
    const t = wall - o;
    all.push(t);
    if (offsetAt(t, tz) === o) valid.push(t);
  }
  // Overlap -> earliest valid; gap (no valid candidate) -> latest candidate.
  const chosen = valid.length > 0 ? Math.min(...valid) : Math.max(...all);
  return new Date(chosen);
}

/** Instant of 00:00 (or the first valid instant of the day) of `instant`'s calendar day in `tz`. */
export function startOfZonedDay(instant: Date, tz: string): Date {
  const p = getZonedParts(instant, tz);
  return zonedToInstant({ year: p.year, month: p.month, day: p.day }, tz);
}

/** Pure calendar arithmetic: adds `n` days (may be negative) to a calendar day. */
export function addCalendarDays(day: CalendarDay, n: number): CalendarDay {
  const d = new Date(0);
  d.setUTCFullYear(day.year, day.month - 1, day.day + n);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}
