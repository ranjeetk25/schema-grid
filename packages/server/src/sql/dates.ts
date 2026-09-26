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
/**
 * Full ISO instant; an explicit `Z` or `±HH[:]MM` offset is required. Same
 * pattern as core's `ISO_INSTANT` (up to 9 fractional digits — `Date.parse`
 * truncates to ms — and case-insensitive `T` / `Z`).
 */
export const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/i;

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

/** A parsed date filter value: a calendar day (`YYYY-MM-DD`) or an exact instant. */
export type DateFilterInput = { kind: "day"; ymd: string } | { kind: "instant"; ms: number };

/**
 * core `parseInstant` for filter values: trims, then accepts `YYYY-MM-DD` (a
 * real calendar day) or an ISO instant with Z/offset whose date part is a real
 * day. Anything else → undefined.
 */
export function parseDateFilterValue(value: unknown): DateFilterInput | undefined {
  if (typeof value !== "string") return undefined;
  const s = value.trim();
  if (YMD_RE.test(s)) return parseYmd(s) ? { kind: "day", ymd: s } : undefined;
  if (!ISO_INSTANT_RE.test(s) || !parseYmd(s.slice(0, 10))) return undefined;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? undefined : { kind: "instant", ms };
}

/** Epoch ms → `YYYY-MM-DD HH:MM:SS.fff` in UTC. */
export function msToMysqlUtc(ms: number): string {
  return toMysqlUtc(new Date(ms).toISOString());
}

/** Local midnight starting `ymd` in `tz`, as epoch ms. */
export function localDayStartMs(ymd: string, tz: string): number {
  return Date.parse(localDayStartUtc(ymd, tz));
}

/**
 * The earliest calendar day whose local start (in `tz`) is at or after the
 * instant `ms`. For a date column whose cell `D` means "start of D in tz",
 * `start(D) >= ms` ⟺ `D >= firstDayStartingAtOrAfter(ms)`.
 */
export function firstDayStartingAtOrAfter(ms: number, tz: string): string {
  const day = toLocalDate(new Date(ms).toISOString(), tz);
  return localDayStartMs(day, tz) >= ms ? day : addDaysYmd(day, 1);
}

// ---- naive (zone-less) DATETIME wall times ---------------------------------------

const NAIVE_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/;

export interface WallTime extends Ymd {
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

/** `YYYY-MM-DD HH:MM[:SS[.fff]]` (or with `T`) → wall-clock parts, or undefined when malformed. */
export function parseNaiveDatetime(s: string): WallTime | undefined {
  const m = NAIVE_DATETIME_RE.exec(s.trim());
  if (!m) return undefined;
  const ymd = parseYmd(`${m[1]}-${m[2]}-${m[3]}`);
  if (!ymd) return undefined;
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = m[6] ? Number(m[6]) : 0;
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  const millisecond = m[7] ? Number(m[7].padEnd(3, "0").slice(0, 3)) : 0;
  return { ...ymd, hour, minute, second, millisecond };
}

/**
 * Wall-clock time in `tz` → UTC ISO instant. Same DST policy as
 * `localDayStartUtc`: a skipped wall time resolves to the first existing
 * instant after the gap; a repeated one to its first occurrence.
 */
export function wallTimeToUtcIso(w: WallTime, tz: string): string {
  const wall = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second, w.millisecond);
  let guess = wall - offsetMs(wall, tz);
  for (let i = 0; i < 3; i++) {
    const next = wall - offsetMs(guess, tz);
    if (next === guess) break;
    guess = Math.max(guess, next);
  }
  return new Date(guess).toISOString();
}

/** UTC ISO instant → `YYYY-MM-DD HH:MM:SS.fff` wall time in `tz` (a naive `DATETIME(3)` literal). */
export function utcIsoToWallTime(iso: string, tz: string): string {
  const d = toDate(iso);
  const p = zonedParts(d, tz);
  return `${formatYmd(p)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}.${pad(d.getUTCMilliseconds(), 3)}`;
}

/** Whether `tz` keeps one UTC offset all year (no DST), and that offset as `±HH:MM` (MySQL `CONVERT_TZ` form). */
export function fixedUtcOffset(tz: string, year = new Date().getUTCFullYear()): string | undefined {
  const jan = offsetMs(Date.UTC(year, 0, 1), tz);
  const jul = offsetMs(Date.UTC(year, 6, 1), tz);
  if (jan !== jul) return undefined;
  const sign = jan < 0 ? "-" : "+";
  const abs = Math.abs(jan) / 60_000;
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
