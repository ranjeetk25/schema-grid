import { assertNoHiddenColumns } from "../internal/access";
import type {
  Access,
  ColumnDef,
  FieldTypeRegistry,
  GridRow,
} from "../internal/core";
import { formatMatrixForClipboard } from "./tsv";

export interface FormatForClipboardOptions {
  access?: ReadonlyMap<string, Access>;
  includeHeaders?: boolean;
}

/**
 * Builds clipboard TSV text for a set of rows/columns using each column's
 * field type `format`. Falls back to `String(value)` (or "" for
 * null/undefined) when the column's type isn't registered.
 */
export function formatForClipboard(
  rows: GridRow[],
  columns: ColumnDef[],
  registry: FieldTypeRegistry,
  opts: FormatForClipboardOptions = {},
): string {
  if (opts.access) assertNoHiddenColumns(columns, opts.access);

  const matrix: string[][] = [];
  if (opts.includeHeaders) {
    matrix.push(columns.map((c) => c.label));
  }

  for (const row of rows) {
    matrix.push(
      columns.map((column) => formatCellValue(row, column, registry)),
    );
  }

  return formatMatrixForClipboard(matrix);
}

function formatCellValue(
  row: GridRow,
  column: ColumnDef,
  registry: FieldTypeRegistry,
): string {
  const value = row.cells[column.key];
  const type = registry.get(column.type);
  if (!type) {
    return value === null || value === undefined ? "" : String(value);
  }
  return type.format(value, column.config);
}
