import { type SQL, sql } from "drizzle-orm";
import { UnsupportedOperatorError } from "../errors";
import type { FilterValue } from "../internal/core";
import type { OperatorTranslator } from "./types";

export function numberValue(value: unknown, operator: string): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) throw new UnsupportedOperatorError(operator, { kind: "expected a finite number" });
  return n;
}

function rangeValue(value: FilterValue | undefined, operator: string): { from: unknown; to: unknown } {
  if (typeof value === "object" && value !== null && !Array.isArray(value) && "from" in value && "to" in value) {
    return { from: value.from, to: value.to };
  }
  throw new UnsupportedOperatorError(operator, { kind: "expected a {from, to} range" });
}

const cmp =
  (op: "=" | "<>" | "<" | "<=" | ">" | ">="): OperatorTranslator =>
  ({ expr, value, operator }) =>
    sql`${expr.typed} ${sql.raw(op)} ${numberValue(value, operator.id)}`;

export const NUMBER_TRANSLATORS: Readonly<Record<string, OperatorTranslator>> = {
  eq: cmp("="),
  neq: cmp("<>"),
  lt: cmp("<"),
  lte: cmp("<="),
  gt: cmp(">"),
  gte: cmp(">="),
  /** Inclusive on both ends; a null bound makes it one-sided. */
  between: ({ expr, value, operator }) => {
    const { from, to } = rangeValue(value, operator.id);
    const parts: SQL[] = [];
    if (from !== null && from !== undefined && from !== "") parts.push(sql`${expr.typed} >= ${numberValue(from, operator.id)}`);
    if (to !== null && to !== undefined && to !== "") parts.push(sql`${expr.typed} <= ${numberValue(to, operator.id)}`);
    if (parts.length === 0) throw new UnsupportedOperatorError(operator.id, { kind: "range needs at least one bound" });
    return parts.length === 1 ? (parts[0] as SQL) : sql`(${sql.join(parts, sql` AND `)})`;
  },
};
