import type { Access, ChangeBatch, GridRow } from "../internal/core";

/** A file read into a rectangular table of strings. */
export interface ParsedTable {
  headers: string[];
  /** Data rows, each padded/cut to `headers.length`. */
  rows: string[][];
  /** Every worksheet name (XLSX only). */
  sheetNames?: string[];
  /** True when more than `maxRows` data rows existed. */
  truncated: boolean;
  /** Detected delimiter (CSV only). */
  delimiter?: string;
  /** 1-based header row the table was shaped with (defaults to 1). */
  headerRow?: number;
}

export interface ParseFileOptions {
  type?: "csv" | "xlsx";
  /** XLSX sheet by name or 1-based index. Defaults to the first sheet. */
  sheet?: string | number;
  /** 1-based row holding the headers. Default 1. */
  headerRow?: number;
  maxRows?: number;
  /** Time zone XLSX wall-clock datetimes are read in. Default "UTC". */
  tz?: string;
}

export interface ColumnMapping {
  header: string;
  headerIndex: number;
  columnId: string | null;
  confidence: number;
}

export interface CellValidation {
  value: unknown;
  raw: string;
  error?: string;
  /** Update mode: the cell was empty and must be left unchanged. */
  skip?: boolean;
}

export interface RowValidation {
  /** 0-based index into ParsedTable.rows. */
  index: number;
  /** 1-based spreadsheet row number. */
  sourceRow: number;
  cells: Record<string, CellValidation>;
  rowError?: string;
}

export interface ValidationReport {
  rows: RowValidation[];
  summary: {
    valid: number;
    invalid: number;
    newOptions: Record<string, string[]>;
    unmappedRequired: string[];
  };
}

export type ImportMode = "create" | "update" | "upsert";

export interface ValidateRowsOptions {
  mode: ImportMode;
  keyColumnId?: string;
  unknownOptions: "create" | "reject";
  limit?: number;
  access?: ReadonlyMap<string, Access>;
}

export interface ImportRowError {
  sourceRow: number;
  columnId?: string;
  message: string;
  raw?: string[];
}

export interface ImportPlan {
  creates: Partial<GridRow>[];
  updates: ChangeBatch[];
  rejected: ImportRowError[];
  /** sourceRow for each entry of `creates` (same index). */
  createSourceRows: number[];
  /** rowId → sourceRow for rows in `updates`. */
  updateSourceRows: Record<string, number>;
}

export interface ImportJobState {
  total: number;
  processed: number;
  failed: number;
  errors: ImportRowError[];
}
