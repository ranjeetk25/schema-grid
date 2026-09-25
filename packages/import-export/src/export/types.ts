import type {
  Access,
  ColumnDef,
  FieldTypeRegistry,
  GridRow,
} from "../internal/core";

export type ExportFormat = "csv" | "xlsx";

export interface ExportOptions {
  /** Columns to export, in order. Every one must be readable in `access`. */
  columns: ColumnDef[];
  registry: FieldTypeRegistry;
  rows: AsyncIterable<GridRow> | GridRow[];
  format: ExportFormat;
  /** Time zone datetimes are written in (XLSX wall clock). */
  tz: string;
  fileName: string;
  /** Fail-closed: a column that is "hidden" or missing throws HiddenColumnError. */
  access: ReadonlyMap<string, Access>;
  sheetName?: string;
}

export interface ExcelCell {
  value:
    | string
    | number
    | boolean
    | Date
    | { text: string; hyperlink: string }
    | null;
  numFmt?: string;
}
