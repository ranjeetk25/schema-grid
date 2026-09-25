/**
 * Plans a fill-handle drag: pure, given a source range (already selected)
 * and a target range (the full extended range including the source),
 * produces changes for every target cell outside the source.
 *
 * Down-fill: each column's source values (read top-to-bottom over the
 * source rows) are extended down that same column, one series per column.
 *
 * Right-fill: each row's source values (read left-to-right over the source
 * columns) are extended right across that same row. Because a right-fill
 * can cross columns of different field types, each target column receives
 * the SOURCE value formatted with the source column's field type and then
 * re-parsed with the target column's field type (format -> parse), rather
 * than the raw in-memory value. `fillSeries` (when used) still operates on
 * the source column's native values; only the value handed to a *different*
 * target column goes through format/parse.
 */
import type { CellChange, ColumnDef, FieldTypeRegistry, GridRow } from "../internal/core";
import { effectiveFieldType, isEmptyValue } from "../internal/core";
import type { NormalizedRange } from "../range/geometry";
import type { DisplayRow } from "../grouping/clientGroups";
import { isDataRow } from "../grouping/clientGroups";

export interface FillPlanResult {
  changes: CellChange[];
  skippedReadOnly: number;
}

export interface PlanFillOptions<Row extends GridRow> {
  source: NormalizedRange;
  target: NormalizedRange;
  axis: "down" | "right";
  getRowAt: (rowIndex: number) => DisplayRow<Row> | undefined;
  columnsById: Map<string, ColumnDef>;
  registry: FieldTypeRegistry;
  canEditCell(row: Row, columnId: string): boolean;
  getCellValue?(row: Row, column: ColumnDef): unknown;
}

function readCellValue<Row extends GridRow>(row: Row, column: ColumnDef, getCellValue?: (row: Row, column: ColumnDef) => unknown): unknown {
  return getCellValue ? getCellValue(row, column) : row.cells[column.key];
}

/**
 * Extends `values` (read in source order) to `count` new values, using the
 * field type's `fillSeries` when at least two non-empty source values are
 * present; otherwise repeats the (non-empty) values cyclically. Returns an
 * empty array when there are no usable source values at all.
 */
function extendValues(values: unknown[], count: number, fieldType: ReturnType<FieldTypeRegistry["get"]>): unknown[] {
  const nonEmpty = values.filter((v) => !isEmptyValue(v));
  if (nonEmpty.length === 0) return Array.from({ length: count }, () => null);

  if (fieldType?.fillSeries && nonEmpty.length >= 2) {
    return fieldType.fillSeries(nonEmpty as never[], count) as unknown[];
  }

  return Array.from({ length: count }, (_, i) => nonEmpty[i % nonEmpty.length]);
}

function rowsInRange<Row extends GridRow>(range: NormalizedRange, getRowAt: (rowIndex: number) => DisplayRow<Row> | undefined): Row[] {
  const rows: Row[] = [];
  for (let rowIndex = range.rowStart; rowIndex <= range.rowEnd; rowIndex++) {
    const displayRow = getRowAt(rowIndex);
    if (displayRow !== undefined && isDataRow(displayRow)) rows.push(displayRow);
  }
  return rows;
}

function inSource(rowIndex: number, colId: string, source: NormalizedRange): boolean {
  return rowIndex >= source.rowStart && rowIndex <= source.rowEnd && source.colIds.includes(colId);
}

function planDown<Row extends GridRow>(options: PlanFillOptions<Row>): FillPlanResult {
  const { source, target, getRowAt, columnsById, registry, canEditCell, getCellValue } = options;
  const changes: CellChange[] = [];
  let skippedReadOnly = 0;

  const targetRowIndices: number[] = [];
  for (let r = target.rowStart; r <= target.rowEnd; r++) targetRowIndices.push(r);
  const extraCount = targetRowIndices.filter((r) => r < source.rowStart || r > source.rowEnd).length;

  for (const colId of target.colIds) {
    const column = columnsById.get(colId);
    if (!column) continue;
    const fieldType = effectiveFieldType(registry, column);

    const sourceValues = rowsInRange({ rowStart: source.rowStart, rowEnd: source.rowEnd, colIds: [colId] }, getRowAt).map((row) =>
      readCellValue(row, column, getCellValue),
    );

    const extended = extendValues(sourceValues, extraCount, fieldType);
    let extendedIdx = 0;

    for (const rowIndex of targetRowIndices) {
      if (inSource(rowIndex, colId, source)) continue;
      const displayRow = getRowAt(rowIndex);
      const nextValue = extended[extendedIdx];
      extendedIdx++;
      if (displayRow === undefined || !isDataRow(displayRow)) continue;
      const row = displayRow;

      if (column.type === "formula" || !canEditCell(row, colId)) {
        skippedReadOnly++;
        continue;
      }

      const prev = readCellValue(row, column, getCellValue);
      changes.push({ rowId: row.id, columnId: colId, prev, next: nextValue });
    }
  }

  return { changes, skippedReadOnly };
}

function planRight<Row extends GridRow>(options: PlanFillOptions<Row>): FillPlanResult {
  const { source, target, getRowAt, columnsById, registry, canEditCell, getCellValue } = options;
  const changes: CellChange[] = [];
  let skippedReadOnly = 0;

  const extraCount = target.colIds.filter((c) => !source.colIds.includes(c)).length;

  for (let rowIndex = target.rowStart; rowIndex <= target.rowEnd; rowIndex++) {
    const displayRow = getRowAt(rowIndex);
    if (displayRow === undefined || !isDataRow(displayRow)) continue;
    const row = displayRow;

    const sourceColumns = source.colIds.map((id) => columnsById.get(id)).filter((c): c is ColumnDef => !!c);
    // Use the last source column's field type to decide fillSeries eligibility
    // and to format values for cross-column re-parsing.
    const lastSourceColumn = sourceColumns[sourceColumns.length - 1];
    const lastSourceFieldType = lastSourceColumn ? effectiveFieldType(registry, lastSourceColumn) : undefined;

    const sourceValues = sourceColumns.map((col) => readCellValue(row, col, getCellValue));
    const extended = extendValues(sourceValues, extraCount, lastSourceFieldType);
    let extendedIdx = 0;

    for (const colId of target.colIds) {
      if (source.colIds.includes(colId)) continue;
      const column = columnsById.get(colId);
      const rawValue = extended[extendedIdx];
      extendedIdx++;
      if (!column) continue;

      if (column.type === "formula" || !canEditCell(row, colId)) {
        skippedReadOnly++;
        continue;
      }

      const targetFieldType = effectiveFieldType(registry, column);
      let nextValue: unknown = rawValue;
      if (targetFieldType && lastSourceFieldType && targetFieldType !== lastSourceFieldType) {
        const formatted = lastSourceFieldType.format(rawValue as never, lastSourceColumn?.config as never);
        const parsed = targetFieldType.parse(formatted, column.config ?? targetFieldType.defaultConfig);
        nextValue = parsed.ok ? parsed.value : null;
      }

      const prev = readCellValue(row, column, getCellValue);
      changes.push({ rowId: row.id, columnId: colId, prev, next: nextValue });
    }
  }

  return { changes, skippedReadOnly };
}

/** Plans a fill-handle drag along `axis`. See module docs for semantics. */
export function planFill<Row extends GridRow>(options: PlanFillOptions<Row>): FillPlanResult {
  return options.axis === "down" ? planDown(options) : planRight(options);
}
