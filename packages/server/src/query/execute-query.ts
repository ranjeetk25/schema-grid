import { projectRow } from "../access/projection";
import type { GridRow, QueryResult } from "../internal/core";
import { encodeCursor } from "../pagination/cursor";
import { cursorFromDbRow } from "../pagination/keyset";
import { trimPage } from "../pagination/offset";
import type { BuiltQuery, GridSqlScope } from "./build-query";
import { rowSourceOf } from "./row-source";

export interface ExecuteQueryOptions {
  /**
   * Hook applied to the hydrated page BEFORE projection and cursor computation.
   * T16 plugs formula evaluation in here (formula cells are filled on returned
   * rows); anything it adds for non-readable columns is still stripped by `projectRow`.
   */
  transformRows?: (rows: GridRow[]) => GridRow[];
}

/**
 * Runs a `BuiltQuery`: fetches the page (`limit + 1` rows) and the optional
 * total, hydrates each row, applies `transformRows`, projects out non-readable
 * cells, and computes `nextCursor` (keyset or offset, matching the page mode).
 */
export async function executeQuery(
  built: BuiltQuery,
  scope: GridSqlScope,
  options: ExecuteQueryOptions = {},
): Promise<QueryResult<GridRow>> {
  const [dbRows, countRows] = await Promise.all([built.select, built.count]);
  const { rows: page, hasMore } = trimPage(dbRows, built.limit);

  const source = rowSourceOf(scope);
  const hydrated = page.map((r) => source.hydrate(r as unknown as Record<string, unknown>));
  const transformed = options.transformRows ? options.transformRows(hydrated) : hydrated;
  const rows = transformed.map((r) => projectRow(r, scope.ctx.schema, built.access));

  const result: QueryResult<GridRow> = { rows };
  if (hasMore) {
    const lastDb = page.at(-1);
    if (built.pageMode === "keyset") {
      if (lastDb) {
        result.nextCursor = encodeCursor(
          cursorFromDbRow(lastDb as unknown as Record<string, unknown>, built.sortKeys, built.fingerprint),
        );
      }
    } else {
      result.nextCursor = encodeCursor({ v: 1, mode: "offset", fp: built.fingerprint, offset: built.offset + built.limit });
    }
  }
  if (countRows) result.total = Number(countRows[0]?.total ?? 0);
  return result;
}
