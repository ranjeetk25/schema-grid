/**
 * CSV export of the current grid view via AG Grid's built-in `exportDataAsCsv`.
 * Only displayed columns the current user may read or edit are exported;
 * hidden/unknown-access columns and group/full-width rows are skipped.
 */
import type { CsvExportParams, GridApi, ProcessCellForExportParams, ShouldRowBeSkippedParams } from "ag-grid-community";
import { type DisplayRow, isDataRow } from "../grouping/clientGroups";
import type { Access, ColumnDef, FieldTypeRegistry, GridRow, GridSchema } from "../internal/core";
import { resolveExportFormat, type UiFieldTypeRegistry } from "../compile/uiRegistry";

export interface ExportCsvOptions<Row extends GridRow> {
  schema: GridSchema;
  access: Map<string, Access>;
  registry: FieldTypeRegistry;
  uiRegistry: UiFieldTypeRegistry<Row>;
  fileName?: string;
  /** Override cell reads (e.g. computed formula values). */
  getCellValue?(row: Row, column: ColumnDef): unknown;
}

/**
 * Exports the grid's currently displayed rows/columns to CSV.
 * `columnKeys` are the displayed columns whose schema access is "read" or
 * "edit" — hidden and unknown-access columns are never exported. Group and
 * full-width rows are skipped via `shouldRowBeSkipped`.
 */
export function exportCsv<Row extends GridRow>(
  api: Pick<GridApi<Row>, "exportDataAsCsv" | "getAllDisplayedColumns">,
  opts: ExportCsvOptions<Row>,
): void {
  const columnById = new Map(opts.schema.columns.map((c) => [c.id, c]));

  const columnKeys = api
    .getAllDisplayedColumns()
    .map((col) => col.getColId())
    .filter((colId) => {
      if (!columnById.has(colId)) return false;
      const access = opts.access.get(colId);
      return access === "read" || access === "edit";
    });

  const processCellCallback = (params: ProcessCellForExportParams<Row>): string => {
    const colId = params.column.getColId();
    const column = columnById.get(colId);
    if (!column) return params.value == null ? "" : String(params.value);
    const fieldType = opts.registry.get(column.type);
    const entry = opts.uiRegistry.get(column.type);
    const data = params.node?.data;
    const value = opts.getCellValue && data ? opts.getCellValue(data, column) : params.value;
    return resolveExportFormat(entry, value, column, fieldType);
  };

  const shouldRowBeSkipped = (params: ShouldRowBeSkippedParams<Row>): boolean =>
    !isDataRow(params.node.data as DisplayRow<Row>);

  const csvParams: CsvExportParams = {
    columnKeys,
    fileName: opts.fileName,
    processCellCallback,
    shouldRowBeSkipped,
    skipColumnGroupHeaders: true,
  };

  api.exportDataAsCsv(csvParams);
}
