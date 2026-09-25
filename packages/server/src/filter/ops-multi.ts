import { type SQL, sql } from "drizzle-orm";
import { stringListValue } from "./ops-choice";
import { stringValue } from "./ops-text";
import type { OperatorTranslator } from "./types";

/** The id array bound as ONE JSON string param, cast to JSON in SQL. */
function jsonArrayParam(ids: string[]): SQL {
  return sql`CAST(${JSON.stringify(ids)} AS JSON)`;
}

function overlaps(typed: SQL, ids: string[]): SQL {
  return sql`JSON_OVERLAPS(${typed}, ${jsonArrayParam(ids)})`;
}

/**
 * Kind "multi": `typed` is the JSON id array — `$.tags` for multiSelect,
 * `$.links[*].id` for link. When the cell is absent `typed` is NULL, so
 * `JSON_OVERLAPS` / `JSON_CONTAINS` (and their NOT) yield NULL; translateFilter's
 * null rule (`AND NOT empty` / `OR empty`) turns that into the right answer.
 */
export const MULTI_TRANSLATORS: Readonly<Record<string, OperatorTranslator>> = {
  hasAnyOf: ({ expr, value, operator }) => {
    const ids = stringListValue(value, operator.id);
    return ids.length === 0 ? sql`FALSE` : overlaps(expr.typed, ids);
  },
  hasAllOf: ({ expr, value, operator }) => {
    const ids = stringListValue(value, operator.id);
    return ids.length === 0 ? sql`TRUE` : sql`JSON_CONTAINS(${expr.typed}, ${jsonArrayParam(ids)})`;
  },
  hasNoneOf: ({ expr, value, operator }) => {
    const ids = stringListValue(value, operator.id);
    return ids.length === 0 ? sql`TRUE` : sql`NOT ${overlaps(expr.typed, ids)}`;
  },
  // Link columns (LINK_OPERATORS): "links to this record" / "links to any of these".
  is: ({ expr, value, operator }) => overlaps(expr.typed, [stringValue(value, operator.id)]),
  isAnyOf: ({ expr, value, operator }) => {
    const ids = stringListValue(value, operator.id);
    return ids.length === 0 ? sql`FALSE` : overlaps(expr.typed, ids);
  },
};
