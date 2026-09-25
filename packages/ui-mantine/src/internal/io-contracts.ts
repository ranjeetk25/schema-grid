/**
 * import-export adapter. The ONLY file in ui-mantine that imports
 * `@ranjeetk25/schema-grid-io`. Functions and types are re-exported from the real
 * package; a few UI-only types and gaps are defined locally at the bottom.
 */
import {
  autoMapColumns,
  parseFile,
  validateRows,
  type ValidateRowsOptions,
} from "@ranjeetk25/schema-grid-io/import";

// Import pipeline (browser preview + server job share these)
export {
  ImportConfigError,
  KEY_COLUMN_TYPES,
  SheetNotFoundError,
  autoMapColumns,
  buildErrorReportCsv,
  createImportJobState,
  keyOf,
  parseFile,
  toChangeBatches,
  validateRows,
} from "@ranjeetk25/schema-grid-io/import";
export type {
  AutoMapColumnsOptions,
  CellErrorKind,
  CellValidation,
  ColumnMapping,
  ImportJobState,
  ImportMode,
  ImportPlan as IoImportPlan,
  ImportRowError,
  ParsedTable,
  ParseFileOptions,
  RowValidation,
  ValidateRowsOptions,
  ValidationReport,
} from "@ranjeetk25/schema-grid-io/import";

// Export
export { HiddenColumnError, buildExport, buildExportBlob, exportFileName } from "@ranjeetk25/schema-grid-io/export";
export type { ExportFormat, ExportOptions } from "@ranjeetk25/schema-grid-io/export";

// ---------------------------------------------------------------------------
// Local (UI-only types and gaps in io's public API)
// ---------------------------------------------------------------------------

/** How unknown select values are treated: io's `ValidateRowsOptions.unknownOptions`. */
export type UnknownOptionsPolicy = ValidateRowsOptions["unknownOptions"];

/**
 * Server-side job progress shown by the wizard's run step. The job runner
 * owns the real `ImportJobState`; hosts map it to this display shape.
 */
export interface ImportJobStatus {
  state: "queued" | "running" | "done" | "failed";
  processed: number;
  total: number;
  errorCount: number;
  errorReportUrl?: string;
}

/** The io functions the import wizard calls; injectable for tests and server-mode hosts. */
export interface IoFunctions {
  parseFile: typeof parseFile;
  autoMapColumns: typeof autoMapColumns;
  validateRows: typeof validateRows;
}

export const defaultIo: IoFunctions = { parseFile, autoMapColumns, validateRows };
