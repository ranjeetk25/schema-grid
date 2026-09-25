import { type SQL, sql } from "drizzle-orm";
import { type RelativeDate, resolveRelativeDate } from "../internal/core";
import {
  type DateFilterInput,
  addDaysYmd,
  firstDayStartingAtOrAfter,
  localDayStartMs,
  msToMysqlUtc,
  parseDateFilterValue,
  toLocalDate,
} from "../sql/dates";
import type { SqlScope } from "../sql/scope";
import type { OperatorTranslator } from "./types";
import { UnusableFilterValue, isOpenBound, rangeValue } from "./values";

/**
 * Date / datetime operators, mirroring core `matchDate`. All are positive
 * (empty never matches — the `AND NOT empty` wrapper comes from translateFilter).
 *
 * core model: every cell and value is an instant. A date-only string
 * (`YYYY-MM-DD`) is the START of that day in `ctx.tz`; ISO values need a Z or
 * offset. So on a DATE column a cell `D` behaves as `start(D)`, and a
 * comparison with an instant `v` is rewritten into a day comparison:
 * `start(D) >= v` ⟺ `D >= firstDayStartingAtOrAfter(v)`.
 *
 * - `is`: same local day (`sameZonedDay`) — also for full ISO values.
 * - `isBefore`: strictly before the value instant.
 * - `isAfter`: a date-only value → on/after the start of the NEXT day; an
 *   instant → strictly after it.
 * - `isBetween`: `from <= t`, and `t <= to` for an instant `to` / `t < start(to + 1 day)`
 *   for a date-only `to` (whole day included). A null/blank bound is open; both
 *   open → any non-empty cell.
 * - `isWithin`: `[from, to)` of the resolved relative range.
 * - An unparseable value / bound / relative date is unusable → FALSE.
 *
 * Range translators return a bare `a AND b` (no parens) so the combined
 * condition reads `(x >= ? AND x < ? AND NOT <empty>)`; safe because these
 * operators are positive and only ever ANDed.
 *
 * Storage: date = `YYYY-MM-DD`; datetime = UTC ISO (`typed` is `DATETIME(3)`),
 * so datetime params are UTC `YYYY-MM-DD HH:MM:SS.fff` strings.
 */

function dateInput(value: unknown): DateFilterInput {
  const parsed = parseDateFilterValue(value);
  if (!parsed) throw new UnusableFilterValue("expected YYYY-MM-DD or an ISO instant with offset");
  return parsed;
}

function rangeInput(value: unknown): { from?: DateFilterInput; to?: DateFilterInput } {
  const range = rangeValue(value);
  const out: { from?: DateFilterInput; to?: DateFilterInput } = {};
  if (!isOpenBound(range.from)) out.from = dateInput(range.from);
  if (!isOpenBound(range.to)) out.to = dateInput(range.to);
  return out;
}

/** Resolves a RelativeDate in ctx.tz at ctx.now() → half-open epoch ms `[from, to)`. */
function relativeRange(value: unknown, scope: SqlScope): { from: number; to: number } {
  if (typeof value !== "object" || value === null || Array.isArray(value) || typeof (value as { relative?: unknown }).relative !== "string") {
    throw new UnusableFilterValue("expected a relative date");
  }
  const r = resolveRelativeDate(value as RelativeDate, scope.ctx.now(), scope.ctx.tz);
  if ("error" in r) throw new UnusableFilterValue(r.error);
  return { from: Date.parse(r.from), to: Date.parse(r.to) };
}

const and = (parts: SQL[]): SQL => (parts.length === 0 ? sql`TRUE` : sql.join(parts, sql` AND `));

// ---- date (DATE, stored YYYY-MM-DD) -------------------------------------------

/** `start(D) >= v` ⟺ `D >= atOrAfter(v)`; `start(D) < v` ⟺ `D < atOrAfter(v)`. */
function atOrAfterDay(input: DateFilterInput, scope: SqlScope): string {
  return input.kind === "day" ? input.ymd : firstDayStartingAtOrAfter(input.ms, scope.ctx.tz);
}

/** `start(D) > v` ⟺ `D >= afterDay(v)`; `start(D) <= v` ⟺ `D < afterDay(v)` (ms granularity). */
function afterDay(ms: number, scope: SqlScope): string {
  return firstDayStartingAtOrAfter(ms + 1, scope.ctx.tz);
}

export const DATE_TRANSLATORS: Readonly<Record<string, OperatorTranslator>> = {
  /** Same local day; an instant is mapped to its local day in tz. */
  is: ({ expr, value, scope }) => {
    const v = dateInput(value);
    return sql`${expr.typed} = ${v.kind === "day" ? v.ymd : toLocalDate(new Date(v.ms).toISOString(), scope.ctx.tz)}`;
  },
  isBefore: ({ expr, value, scope }) => sql`${expr.typed} < ${atOrAfterDay(dateInput(value), scope)}`,
  /** Date-only: from the next day on (`D > E`); instant: `start(D) > v`. */
  isAfter: ({ expr, value, scope }) => {
    const v = dateInput(value);
    return v.kind === "day" ? sql`${expr.typed} > ${v.ymd}` : sql`${expr.typed} >= ${afterDay(v.ms, scope)}`;
  },
  /** Inclusive: a date-only `to` covers its whole day (`D <= to`). */
  isBetween: ({ expr, value, scope }) => {
    const { from, to } = rangeInput(value);
    const parts: SQL[] = [];
    if (from) parts.push(sql`${expr.typed} >= ${atOrAfterDay(from, scope)}`);
    if (to) {
      parts.push(to.kind === "day" ? sql`${expr.typed} <= ${to.ymd}` : sql`${expr.typed} < ${afterDay(to.ms, scope)}`);
    }
    return and(parts);
  },
  /** Relative range `[from, to)` resolved in ctx.tz, mapped to local days. */
  isWithin: ({ expr, value, scope }) => {
    const r = relativeRange(value, scope);
    const tz = scope.ctx.tz;
    return sql`${expr.typed} >= ${firstDayStartingAtOrAfter(r.from, tz)} AND ${expr.typed} < ${firstDayStartingAtOrAfter(r.to, tz)}`;
  },
};

// ---- datetime (DATETIME(3), stored UTC ISO) -----------------------------------

const dayStart = (ymd: string, scope: SqlScope): string => msToMysqlUtc(localDayStartMs(ymd, scope.ctx.tz));
const nextDayStart = (ymd: string, scope: SqlScope): string => dayStart(addDaysYmd(ymd, 1), scope);
const instantOf = (input: DateFilterInput, scope: SqlScope): string =>
  input.kind === "instant" ? msToMysqlUtc(input.ms) : dayStart(input.ymd, scope);

export const DATETIME_TRANSLATORS: Readonly<Record<string, OperatorTranslator>> = {
  /** Same local day as the value (date-only or instant): `[start, nextStart)`. */
  is: ({ expr, value, scope }) => {
    const v = dateInput(value);
    const ymd = v.kind === "day" ? v.ymd : toLocalDate(new Date(v.ms).toISOString(), scope.ctx.tz);
    return sql`${expr.typed} >= ${dayStart(ymd, scope)} AND ${expr.typed} < ${nextDayStart(ymd, scope)}`;
  },
  /** Strictly before the instant (a date-only value = its local day start). */
  isBefore: ({ expr, value, scope }) => sql`${expr.typed} < ${instantOf(dateInput(value), scope)}`,
  /** Date-only → on/after the next local day start; instant → strictly after. */
  isAfter: ({ expr, value, scope }) => {
    const v = dateInput(value);
    if (v.kind === "instant") return sql`${expr.typed} > ${msToMysqlUtc(v.ms)}`;
    return sql`${expr.typed} >= ${nextDayStart(v.ymd, scope)}`;
  },
  /**
   * Inclusive both ends. A date-only `from` starts at that local midnight; a
   * date-only `to` covers its whole local day (exclusive next-day start). ISO
   * bounds are inclusive instants.
   */
  isBetween: ({ expr, value, scope }) => {
    const { from, to } = rangeInput(value);
    const parts: SQL[] = [];
    if (from) parts.push(sql`${expr.typed} >= ${instantOf(from, scope)}`);
    if (to) {
      parts.push(
        to.kind === "instant"
          ? sql`${expr.typed} <= ${msToMysqlUtc(to.ms)}`
          : sql`${expr.typed} < ${nextDayStart(to.ymd, scope)}`,
      );
    }
    return and(parts);
  },
  isWithin: ({ expr, value, scope }) => {
    const r = relativeRange(value, scope);
    return sql`${expr.typed} >= ${msToMysqlUtc(r.from)} AND ${expr.typed} < ${msToMysqlUtc(r.to)}`;
  },
};
