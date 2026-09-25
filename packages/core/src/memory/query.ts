import { isEmptyValue } from "../field-types/empty";
import { matchesFilter } from "../filter/match";
import { validateFilter } from "../filter/validate";
import type { GridQuery, QueryResult, SortSpec } from "../query/types";
import type { GridRow } from "../rows/types";
import type { ColumnDef } from "../schema/types";
import { type MemoryQueryContext, readableColumns, requireReadableColumn } from "./context";
import { groupRows } from "./group";
import { projectRow } from "./materialize";
import { InMemoryQueryError } from "./types";

function matchesSearch(row: GridRow, needle: string, columns: ColumnDef[], ctx: MemoryQueryContext): boolean {
  for (const column of columns) {
    const type = ctx.registry.get(column.type);
    const value = row.cells[column.key];
    if (isEmptyValue(value)) continue;
    let text: string;
    try {
      text = type ? type.format(value, column.config) : String(value);
    } catch {
      text = String(value);
    }
    if (text.toLowerCase().includes(needle)) return true;
  }
  return false;
}

/** Stable multi-key sort; empties last in both directions; row id is the final tie-break. */
export function sortRows<Row extends GridRow>(rows: Row[], sort: SortSpec[], ctx: MemoryQueryContext): Row[] {
  const keys = sort.map((s) => {
    const column = requireReadableColumn(s.columnId, ctx, "sort");
    return { column, type: ctx.registry.get(column.type), sign: s.dir === "desc" ? -1 : 1 };
  });
  return [...rows].sort((a, b) => {
    for (const { column, type, sign } of keys) {
      const va = a.cells[column.key];
      const vb = b.cells[column.key];
      const ea = isEmptyValue(va);
      const eb = isEmptyValue(vb);
      if (ea || eb) {
        if (ea && eb) continue;
        return ea ? 1 : -1;
      }
      let c = 0;
      try {
        c = type ? type.compare(va, vb, column.config) : String(va) < String(vb) ? -1 : String(va) > String(vb) ? 1 : 0;
      } catch {
        c = 0;
      }
      if (c !== 0) return c * sign;
    }
    // Plain code-unit order (matches a binary SQL collation), locale-independent.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

const CURSOR_PREFIX = "sgm:";

export function encodeOffsetCursor(offset: number): string {
  return `${CURSOR_PREFIX}${offset.toString(36)}`;
}

function decodeOffsetCursor(cursor: string): number {
  if (typeof cursor === "string" && cursor.startsWith(CURSOR_PREFIX)) {
    const n = Number.parseInt(cursor.slice(CURSOR_PREFIX.length), 36);
    if (Number.isInteger(n) && n >= 0 && encodeOffsetCursor(n) === cursor) return n;
  }
  throw new InMemoryQueryError("invalidCursor", "Invalid page cursor");
}

function resolvePage(query: GridQuery): { offset: number; limit: number } {
  const page = query.page;
  const limit = page?.limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit <= 0) {
    throw new InMemoryQueryError("invalidPage", "page.limit must be a positive integer");
  }
  if (typeof page.cursor === "string") return { offset: decodeOffsetCursor(page.cursor), limit };
  const offset = page.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new InMemoryQueryError("invalidPage", "page.offset must be a non-negative integer");
  }
  return { offset, limit };
}

/**
 * Filters / searches / sorts / pages already-materialised rows. Throws
 * InMemoryQueryError for invalid queries (the data source turns that into a
 * rejected promise). Returned rows are projected copies.
 */
export function runQuery<Row extends GridRow>(
  rows: readonly Row[],
  query: GridQuery,
  ctx: MemoryQueryContext,
): QueryResult<Row> {
  const readable = readableColumns(ctx);
  const readableIds = new Set(readable.map((c) => c.id));

  const filterErrors = validateFilter(query.filter ?? null, ctx.schema, ctx.registry, readableIds);
  const firstError = filterErrors[0];
  if (firstError) {
    throw new InMemoryQueryError(firstError.code, "Invalid filter", filterErrors);
  }
  const { offset, limit } = resolvePage(query);
  // Validate grouping/aggregations before doing any work.
  if (query.groupBy?.length) groupRows([], query.groupBy, ctx);

  const matchCtx = {
    schema: ctx.schema,
    registry: ctx.registry,
    now: ctx.now,
    tz: ctx.tz,
    ...(ctx.userId !== undefined ? { userId: ctx.userId } : {}),
  };
  let result = rows.filter((row) => matchesFilter(query.filter ?? null, row, matchCtx));

  const needle = query.search?.trim().toLowerCase();
  if (needle) result = result.filter((row) => matchesSearch(row, needle, readable, ctx));

  const groups = query.groupBy?.length ? groupRows(result, query.groupBy, ctx) : undefined;

  result = sortRows(result, query.sort ?? [], ctx);

  const total = result.length;
  const pageRows = result.slice(offset, offset + limit);
  const readableKeys = new Set(readable.map((c) => c.key));
  const out: QueryResult<Row> = { rows: pageRows.map((r) => projectRow(r, readableKeys)) };
  if (query.includeTotal) out.total = total;
  if (groups) out.groups = groups;
  if (offset + limit < total) out.nextCursor = encodeOffsetCursor(offset + limit);
  return out;
}
