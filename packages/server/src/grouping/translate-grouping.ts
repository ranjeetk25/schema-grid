import { type SQL, and, eq, isNull, sql } from "drizzle-orm";
import { type AccessMap, assertQueryAccess, resolveAccess } from "../access/query-access";
import { CursorError, GroupingError, UnsupportedOperatorError } from "../errors";
import { translateFilter } from "../filter/translate-filter";
import { planFormulaColumns } from "../formula/formula-plan";
import {
  type AggregationId,
  type ColumnDef,
  type GridQuery,
  type GridRow,
  type GroupAggregateValue,
  type GroupResult,
  type QueryResult,
  getColumnValueFieldType,
  getColumnAggregations,
} from "../internal/core";
import { assertCursorMatches, decodeCursor, encodeCursor, queryFingerprint } from "../pagination/cursor";
import { offsetClause, trimPage } from "../pagination/offset";
import type { GridSqlScope, SelectCapableDb, SelectStatement } from "../query/build-query";
import { translateSearch } from "../search/translate-search";
import { type ColumnExpr, resolveColumnExpr } from "../sql/column-expr";
import type { StorageKind } from "../sql/storage-kind";

/** Storage kinds a grouping column may have (datetime would need MySQL tz tables for local-day grouping). */
const GROUPABLE_KINDS: ReadonlySet<StorageKind> = new Set(["text", "choice", "ref", "number", "boolean", "date"]);
/** Field types excluded even though their storage kind is groupable. */
const UNGROUPABLE_TYPES: ReadonlySet<string> = new Set(["longText"]);

const KEY = "sg_group_key";
const EMPTY = "sg_group_empty";
const COUNT = "sg_count";
const aggAlias = (i: number) => `sg_agg_${i}`;

const DATE_FORMAT = "%Y-%m-%d";
const DATETIME_FORMAT = "%Y-%m-%dT%H:%i:%s.%fZ";

/** How a raw aggregate value is converted back to JS. */
type AggValueKind = "number" | "date" | "datetime";

interface PlannedAggregation {
  columnId: string;
  agg: AggregationId;
  valueKind: AggValueKind;
}

/** Raw row shape of the grouping select (drizzle maps array rows onto these field names). */
type GroupDbRow = Record<string, unknown>;

export interface BuiltGroupQuery {
  /** One row per group; fetches `limit + 1` groups so the caller can detect a next page. */
  select: SelectStatement<GroupDbRow>;
  /** Number of groups over the same WHERE; only when `includeTotal`. */
  count?: SelectStatement<{ total: number | string }>;
  /** The grouped column (`groupBy[0]`). */
  columnId: string;
  /** Storage kind of the grouped column (drives value conversion). */
  kind: StorageKind;
  aggregations: readonly PlannedAggregation[];
  /** Page size in groups (clamped to 1..MAX_PAGE_LIMIT). */
  limit: number;
  /** Group offset. */
  offset: number;
  fingerprint: string;
  access: AccessMap;
}

function findColumn(scope: GridSqlScope, columnId: string): ColumnDef {
  const column = scope.ctx.schema.columns.find((c) => c.id === columnId);
  // assertQueryAccess already reports unknown ids; this is a defensive guard.
  if (!column) throw new GroupingError(`Unknown column "${columnId}"`, { columnId });
  return column;
}

/** `resolveColumnExpr`, with non-SQL columns (fallback formulas, bad sources) reported as `GroupingError`. */
function exprFor(column: ColumnDef, scope: GridSqlScope, usage: "groupBy" | "aggregate"): ColumnExpr {
  try {
    return resolveColumnExpr(column, scope);
  } catch (e) {
    if (e instanceof UnsupportedOperatorError) {
      throw new GroupingError(`Column "${column.id}" cannot be used for ${usage} in SQL`, { columnId: column.id, usage });
    }
    throw e;
  }
}

function resolvePaging(query: GridQuery, fingerprint: string): { limit: number; offset: number } {
  const page = query.page;
  if (typeof page.cursor === "string" && page.cursor !== "") {
    const payload = decodeCursor(page.cursor);
    assertCursorMatches(payload, fingerprint);
    if (payload.mode !== "offset") throw new CursorError("Grouping queries only accept offset cursors");
    return offsetClause({ limit: page.limit, offset: payload.offset ?? 0 });
  }
  return offsetClause({ limit: page.limit, offset: page.offset });
}

function aggregateSql(
  spec: { columnId: string; agg: AggregationId },
  scope: GridSqlScope,
): { sql: SQL; valueKind: AggValueKind } {
  const column = findColumn(scope, spec.columnId);
  if (!getColumnAggregations(column, scope.ctx.registry).includes(spec.agg)) {
    throw new GroupingError(`Aggregation "${spec.agg}" is not allowed for column "${column.id}" (${column.type})`, {
      columnId: column.id,
      agg: spec.agg,
    });
  }
  if (spec.agg === "count") return { sql: sql`COUNT(*)`, valueKind: "number" };
  const expr = exprFor(column, scope, "aggregate");
  const notAllowed = () =>
    new GroupingError(`Aggregation "${spec.agg}" is not supported on ${expr.kind} storage (column "${column.id}")`, {
      columnId: column.id,
      agg: spec.agg,
    });
  switch (spec.agg) {
    case "countEmpty":
      return { sql: sql`SUM(CASE WHEN ${expr.empty} THEN 1 ELSE 0 END)`, valueKind: "number" };
    case "countFilled":
      return { sql: sql`SUM(CASE WHEN ${expr.empty} THEN 0 ELSE 1 END)`, valueKind: "number" };
    case "sum":
    case "avg": {
      if (expr.kind !== "number") throw notAllowed();
      const fn = sql.raw(spec.agg === "sum" ? "SUM" : "AVG");
      return { sql: sql`${fn}(${expr.typed})`, valueKind: "number" };
    }
    case "min":
    case "max": {
      const fn = sql.raw(spec.agg === "min" ? "MIN" : "MAX");
      if (expr.kind === "number") return { sql: sql`${fn}(${expr.typed})`, valueKind: "number" };
      if (expr.kind === "date") {
        return { sql: sql`DATE_FORMAT(${fn}(${expr.typed}), ${sql.raw(`'${DATE_FORMAT}'`)})`, valueKind: "date" };
      }
      if (expr.kind === "datetime") {
        return {
          sql: sql`DATE_FORMAT(${fn}(${expr.typed}), ${sql.raw(`'${DATETIME_FORMAT}'`)})`,
          valueKind: "datetime",
        };
      }
      throw notAllowed();
    }
    default:
      throw new GroupingError(`Unknown aggregation "${String(spec.agg)}"`, { columnId: column.id, agg: spec.agg });
  }
}

/**
 * GridQuery → one level of GROUP BY over `groupBy[0]` (child levels are fetched
 * lazily with `pinGroupFilter`).
 *
 * - Permissions/filter validity are checked FIRST (`assertQueryAccess`).
 * - WHERE: `grid_id`, `deleted_at IS NULL`, filter, search.
 * - The group key is `CASE WHEN <empty> THEN NULL ELSE <typed> END`, so every
 *   empty form (absent, JSON null, `''`) collapses into ONE group with value
 *   `null`, which always sorts last. Date keys are formatted `YYYY-MM-DD`.
 *   Text keys use the case-insensitive collation, matching the `is` pin filter.
 * - Groups are ordered by key ASC, or DESC when `query.sort` sorts the group
 *   column descending, and paged by offset (offset-mode cursors only).
 * - `includeTotal` counts groups: `COUNT(DISTINCT key)` + 1 if any row is empty.
 *
 * Throws `GroupingError` for a missing groupBy, a non-groupable column
 * (multi / link / json / datetime / longText / fallback formula) or an
 * aggregation the column's field type does not allow.
 */
export function buildGroupQuery(
  query: GridQuery,
  scope: GridSqlScope,
  db: SelectCapableDb,
  access?: AccessMap,
): BuiltGroupQuery {
  const resolvedAccess = access ?? resolveAccess(scope.ctx);
  assertQueryAccess(query, scope.ctx, resolvedAccess);

  const spec = query.groupBy?.[0];
  if (!spec) throw new GroupingError("buildGroupQuery needs at least one groupBy level");

  const formulaPlans = scope.formulaPlans ?? planFormulaColumns(scope);
  const planned: GridSqlScope = { ...scope, formulaPlans };

  const column = findColumn(planned, spec.columnId);
  if (UNGROUPABLE_TYPES.has(column.type)) {
    throw new GroupingError(`Cannot group by ${column.type} column "${column.id}"`, { columnId: column.id });
  }
  const expr = exprFor(column, planned, "groupBy");
  if (!GROUPABLE_KINDS.has(expr.kind)) {
    throw new GroupingError(`Cannot group by ${expr.kind} column "${column.id}"`, { columnId: column.id, kind: expr.kind });
  }

  const nullable = sql`(CASE WHEN ${expr.empty} THEN NULL ELSE ${expr.typed} END)`;
  const keyExpr = expr.kind === "date" ? sql`DATE_FORMAT(${nullable}, ${sql.raw(`'${DATE_FORMAT}'`)})` : nullable;

  const aggregations: PlannedAggregation[] = [];
  const fields: Record<string, SQL.Aliased> = {
    [KEY]: sql`${keyExpr}`.as(KEY),
    [EMPTY]: sql<number>`MAX(CASE WHEN ${expr.empty} THEN 1 ELSE 0 END)`.as(EMPTY),
    [COUNT]: sql<number>`COUNT(*)`.as(COUNT),
  };
  (spec.aggregations ?? []).forEach((a, i) => {
    const built = aggregateSql(a, planned);
    aggregations.push({ columnId: a.columnId, agg: a.agg, valueKind: built.valueKind });
    fields[aggAlias(i)] = built.sql.as(aggAlias(i));
  });

  const fingerprint = queryFingerprint(query, scope.ctx.schema.schemaVersion);
  const paging = resolvePaging(query, fingerprint);

  const rows = planned.tables.rows;
  const where = and(
    eq(rows.gridId, planned.gridId),
    isNull(rows.deletedAt),
    translateFilter(query.filter, planned),
    translateSearch(query.search, resolvedAccess, planned),
  );
  const desc = (query.sort ?? []).some((s) => s.columnId === column.id && s.dir === "desc");

  let select = db
    .select(fields)
    .from(rows)
    .where(where)
    .groupBy(sql`${sql.identifier(KEY)}`)
    .orderBy(sql`${sql.identifier(EMPTY)} ASC`, sql`${sql.identifier(KEY)} ${sql.raw(desc ? "DESC" : "ASC")}`)
    .limit(paging.limit + 1);
  if (paging.offset > 0) select = select.offset(paging.offset);

  const built: BuiltGroupQuery = {
    select: select as SelectStatement<GroupDbRow>,
    columnId: column.id,
    kind: expr.kind,
    aggregations,
    limit: paging.limit,
    offset: paging.offset,
    fingerprint,
    access: resolvedAccess,
  };
  if (query.includeTotal) {
    built.count = db
      .select({
        total: sql<number>`COUNT(DISTINCT ${keyExpr}) + COALESCE(MAX(CASE WHEN ${expr.empty} THEN 1 ELSE 0 END), 0)`,
      })
      .from(rows)
      .where(where) as SelectStatement<{ total: number | string }>;
  }
  return built;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

function toDateString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  return String(v);
}

function toDatetimeString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  // DATE_FORMAT's %f is microseconds; stored datetimes carry milliseconds.
  return String(v).replace(/(\.\d{3})\d*Z$/, "$1Z");
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function groupValue(raw: unknown, kind: StorageKind): unknown {
  if (raw === null || raw === undefined) return null;
  switch (kind) {
    case "number":
      return toNumber(raw);
    case "boolean":
      return raw === true || raw === 1 || raw === "1" || raw === "true";
    case "date":
      return toDateString(raw);
    default:
      return String(raw);
  }
}

function aggregateValue(raw: unknown, a: PlannedAggregation): GroupAggregateValue["value"] {
  if (a.agg === "count" || a.agg === "countEmpty" || a.agg === "countFilled") return toNumber(raw) ?? 0;
  if (a.valueKind === "date") return toDateString(raw);
  if (a.valueKind === "datetime") return toDatetimeString(raw);
  return toNumber(raw);
}

/**
 * Runs a `BuiltGroupQuery` and shapes the result as core `GroupResult[]`
 * (`rows` is always empty). `key` is `JSON.stringify(value)`; the empty group
 * has value `null`. DECIMAL values (MySQL returns them as strings) become
 * numbers; date min/max are `YYYY-MM-DD`, datetime min/max UTC ISO strings.
 */
export async function executeGroupQuery(built: BuiltGroupQuery, _scope: GridSqlScope): Promise<QueryResult<GridRow>> {
  const [dbRows, countRows] = await Promise.all([built.select, built.count]);
  const { rows: page, hasMore } = trimPage(dbRows, built.limit);

  const groups: GroupResult[] = page.map((r) => {
    const empty = toNumber(r[EMPTY]) === 1;
    const value = empty ? null : groupValue(r[KEY], built.kind);
    return {
      columnId: built.columnId,
      value,
      key: JSON.stringify(value),
      count: toNumber(r[COUNT]) ?? 0,
      aggregates: built.aggregations.map((a, i) => ({
        columnId: a.columnId,
        agg: a.agg,
        value: aggregateValue(r[aggAlias(i)], a),
      })),
    };
  });

  const result: QueryResult<GridRow> = { rows: [], groups };
  if (hasMore) {
    result.nextCursor = encodeCursor({ v: 1, mode: "offset", fp: built.fingerprint, offset: built.offset + built.limit });
  }
  if (countRows) result.total = Number(countRows[0]?.total ?? 0);
  return result;
}
