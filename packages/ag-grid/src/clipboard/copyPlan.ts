/**
 * Builds the TSV clipboard payload for a copied range. Pure: takes a row
 * lookup and column/access maps rather than talking to the grid directly.
 */
import type { Access, ColumnDef, FieldTypeRegistry, GridRow } from "../internal/core";
import { effectiveFieldType } from "../internal/core";
import type { NormalizedRange } from "../range/geometry";
import type { DisplayRow } from "../grouping/clientGroups";
import { isDataRow } from "../grouping/clientGroups";
import { serializeTsv } from "./tsv";

export interface BuildCopyOptions<Row extends GridRow> {
  /** Reads a computed value (e.g. a formula result) instead of `row.cells[key]`. */
  getCellValue?(row: Row, column: ColumnDef): unknown;
}

/**
 * Builds the copy matrix for `range`: one row per row index in range, one
 * cell per displayed column that isn't hidden. Non-data rows (group and
 * load-more display rows) are skipped and contribute no row to the matrix.
 */
export function buildCopyMatrix<Row extends GridRow>(
  range: NormalizedRange,
  getRowAt: (rowIndex: number) => DisplayRow<Row> | undefined,
  columnsById: Map<string, ColumnDef>,
  registry: FieldTypeRegistry,
  access: Map<string, Access>,
  options: BuildCopyOptions<Row> = {},
): string[][] {
  const colIds = range.colIds.filter((colId) => {
    const columnAccess = access.get(colId);
    return columnAccess !== undefined && columnAccess !== "hidden";
  });

  const matrix: string[][] = [];
  for (let rowIndex = range.rowStart; rowIndex <= range.rowEnd; rowIndex++) {
    const displayRow = getRowAt(rowIndex);
    if (displayRow === undefined || !isDataRow(displayRow)) continue;
    const row = displayRow;

    const line: string[] = [];
    for (const colId of colIds) {
      const column = columnsById.get(colId);
      if (!column) {
        line.push("");
        continue;
      }
      const fieldType = effectiveFieldType(registry, column);
      const value = options.getCellValue ? options.getCellValue(row, column) : row.cells[column.key];
      line.push(fieldType ? fieldType.format(value as never, (column.config ?? fieldType.defaultConfig) as never) : String(value ?? ""));
    }
    matrix.push(line);
  }
  return matrix;
}

/** Builds the TSV text for `range`. See {@link buildCopyMatrix}. */
export function buildCopyText<Row extends GridRow>(
  range: NormalizedRange,
  getRowAt: (rowIndex: number) => DisplayRow<Row> | undefined,
  columnsById: Map<string, ColumnDef>,
  registry: FieldTypeRegistry,
  access: Map<string, Access>,
  options: BuildCopyOptions<Row> = {},
): string {
  return serializeTsv(buildCopyMatrix(range, getRowAt, columnsById, registry, access, options));
}
