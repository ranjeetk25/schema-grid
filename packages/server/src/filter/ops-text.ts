import { sql } from "drizzle-orm";
import { escapeLike, likeSql } from "../sql/like";
import type { OperatorTranslator } from "./types";
import { textValue } from "./values";

/**
 * Text operators (core `matchText`). Case-insensitivity comes from the
 * `utf8mb4_0900_as_ci` collation (`TEXT_COLLATION`) on `typed`; like core's
 * `toLowerCase`, it is accent-SENSITIVE ("jose" ≠ "José").
 *
 * - `contains` / `notContains` / `startsWith` do NOT trim either side.
 * - `is` / `isNot` trim BOTH sides: `TRIM(typed) = ?` with a JS-trimmed param.
 *   MySQL `TRIM` strips spaces only, whereas JS `trim()` also strips tabs,
 *   newlines and other Unicode whitespace — so a cell with a trailing tab/newline
 *   is still not `is`-equal in SQL. (Whitespace-ONLY cells are empty, so they
 *   never reach the comparison.)
 */
export const TEXT_TRANSLATORS: Readonly<Record<string, OperatorTranslator>> = {
  contains: ({ expr, value }) => likeSql(expr.typed, `%${escapeLike(textValue(value))}%`),
  notContains: ({ expr, value }) => likeSql(expr.typed, `%${escapeLike(textValue(value))}%`, true),
  startsWith: ({ expr, value }) => likeSql(expr.typed, `${escapeLike(textValue(value))}%`),
  is: ({ expr, value }) => sql`TRIM(${expr.typed}) = ${textValue(value).trim()}`,
  isNot: ({ expr, value }) => sql`TRIM(${expr.typed}) <> ${textValue(value).trim()}`,
};
