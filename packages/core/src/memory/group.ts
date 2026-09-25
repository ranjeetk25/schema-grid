import { getColumnAggregations } from "../field-types/column-operators";
import { isEmptyValue } from "../field-types/empty";
import type { AnyFieldType } from "../field-types/types";
import { computeAggregate } from "../query/aggregate";
import type { GroupAggregateValue, GroupResult, GroupSpec } from "../query/types";
import type { GridRow } from "../rows/types";
import type { ColumnDef } from "../schema/types";
import { type MemoryQueryContext, requireReadableColumn } from "./query";
import { InMemoryQueryError } from "./types";

const EMPTY_KEY = "∅";

interface ResolvedAgg {
  column: ColumnDef;
  type: AnyFieldType | undefined;
  agg: GroupAggregateValue["agg"];
}

interface ResolvedLevel {
  column: ColumnDef;
  type: AnyFieldType | undefined;
  aggs: ResolvedAgg[];
}

function resolveLevels(groupBy: GroupSpec[], ctx: MemoryQueryContext): ResolvedLevel[] {
  return groupBy.map((spec) => {
    const column = requireReadableColumn(spec.columnId, ctx, "group");
    const aggs = (spec.aggregations ?? []).map(({ columnId, agg }) => {
      const target = requireReadableColumn(columnId, ctx, "aggregate");
      if (!getColumnAggregations(target, ctx.registry).includes(agg)) {
        throw new InMemoryQueryError(
          "invalidAggregation",
          `Aggregation "${agg}" is not allowed on this column`,
        );
      }
      return { column: target, type: ctx.registry.get(target.type), agg };
    });
    return { column, type: ctx.registry.get(column.type), aggs };
  });
}

function groupKey(value: unknown, type: AnyFieldType | undefined): string {
  if (isEmptyValue(value)) return EMPTY_KEY;
  try {
    return JSON.stringify(type ? type.serialize(value) : value) ?? EMPTY_KEY;
  } catch {
    return String(value);
  }
}

function build(rows: GridRow[], levels: ResolvedLevel[], depth: number): GroupResult[] {
  const level = levels[depth];
  if (!level) return [];
  const { column, type } = level;
  const buckets = new Map<string, { value: unknown; rows: GridRow[] }>();
  for (const row of rows) {
    const value = row.cells[column.key];
    const key = groupKey(value, type);
    const bucket = buckets.get(key);
    if (bucket) bucket.rows.push(row);
    else buckets.set(key, { value: isEmptyValue(value) ? null : value, rows: [row] });
  }
  const entries = [...buckets.entries()].sort(([ka, a], [kb, b]) => {
    if (ka === EMPTY_KEY || kb === EMPTY_KEY) return ka === kb ? 0 : ka === EMPTY_KEY ? 1 : -1;
    let c = 0;
    try {
      c = type ? type.compare(a.value, b.value, column.config) : 0;
    } catch {
      c = 0;
    }
    return c !== 0 ? c : ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return entries.map(([key, bucket]) => {
    const aggregates: GroupAggregateValue[] = level.aggs.map(({ column: target, type: t, agg }) => ({
      columnId: target.id,
      agg,
      value: t
        ? computeAggregate(agg, bucket.rows.map((r) => r.cells[target.key]), t, target.config)
        : null,
    }));
    const group: GroupResult = {
      columnId: column.id,
      value: structuredClone(bucket.value),
      key,
      count: bucket.rows.length,
      aggregates,
    };
    if (depth + 1 < levels.length) group.children = build(bucket.rows, levels, depth + 1);
    return group;
  });
}

/**
 * Groups (already filtered and searched) rows by the given specs. Aggregates
 * are computed over every row in each group, not just the current page.
 * Throws InMemoryQueryError for unreadable columns or disallowed aggregations.
 */
export function groupRows(rows: GridRow[], groupBy: GroupSpec[], ctx: MemoryQueryContext): GroupResult[] {
  if (groupBy.length === 0) return [];
  return build(rows, resolveLevels(groupBy, ctx), 0);
}
