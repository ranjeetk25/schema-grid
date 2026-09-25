/**
 * import-export adapter. The ONLY file in ui-mantine allowed to import from
 * `@masai/schema-grid-io`.
 *
 * `@masai/schema-grid-io` is being built concurrently and currently only
 * exports a placeholder, so each symbol is a local fallback marked
 * `TODO(io)`. The fallback functions throw; components accept injected
 * implementations (the `io` prop) so tests and early consumers never hit them.
 */
import type { ColumnDef, FieldTypeRegistry, GridSchema } from "./core-contracts";

// ---------------------------------------------------------------------------
// Types
// TODO(io): replace with real export — ParsedFile, ColumnMapping, RowValidationResult,
// CellValidationError, ImportJobStatus, ImportMode, UnknownEnumPolicy, ExportFormat
// ---------------------------------------------------------------------------

export interface ParsedFile {
  fileName: string;
  headers: string[];
  /** Raw cell text, aligned with `headers`. */
  rows: string[][];
  sheetName?: string;
}

/** Source header → target column id, or null for "Skip". */
export type ColumnMapping = Record<string, string | null>;

export interface CellValidationError {
  columnId: string;
  message: string;
  /** "unknownEnum" marks a select value that is not a configured option. */
  kind?: "invalid" | "unknownEnum" | "required";
  value?: string;
}

export interface RowValidationResult {
  /** 0-based index into `ParsedFile.rows`. */
  rowIndex: number;
  values: Record<string, unknown>;
  errors: CellValidationError[];
}

export type ImportMode = "create" | "update" | "upsert";
export type UnknownEnumPolicy = "createOptions" | "rejectRows";
export type ExportFormat = "csv" | "xlsx";

export interface ImportJobStatus {
  state: "queued" | "running" | "done" | "failed";
  processed: number;
  total: number;
  errorCount: number;
  errorReportUrl?: string;
}

export interface ValidateRowsInput {
  rows: string[][];
  headers: string[];
  mapping: ColumnMapping;
  schema: GridSchema;
  registry: FieldTypeRegistry;
}

export interface BuildExportInput {
  format: ExportFormat;
  columns: ColumnDef[];
  rows: Record<string, unknown>[];
  registry: FieldTypeRegistry;
  fileName?: string;
}

export interface IoFunctions {
  parseFile(file: File | Blob, options?: { fileName?: string }): Promise<ParsedFile>;
  autoMapColumns(headers: string[], columns: ColumnDef[]): ColumnMapping;
  validateRows(input: ValidateRowsInput): RowValidationResult[] | Promise<RowValidationResult[]>;
  buildExport(input: BuildExportInput): Promise<Blob>;
}

// ---------------------------------------------------------------------------
// Functions
// TODO(io): replace with real export — parseFile, autoMapColumns, validateRows, buildExport
// ---------------------------------------------------------------------------

const unavailable = (name: string): never => {
  throw new Error(`@masai/schema-grid-io not available: ${name}() — inject an implementation via the \`io\` prop`);
};

export const parseFile: IoFunctions["parseFile"] = async () => unavailable("parseFile");
export const autoMapColumns: IoFunctions["autoMapColumns"] = () => unavailable("autoMapColumns");
export const validateRows: IoFunctions["validateRows"] = () => unavailable("validateRows");
export const buildExport: IoFunctions["buildExport"] = async () => unavailable("buildExport");

export const defaultIo: IoFunctions = { parseFile, autoMapColumns, validateRows, buildExport };
