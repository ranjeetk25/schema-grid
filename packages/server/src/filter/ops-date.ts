import { type SQL, sql } from "drizzle-orm";
import { UnsupportedOperatorError } from "../errors";
import { type FilterValue, type RelativeDate, resolveRelativeDate } from "../internal/core";
import { ISO_INSTANT_RE, addDaysYmd, localDayStartUtc, parseYmd, toLocalDate, toMysqlUtc } from "../sql/dates";
import type { SqlScope } from "../sql/scope";
import type { OperatorTranslator } from "./types";

/**
 * Date / datetime operators. All are positive (empty never matches — the
 * `AND NOT empty` wrapper comes from translateFilter). Ranges are half-open
 * `[from, to)` except `isBetween`, which is inclusive of both ends to match
 * core's in-memory `matchesFilter`.
 *
 * Range translators return a bare `a AND b` (no parens) so the combined
 * condition reads `(x >= ? AND x < ? AND NOT <empty>)`; safe because these
 * operators are positive and only ever ANDed.
 *
 * Storage: date = `YYYY-MM-DD`; datetime = UTC ISO (`typed` is `DATETIME(3)`),
 * so datetime params are UTC `YYYY-MM-DD HH:MM:SS.fff` strings.
 */

type DateInput = { kind: "day"; ymd: string } | { kind: "instant"; iso: string };

function parseDateInput(value: unknown, operator: string): DateInput {
  if (typeof value === "string") {
    if (parseYmd(value)) return { kind: "day", ymd: value };
    if (ISO_INSTANT_RE.test(value) && !Number.isNaN(new Date(value).getTime())) return { kind: "instant", iso: value };
  }
  throw new UnsupportedOperatorError(operator, { kind: "expected YYYY-MM-DD or an ISO instant with offset" });
}

function isBound(v: unknown): boolean {
  return v !== null && v !== undefined && v !== "";
}

function rangeInput(value: FilterValue | undefined, operator: string): { from?: DateInput; to?: DateInput } {
  if (typeof value === "object" && value !== null && !Array.isArray(value) && "from" in value && "to" in value) {
    const out: { from?: DateInput; to?: DateInput } = {};
    if (isBound(value.from)) out.from = parseDateInput(value.from, operator);
    if (isBound(value.to)) out.to = parseDateInput(value.to, operator);
    if (!out.from && !out.to) throw new UnsupportedOperatorError(operator, { kind: "range needs at least one bound" });
    return out;
  }
  throw new UnsupportedOperatorError(operator, { kind: "expected a {from, to} range" });
}

/** Resolves a RelativeDate in ctx.tz at ctx.now() → half-open UTC ISO `[from, to)`. */
function relativeRange(value: FilterValue | undefined, operator: string, scope: SqlScope): { from: string; to: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !("relative" in value)) {
    throw new UnsupportedOperatorError(operator, { kind: "expected a relative date" });
  }
  const r = resolveRelativeDate(value as RelativeDate, scope.ctx.now(), scope.ctx.tz);
  if ("error" in r) throw new UnsupportedOperatorError(operator, { kind: r.error });
  return r;
}

const and = (parts: SQL[]): SQL => sql.join(parts, sql` AND `);

// ---- date (DATE, stored YYYY-MM-DD) -------------------------------------------

/** A date-column param: plain days as-is, instants converted to their local day in tz. */
function dayParam(input: DateInput, scope: SqlScope): string {
  return input.kind === "day" ? input.ymd : toLocalDate(input.iso, scope.ctx.tz);
}

const dateCmp =
  (op: "=" | "<" | ">"): OperatorTranslator =>
  ({ expr, value, operator, scope }) =>
    sql`${expr.typed} ${sql.raw(op)} ${dayParam(parseDateInput(value, operator.id), scope)}`;

export const DATE_TRANSLATORS: Readonly<Record<string, OperatorTranslator>> = {
  is: dateCmp("="),
  isBefore: dateCmp("<"),
  isAfter: dateCmp(">"),
  /** Inclusive both ends: `from <= d <= to` (matches core matchesFilter). */
  isBetween: ({ expr, value, operator, scope }) => {
    const { from, to } = rangeInput(value, operator.id);
    const parts: SQL[] = [];
    if (from) parts.push(sql`${expr.typed} >= ${dayParam(from, scope)}`);
    if (to) parts.push(sql`${expr.typed} <= ${dayParam(to, scope)}`);
    return and(parts);
  },
  /** Relative range resolved in ctx.tz; both UTC bounds mapped back to local days. */
  isWithin: ({ expr, value, operator, scope }) => {
    const r = relativeRange(value, operator.id, scope);
    return sql`${expr.typed} >= ${toLocalDate(r.from, scope.ctx.tz)} AND ${expr.typed} < ${toLocalDate(r.to, scope.ctx.tz)}`;
  },
};

// ---- datetime (DATETIME(3), stored UTC ISO) -----------------------------------

const dayStart = (ymd: string, scope: SqlScope): string => toMysqlUtc(localDayStartUtc(ymd, scope.ctx.tz));
const nextDayStart = (ymd: string, scope: SqlScope): string => dayStart(addDaysYmd(ymd, 1), scope);

export const DATETIME_TRANSLATORS: Readonly<Record<string, OperatorTranslator>> = {
  /** Plain date → that local day `[start, nextStart)`; ISO → exact instant. */
  is: ({ expr, value, operator, scope }) => {
    const v = parseDateInput(value, operator.id);
    if (v.kind === "instant") return sql`${expr.typed} = ${toMysqlUtc(v.iso)}`;
    return sql`${expr.typed} >= ${dayStart(v.ymd, scope)} AND ${expr.typed} < ${nextDayStart(v.ymd, scope)}`;
  },
  /** Plain date → before the local day starts; ISO → strictly before the instant. */
  isBefore: ({ expr, value, operator, scope }) => {
    const v = parseDateInput(value, operator.id);
    return sql`${expr.typed} < ${v.kind === "instant" ? toMysqlUtc(v.iso) : dayStart(v.ymd, scope)}`;
  },
  /** Plain date → strictly after the whole local day (>= next day start); ISO → strictly after. */
  isAfter: ({ expr, value, operator, scope }) => {
    const v = parseDateInput(value, operator.id);
    if (v.kind === "instant") return sql`${expr.typed} > ${toMysqlUtc(v.iso)}`;
    return sql`${expr.typed} >= ${nextDayStart(v.ymd, scope)}`;
  },
  /**
   * Inclusive both ends. A plain-date `from` starts at that local midnight; a
   * plain-date `to` covers its whole local day (exclusive next-day start). ISO
   * bounds are inclusive instants.
   */
  isBetween: ({ expr, value, operator, scope }) => {
    const { from, to } = rangeInput(value, operator.id);
    const parts: SQL[] = [];
    if (from) parts.push(sql`${expr.typed} >= ${from.kind === "instant" ? toMysqlUtc(from.iso) : dayStart(from.ymd, scope)}`);
    if (to) {
      parts.push(
        to.kind === "instant"
          ? sql`${expr.typed} <= ${toMysqlUtc(to.iso)}`
          : sql`${expr.typed} < ${nextDayStart(to.ymd, scope)}`,
      );
    }
    return and(parts);
  },
  isWithin: ({ expr, value, operator, scope }) => {
    const r = relativeRange(value, operator.id, scope);
    return sql`${expr.typed} >= ${toMysqlUtc(r.from)} AND ${expr.typed} < ${toMysqlUtc(r.to)}`;
  },
};
