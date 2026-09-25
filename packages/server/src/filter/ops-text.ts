import { sql } from "drizzle-orm";
import { UnsupportedOperatorError } from "../errors";
import type { FilterValue } from "../internal/core";
import { escapeLike } from "../sql/like";
import type { OperatorTranslator } from "./types";

export function stringValue(value: FilterValue | undefined, operator: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  throw new UnsupportedOperatorError(operator, { kind: "expected a single text value" });
}

export const TEXT_TRANSLATORS: Readonly<Record<string, OperatorTranslator>> = {
  contains: ({ expr, value, operator }) => sql`${expr.typed} LIKE ${`%${escapeLike(stringValue(value, operator.id))}%`}`,
  notContains: ({ expr, value, operator }) =>
    sql`${expr.typed} NOT LIKE ${`%${escapeLike(stringValue(value, operator.id))}%`}`,
  startsWith: ({ expr, value, operator }) => sql`${expr.typed} LIKE ${`${escapeLike(stringValue(value, operator.id))}%`}`,
  is: ({ expr, value, operator }) => sql`${expr.typed} = ${stringValue(value, operator.id)}`,
  isNot: ({ expr, value, operator }) => sql`${expr.typed} <> ${stringValue(value, operator.id)}`,
};
