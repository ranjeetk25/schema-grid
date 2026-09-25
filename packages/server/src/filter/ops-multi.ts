import { type SQL, sql } from "drizzle-orm";
import type { OperatorTranslator } from "./types";
import { assertUsableIdList, idListValue, idValue } from "./values";

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
 *
 * Lists follow core `asIdList` (non-array → [], items stringified). With no ids
 * `hasAnyOf` / `hasAllOf` / `isAnyOf` never match (FALSE); `hasNoneOf` without a
 * usable id is unusable (FALSE → only empty cells match), as in core.
 */
export const MULTI_TRANSLATORS: Readonly<Record<string, OperatorTranslator>> = {
  hasAnyOf: ({ expr, value }) => {
    const ids = idListValue(value);
    return ids.length === 0 ? sql`FALSE` : overlaps(expr.typed, ids);
  },
  hasAllOf: ({ expr, value }) => {
    const ids = idListValue(value);
    return ids.length === 0 ? sql`FALSE` : sql`JSON_CONTAINS(${expr.typed}, ${jsonArrayParam(ids)})`;
  },
  hasNoneOf: ({ expr, value }) => {
    assertUsableIdList(value);
    return sql`NOT ${overlaps(expr.typed, idListValue(value))}`;
  },
  // Link columns (LINK_OPERATORS): "links to this record" / "links to any of these".
  is: ({ expr, value }) => overlaps(expr.typed, [idValue(value)]),
  isAnyOf: ({ expr, value }) => {
    const ids = idListValue(value);
    return ids.length === 0 ? sql`FALSE` : overlaps(expr.typed, ids);
  },
};
