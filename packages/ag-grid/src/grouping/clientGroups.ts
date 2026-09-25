/**
 * Pure client-side grouping transform: turns a (already sorted) list of rows
 * into a flat list of display rows interleaving group headers with data
 * rows, honouring the current expansion state.
 */
import type { AnyFieldType, ColumnDef, FieldTypeRegistry, GridRow, GridSchema, GroupSpec } from "../internal/core";
import { computeAggregate, effectiveFieldType, isEmptyValue } from "../internal/core";

export interface GroupPathEntry {
  columnId: string;
  key: unknown;
}

export interface GroupDisplayRow {
  __sg: "group";
  id: string;
  level: number;
  columnId: string;
  key: unknown;
  label: string;
  count: number;
  aggregates: Record<string, unknown>;
  expanded: boolean;
  groupPath: GroupPathEntry[];
}

export interface LoadMoreDisplayRow {
  __sg: "loadMore";
  id: string;
  groupPath: GroupPathEntry[];
  loaded: number;
  total: number;
}

export type DisplayRow<Row> = Row | GroupDisplayRow | LoadMoreDisplayRow;

export function isGroupRow<Row>(row: DisplayRow<Row>): row is GroupDisplayRow {
  return typeof row === "object" && row !== null && (row as { __sg?: unknown }).__sg === "group";
}

export function isLoadMoreRow<Row>(row: DisplayRow<Row>): row is LoadMoreDisplayRow {
  return typeof row === "object" && row !== null && (row as { __sg?: unknown }).__sg === "loadMore";
}

export function isDataRow<Row>(row: DisplayRow<Row>): row is Row {
  return !isGroupRow(row) && !isLoadMoreRow(row);
}

export interface ExpansionLike {
  isExpanded(id: string): boolean;
}

export interface BuildClientGroupsContext {
  schema: GridSchema;
  registry: FieldTypeRegistry;
  getCellValue?(row: GridRow, column: ColumnDef): unknown;
}

const EMPTY_DEDUP_KEY = "\u0000__empty__";
const EMPTY_LABEL = "(empty)";

interface Bucket<Row> {
  key: unknown;
  dedupKey: string;
  label: string;
  rows: Row[];
}

function readGroupValue(row: GridRow, column: ColumnDef, ctx: BuildClientGroupsContext): unknown {
  return ctx.getCellValue ? ctx.getCellValue(row, column) : row.cells[column.key];
}

function refId(v: unknown): string {
  if (v && typeof v === "object" && "id" in v) return String((v as { id: unknown }).id);
  return String(v);
}

function bucketOf<Row extends GridRow>(
  raw: unknown,
  column: ColumnDef,
  fieldType: AnyFieldType | undefined,
): { key: unknown; dedupKey: string; label: string } {
  if (isEmptyValue(raw)) {
    return { key: null, dedupKey: EMPTY_DEDUP_KEY, label: EMPTY_LABEL };
  }
  const config = column.config ?? fieldType?.defaultConfig;
  if (fieldType?.id === "multiSelect") {
    const formatted = fieldType.format(raw, config);
    return { key: raw, dedupKey: `ms:${formatted}`, label: formatted };
  }
  if (fieldType?.id === "link") {
    // core link values are `LinkRef[]`; bucket by the joined ids.
    const refs = Array.isArray(raw) ? raw : [raw];
    const ids = refs.map(refId).join(",");
    return { key: raw, dedupKey: `link:${ids}`, label: fieldType.format(Array.isArray(raw) ? raw : [raw], config) };
  }
  if (fieldType?.id === "user") {
    // core user values are `UserRef {id, name?}`; bucket by id.
    return { key: raw, dedupKey: `user:${refId(raw)}`, label: fieldType.format(raw, config) };
  }
  if (fieldType) {
    return { key: raw, dedupKey: `v:${String(raw)}`, label: fieldType.format(raw, config) };
  }
  return { key: raw, dedupKey: `v:${String(raw)}`, label: String(raw) };
}

function bucketRows<Row extends GridRow>(
  rows: Row[],
  column: ColumnDef,
  fieldType: AnyFieldType | undefined,
  ctx: BuildClientGroupsContext,
): Bucket<Row>[] {
  const buckets: Bucket<Row>[] = [];
  const index = new Map<string, Bucket<Row>>();
  for (const row of rows) {
    const raw = readGroupValue(row, column, ctx);
    const { key, dedupKey, label } = bucketOf<Row>(raw, column, fieldType);
    let bucket = index.get(dedupKey);
    if (!bucket) {
      bucket = { key, dedupKey, label, rows: [] };
      index.set(dedupKey, bucket);
      buckets.push(bucket);
    }
    bucket.rows.push(row);
  }
  return buckets;
}

function groupIdFromIdPath(idPath: [string, string][]): string {
  return `__sg_group:${JSON.stringify(idPath)}`;
}

function buildLevel<Row extends GridRow>(
  rows: Row[],
  level: number,
  groupPath: GroupPathEntry[],
  idPath: [string, string][],
  groupBy: GroupSpec[],
  columnsById: Map<string, ColumnDef>,
  expansion: ExpansionLike,
  ctx: BuildClientGroupsContext,
): DisplayRow<Row>[] {
  const spec = groupBy[level];
  if (!spec) return rows;
  const column = columnsById.get(spec.columnId);
  if (!column) return rows;
  const fieldType = effectiveFieldType(ctx.registry, column);
  const buckets = bucketRows(rows, column, fieldType, ctx);

  const out: DisplayRow<Row>[] = [];
  for (const bucket of buckets) {
    const nextGroupPath: GroupPathEntry[] = [...groupPath, { columnId: spec.columnId, key: bucket.key }];
    const nextIdPath: [string, string][] = [...idPath, [spec.columnId, bucket.dedupKey]];
    const id = groupIdFromIdPath(nextIdPath);

    const aggregates: Record<string, unknown> = {};
    for (const aggSpec of spec.aggregations ?? []) {
      const aggColumn = columnsById.get(aggSpec.columnId);
      if (!aggColumn) continue;
      const values = bucket.rows.map((r) => readGroupValue(r, aggColumn, ctx));
      const aggType = effectiveFieldType(ctx.registry, aggColumn) ?? ctx.registry.get("text");
      if (!aggType) continue;
      // Formula columns aggregate through their result type (its default config).
      const aggConfig = aggColumn.type === "formula" ? aggType.defaultConfig : (aggColumn.config ?? aggType.defaultConfig);
      aggregates[`${aggSpec.columnId}:${aggSpec.agg}`] = computeAggregate(aggSpec.agg, values, aggType, aggConfig);
    }

    const expanded = expansion.isExpanded(id);

    out.push({
      __sg: "group",
      id,
      level,
      columnId: spec.columnId,
      key: bucket.key,
      label: bucket.label,
      count: bucket.rows.length,
      aggregates,
      expanded,
      groupPath: nextGroupPath,
    });

    if (expanded) {
      if (level + 1 < groupBy.length) {
        out.push(...buildLevel(bucket.rows, level + 1, nextGroupPath, nextIdPath, groupBy, columnsById, expansion, ctx));
      } else {
        out.push(...bucket.rows);
      }
    }
  }
  return out;
}

/**
 * Groups already-sorted rows according to `groupBy`, honouring `expansion`
 * for which groups reveal their descendants. Group order follows the
 * first-appearance order of each bucket within `sortedRows`.
 */
export function buildClientGroups<Row extends GridRow>(
  sortedRows: Row[],
  groupBy: GroupSpec[],
  expansion: ExpansionLike,
  ctx: BuildClientGroupsContext,
): DisplayRow<Row>[] {
  if (groupBy.length === 0) return [...sortedRows];
  const columnsById = new Map(ctx.schema.columns.map((c) => [c.id, c]));
  return buildLevel(sortedRows, 0, [], [], groupBy, columnsById, expansion, ctx);
}
