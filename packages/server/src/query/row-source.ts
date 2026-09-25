import { type SQL, eq, isNull } from "drizzle-orm";
import type { AnyMySqlTable } from "drizzle-orm/mysql-core";
import { projectionSql } from "../access/projection";
import type { AccessMap } from "../access/query-access";
import type { GridRow } from "../internal/core";
import type { SqlScope } from "../sql/scope";
import { type DbRow, hydrateRow } from "../storage/hydrate";
import type { GridTables } from "../storage/tables";

/**
 * What row, group and count queries select FROM — the second half of the
 * translator seam (the first is `ColumnExprResolver`). `buildQuery`,
 * `buildGroupQuery` and the formula fallback compose `from` + `where` with
 * the translated filter/search/sort/keyset; they never touch a table directly.
 */
export interface RowSource {
  /** FROM target: a drizzle table, or an SQL fragment (derived table + joins). */
  readonly from: AnyMySqlTable | SQL;
  /** Predicates ANDed into every query (grid scoping, soft deletes, …). `undefined` entries are ignored. */
  readonly where: readonly (SQL | undefined)[];
  /** Select map for a page of rows. MUST select the row id as `id` (keyset cursors read it). */
  projection(access: AccessMap): Record<string, unknown>;
  /** One selected DB row → GridRow (before formula evaluation and `projectRow`). */
  hydrate(dbRow: Record<string, unknown>): GridRow;
}

function requireTables(scope: SqlScope): GridTables {
  if (!scope.tables) throw new Error("The grid rows source needs `scope.tables` (or pass `scope.rowSource`)");
  return scope.tables;
}

/** The JSON-cells grid rows table: `grid_id = ?` AND `deleted_at IS NULL`, cells projected per readable key. */
export function gridRowsSource(scope: SqlScope & { gridId: string }): RowSource {
  const tables = requireTables(scope);
  const { rows } = tables;
  return {
    from: rows,
    where: [eq(rows.gridId, scope.gridId), isNull(rows.deletedAt)],
    projection: (access) => projectionSql(scope.ctx.schema, access, tables),
    hydrate: (dbRow) => hydrateRow(dbRow as unknown as DbRow, scope.ctx.schema, scope.ctx.registry),
  };
}

/** `scope.rowSource`, or the grid rows table. */
export function rowSourceOf(scope: SqlScope & { gridId: string }): RowSource {
  return scope.rowSource ?? gridRowsSource(scope);
}
