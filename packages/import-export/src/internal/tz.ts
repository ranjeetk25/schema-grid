/**
 * Dependency-free conversion between UTC instants and "wall clock time in a
 * time zone" represented as a Date whose UTC fields hold the clock time (the
 * form Excel/exceljs uses for date cells).
 */

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatterCache.get(tz);
  if (!f) {
    // Throws RangeError for an invalid tz — intentionally surfaced.
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(tz, f);
  }
  return f;
}

function toDate(instant: Date | string): Date {
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) throw new RangeError(`Invalid date: ${String(instant)}`);
  return d;
}

/** Date whose UTC fields equal the clock time of `instant` in `tz`. */
export function toZonedWallClock(instant: Date | string, tz: string): Date {
  const d = toDate(instant);
  const parts = formatterFor(tz).formatToParts(d);
  const get = (type: string): number => {
    const p = parts.find((x) => x.type === type);
    return p ? Number(p.value) : 0;
  };
  // Some engines report midnight as hour 24 even with h23.
  const hour = get("hour") % 24;
  return new Date(
    Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      hour,
      get("minute"),
      get("second"),
      d.getUTCMilliseconds(),
    ),
  );
}

/** Offset (ms) of `tz` at `instantMs`: wall - utc. */
function offsetAt(instantMs: number, tz: string): number {
  return toZonedWallClock(new Date(instantMs), tz).getTime() - instantMs;
}

/**
 * Inverse of toZonedWallClock: reads `wall`'s UTC fields as clock time in `tz`
 * and returns the UTC instant as an ISO string. Two-pass offset correction so
 * it stays correct around DST transitions (a gap resolves to the later instant).
 */
export function fromZonedWallClock(wall: Date, tz: string): string {
  const w = wall.getTime();
  if (Number.isNaN(w)) throw new RangeError("Invalid date");
  const first = w - offsetAt(w, tz);
  const second = w - offsetAt(first, tz);
  if (second === first) return new Date(first).toISOString();
  // Offsets disagree (DST edge): prefer the candidate that round-trips.
  const candidates = [first, second].filter(
    (c) => toZonedWallClock(new Date(c), tz).getTime() === w,
  );
  const pick = candidates.length > 0 ? Math.min(...candidates) : Math.max(first, second);
  return new Date(pick).toISOString();
}

/** True when the Date has no time-of-day in its UTC fields. */
export function isMidnightUtc(d: Date): boolean {
  return (
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  );
}

/** `YYYY-MM-DD` from the UTC fields. */
export function toIsoDate(d: Date): string {
  const y = String(d.getUTCFullYear()).padStart(4, "0");
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
