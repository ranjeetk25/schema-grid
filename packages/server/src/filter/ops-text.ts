import { sql } from "drizzle-orm";
import { UnsupportedOperatorError } from "../errors";
import type { FilterValue } from "../internal/core";
import { escapeLike, likeSql } from "../sql/like";
import type { OperatorTranslator } from "./types";

export function stringValue(value: FilterValue | undefined, operator: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  throw new UnsupportedOperatorError(operator, { kind: "expected a single text value" });
}

export const TEXT_TRANSLATORS: Readonly<Record<string, OperatorTranslator>> = {
  contains: ({ expr, value, operator }) => likeSql(expr.typed, `%${escapeLike(stringValue(value, operator.id))}%`),
  notContains: ({ expr, value, operator }) =>
    likeSql(expr.typed, `%${escapeLike(stringValue(value, operator.id))}%`, true),
  startsWith: ({ expr, value, operator }) => likeSql(expr.typed, `${escapeLike(stringValue(value, operator.id))}%`),
  is: ({ expr, value, operator }) => sql`${expr.typed} = ${stringValue(value, operator.id)}`,
  isNot: ({ expr, value, operator }) => sql`${expr.typed} <> ${stringValue(value, operator.id)}`,
};
