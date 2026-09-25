import { type SQL, sql } from "drizzle-orm";
import type { OperatorTranslator } from "./types";
import { isOpenBound, numberValue, rangeValue } from "./values";

const cmp =
  (op: "=" | "<>" | "<" | "<=" | ">" | ">="): OperatorTranslator =>
  ({ expr, value }) =>
    sql`${expr.typed} ${sql.raw(op)} ${numberValue(value)}`;

/**
 * Number operators (core `matchNumber`). Values use core's strict decimal
 * coercion (`numberValue`); an unusable value makes the comparison FALSE.
 */
export const NUMBER_TRANSLATORS: Readonly<Record<string, OperatorTranslator>> = {
  eq: cmp("="),
  neq: cmp("<>"),
  lt: cmp("<"),
  lte: cmp("<="),
  gt: cmp(">"),
  gte: cmp(">="),
  /**
   * Inclusive on both ends. A null / blank bound is open; both open matches any
   * non-empty cell (`TRUE`, the null rule adds `AND NOT empty`). A present but
   * non-numeric bound is unusable (FALSE).
   */
  between: ({ expr, value }) => {
    const { from, to } = rangeValue(value);
    const parts: SQL[] = [];
    if (!isOpenBound(from)) parts.push(sql`${expr.typed} >= ${numberValue(from)}`);
    if (!isOpenBound(to)) parts.push(sql`${expr.typed} <= ${numberValue(to)}`);
    if (parts.length === 0) return sql`TRUE`;
    return parts.length === 1 ? (parts[0] as SQL) : sql`(${sql.join(parts, sql` AND `)})`;
  },
};
