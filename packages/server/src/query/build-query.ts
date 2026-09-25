import { type SQL, and, eq, isNull, sql } from "drizzle-orm";
import { type AccessMap, assertQueryAccess, resolveAccess } from "../access/query-access";
import { type ProjectionSelect, projectionSql } from "../access/projection";
import { CursorError } from "../errors";
import { translateFilter } from "../filter/translate-filter";
import { planFormulaColumns } from "../formula/formula-plan";
import type { GridQuery } from "../internal/core";
import { assertCursorMatches, decodeCursor, queryFingerprint } from "../pagination/cursor";
import { keysetPredicate, sortKeySelect } from "../pagination/keyset";
import { offsetClause } from "../pagination/offset";
import { translateSearch } from "../search/translate-search";
import type { FormulaPlan, SqlScope } from "../sql/scope";
import { type SortKey, translateSort } from "../sort/translate-sort";
import type { DbRow } from "../storage/hydrate";

/** A SQL scope bound to one grid (`grid_id`). */
export type GridSqlScope = SqlScope & { gridId: string };

/** A built, awaitable drizzle select (anything that renders SQL and resolves to rows). */
export interface SelectStatement<T> extends PromiseLike<T[]> {
  toSQL(): { sql: string; params: unknown[] };
}

/**
 * Minimal database surface `buildQuery` needs: drizzle's `select(fields)`.
 * Any `MySqlDatabase` / transaction satisfies it.
 */
export interface SelectCapableDb {
  // biome-ignore lint/suspicious/noExplicitAny: drizzle's select() overloads are not expressible structurally
  select: (...args: any[]) => any;
}

export type PageMode = "offset" | "keyset";

export interface BuiltQuery {
  /** Rows statement; fetches `limit + 1` rows so the caller can detect a next page. */
  select: SelectStatement<DbRow>;
  /** `COUNT(*)` over the same WHERE (without the keyset predicate); only when `includeTotal`. */
  count?: SelectStatement<{ total: number | string }>;
  sortKeys: SortKey[];
  pageMode: PageMode;
  /** Page size (clamped to 1..MAX_PAGE_LIMIT). */
  limit: number;
  /** Row offset in offset mode; 0 in keyset mode. */
  offset: number;
  fingerprint: string;
  formulaPlans: ReadonlyMap<string, FormulaPlan>;
  access: AccessMap;
}

interface Paging {
  mode: PageMode;
  limit: number;
  offset: number;
  keyset?: { keys: (string | number | boolean | null)[]; id: string };
}

function resolvePaging(query: GridQuery, fingerprint: string): Paging {
  const page = query.page;
  if (page.cursor === "") {
    // Empty cursor = first page in keyset mode (returns a keyset `nextCursor`).
    const { limit } = offsetClause({ limit: page.limit });
    return { mode: "keyset", limit, offset: 0 };
  }
  if (typeof page.cursor === "string") {
    const payload = decodeCursor(page.cursor);
    assertCursorMatches(payload, fingerprint);
    if (payload.mode === "offset") {
      const { limit, offset } = offsetClause({ limit: page.limit, offset: payload.offset ?? 0 });
      return { mode: "offset", limit, offset };
    }
    if (typeof payload.id !== "string") throw new CursorError("Keyset cursor is missing the row id");
    const { limit } = offsetClause({ limit: page.limit });
    return { mode: "keyset", limit, offset: 0, keyset: { keys: payload.keys ?? [], id: payload.id } };
  }
  const { limit, offset } = offsetClause({ limit: page.limit, offset: page.offset });
  return { mode: "offset", limit, offset };
}

/**
 * GridQuery → drizzle statements for a page of rows (and optionally the total).
 *
 * Column permissions and filter validity are checked FIRST (`PermissionError` /
 * `FilterValidationError` are thrown before any SQL is built). `groupBy` is
 * permission-checked but otherwise ignored here: grouping queries are built
 * separately (T17). Formula columns in fallback mode referenced by filter/sort
 * currently throw `UnsupportedOperatorError` from the column resolver (T16).
 */
export function buildQuery(query: GridQuery, scope: GridSqlScope, db: SelectCapableDb, access?: AccessMap): BuiltQuery {
  const resolvedAccess = access ?? resolveAccess(scope.ctx);
  assertQueryAccess(query, scope.ctx, resolvedAccess);

  const formulaPlans = scope.formulaPlans ?? planFormulaColumns(scope);
  const planned: GridSqlScope = { ...scope, formulaPlans };

  const fingerprint = queryFingerprint(query, planned.ctx.schema.schemaVersion);
  const paging = resolvePaging(query, fingerprint);

  const rows = planned.tables.rows;
  const baseWhere: (SQL | undefined)[] = [
    eq(rows.gridId, planned.gridId),
    isNull(rows.deletedAt),
    translateFilter(query.filter, planned),
    translateSearch(query.search, resolvedAccess, planned),
  ];
  const { orderBy, keys: sortKeys } = translateSort(query.sort ?? [], planned);
  const keyset = paging.keyset ? keysetPredicate(sortKeys, paging.keyset) : undefined;

  const projection: ProjectionSelect = projectionSql(planned.ctx.schema, resolvedAccess, planned.tables);
  let select = db
    .select({ ...projection, ...sortKeySelect(sortKeys) })
    .from(rows)
    .where(and(...baseWhere, keyset))
    .orderBy(...orderBy)
    .limit(paging.limit + 1);
  if (paging.mode === "offset") select = select.offset(paging.offset);

  const built: BuiltQuery = {
    select: select as SelectStatement<DbRow>,
    sortKeys,
    pageMode: paging.mode,
    limit: paging.limit,
    offset: paging.offset,
    fingerprint,
    formulaPlans,
    access: resolvedAccess,
  };
  if (query.includeTotal) {
    built.count = db
      .select({ total: sql<number>`COUNT(*)` })
      .from(rows)
      .where(and(...baseWhere)) as SelectStatement<{ total: number | string }>;
  }
  return built;
}
