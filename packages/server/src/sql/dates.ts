/**
 * Date helpers for SQL params. All timezone math happens here in JS via Intl;
 * SQL only ever sees UTC `DATETIME(3)` strings or `YYYY-MM-DD` dates, so there is
 * no dependency on MySQL's timezone tables.
 *
 * `localDayStartUtc` uses its own tiny wall-clock → instant conversion (Intl
 * offset fix-up, same approach as core's `zonedToInstant`) because core only
 * exposes `resolveRelativeDate`, and deriving a day's bounds from "today at some
 * instant inside that day" breaks for zones beyond ±12h.
 */

export const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Full ISO instant; an explicit `Z` or `±HH:MM` offset is required. */
export const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})$/;

export interface Ymd {
  year: number;
  month: number;
  day: number;
}

/** `YYYY-MM-DD` → parts, or undefined when malformed or not a real calendar day. */
export function parseYmd(ymd: string): Ymd | undefined {
  const m = YMD_RE.exec(ymd);
  if (!m) return undefined;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return undefined;
  return { year, month, day };
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

export function formatYmd(p: Ymd): string {
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** Calendar arithmetic on a `YYYY-MM-DD` string. */
export function addDaysYmd(ymd: string, n: number): string {
  const p = parseYmd(ymd);
  if (!p) throw new RangeError(`Invalid date "${ymd}"`);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + n));
  return formatYmd({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
}

function toDate(iso: string): Date {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new RangeError(`Invalid instant "${iso}"`);
  return d;
}

/** ISO instant → `YYYY-MM-DD HH:MM:SS.fff` in UTC (the `DATETIME(3)` param format). */
export function toMysqlUtc(iso: string): string {
  return toDate(iso).toISOString().replace("T", " ").replace("Z", "");
}

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
    });
    fmtCache.set(tz, f);
  }
  return f;
}

function zonedParts(instant: Date, tz: string): Ymd & { hour: number; minute: number; second: number } {
  const out: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(instant)) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
  };
}

/** `YYYY-MM-DD` of the instant as seen in `tz`. */
export function toLocalDate(iso: string, tz: string): string {
  return formatYmd(zonedParts(toDate(iso), tz));
}

/** tz offset (ms) at `instant`, whole seconds. */
function offsetMs(instant: number, tz: string): number {
  const p = zonedParts(new Date(instant), tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant / 1000) * 1000;
}

/**
 * UTC ISO instant of local midnight starting `ymd` in `tz`. Iterative offset
 * fix-up handles DST; if midnight is skipped by a transition the first existing
 * local instant after it is returned.
 */
export function localDayStartUtc(ymd: string, tz: string): string {
  const p = parseYmd(ymd);
  if (!p) throw new RangeError(`Invalid date "${ymd}"`);
  const wall = Date.UTC(p.year, p.month - 1, p.day);
  let guess = wall - offsetMs(wall, tz);
  for (let i = 0; i < 3; i++) {
    const next = wall - offsetMs(guess, tz);
    if (next === guess) break;
    guess = Math.max(guess, next);
  }
  return new Date(guess).toISOString();
}
