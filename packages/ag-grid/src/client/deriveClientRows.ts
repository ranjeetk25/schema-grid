/**
 * Client-mode row derivation. Filtering, search and sorting always use core's
 * in-memory semantics (null handling, relative dates, nulls-last…), never AG
 * Grid's. AG Grid receives the already-derived rows; `makePostSortRows` then
 * re-imposes core's order after any AG-side sort.
 */
import type { PostSortRowsParams } from "ag-grid-community";
import {
  type ColumnDef,
  type FieldTypeRegistry,
  type FilterValidationError,
  type GridQuery,
  type GridRow,
  type GridSchema,
  type PageRequest,
  matchesFilter,
  searchRows,
  sortRows,
  validateFilter,
} from "../internal/core";
import type { QueryState } from "../state/queryStore";

export interface DeriveClientRowsContext {
  schema: GridSchema;
  registry: FieldTypeRegistry;
  /** Columns the current user may read. Search and sort ignore everything else; filters on others are rejected. */
  readableColumnIds: ReadonlySet<string> | readonly string[];
  user?: { id: string };
  tz?: string;
  now?: Date;
  /** Override cell reads (e.g. computed formula values). */
  getCellValue?(row: GridRow, column: ColumnDef): unknown;
}

export interface DeriveClientRowsResult<Row extends GridRow> {
  rows: Row[];
  /** rowId → position in `rows`. */
  orderIndex: Map<string, number>;
  /** Filter validation errors. When non-empty, the filter was NOT applied. */
  errors: FilterValidationError[];
}

/**
 * filter → search → sort, same order as core's in-memory data source.
 *
 * Invalid filter policy: if `validateFilter` reports any error (unknown or
 * unreadable column, bad operator, depth), NO filter is applied and the errors
 * are returned. We never apply a partially-valid filter silently, and never
 * narrow rows by a column the user cannot see; the caller surfaces `errors`.
 */
export function deriveClientRows<Row extends GridRow>(
  rows: readonly Row[],
  query: Pick<QueryState, "filter" | "sort" | "search">,
  ctx: DeriveClientRowsContext,
): DeriveClientRowsResult<Row> {
  const readable =
    ctx.readableColumnIds instanceof Set
      ? (ctx.readableColumnIds as ReadonlySet<string>)
      : new Set(ctx.readableColumnIds as readonly string[]);

  const errors = validateFilter(query.filter, ctx.schema, ctx.registry, readable);
  const filter = errors.length === 0 ? query.filter : null;

  const matchCtx = {
    schema: ctx.schema,
    registry: ctx.registry,
    ...(ctx.user ? { user: ctx.user } : {}),
    ...(ctx.now ? { now: ctx.now } : {}),
    ...(ctx.tz ? { tz: ctx.tz } : {}),
    ...(ctx.getCellValue ? { getCellValue: ctx.getCellValue } : {}),
  };

  let out: Row[] = filter ? rows.filter((r) => matchesFilter(r, filter, matchCtx)) : [...rows];
  out = searchRows(out, query.search, { ...matchCtx, readableColumnIds: readable });
  out = sortRows(
    out,
    query.sort.filter((s) => readable.has(s.columnId)),
    matchCtx,
  );

  const orderIndex = new Map<string, number>();
  out.forEach((r, i) => orderIndex.set(r.id, i));
  return { rows: out, orderIndex, errors };
}

/**
 * AG Grid `postSortRows` callback that re-sorts `params.nodes` in place by
 * core's order. Nodes without data or with unknown ids go last, keeping their
 * relative order (Array.prototype.sort is stable).
 */
export function makePostSortRows<Row extends GridRow>(
  getOrderIndex: () => ReadonlyMap<string, number>,
): (params: PostSortRowsParams<Row>) => void {
  return (params) => {
    const index = getOrderIndex();
    const pos = (id: string | undefined) => (id === undefined ? undefined : index.get(id)) ?? Number.POSITIVE_INFINITY;
    params.nodes.sort((a, b) => {
      const pa = pos(a.data?.id);
      const pb = pos(b.data?.id);
      return pa === pb ? 0 : pa < pb ? -1 : 1;
    });
  };
}

/** Build a GridQuery from query state. `groupBy` is included only when non-empty. */
export function toGridQuery(state: QueryState, page: PageRequest, opts?: { includeTotal?: boolean }): GridQuery {
  const query: GridQuery = { filter: state.filter, sort: state.sort, page };
  if (state.search !== undefined && state.search !== "") query.search = state.search;
  if (state.groupBy.length > 0) query.groupBy = state.groupBy;
  if (opts?.includeTotal !== undefined) query.includeTotal = opts.includeTotal;
  return query;
}
