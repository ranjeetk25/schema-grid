import type { CoreFilterValidationError } from "./internal/core";

/** JSON-safe error details. */
export type ErrorDetails = { [key: string]: unknown };

export class SchemaGridServerError extends Error {
  readonly code: string;
  readonly details: ErrorDetails;
  constructor(code: string, message: string, details: ErrorDetails = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

export type PermissionUsage = "filter" | "sort" | "groupBy" | "aggregate" | "search" | "edit";

/** `PermissionError` codes: `PERMISSION_DENIED` (hidden / not editable) or `UNSORTABLE_COLUMN` (sort on `sortable: false`). */
export type PermissionErrorCode = "PERMISSION_DENIED" | "UNSORTABLE_COLUMN";

export class PermissionError extends SchemaGridServerError {
  declare readonly details: { columnIds: string[]; usage: PermissionUsage };
  constructor(columnIds: string[], usage: PermissionUsage, message?: string, code: PermissionErrorCode = "PERMISSION_DENIED") {
    super(code, message ?? `Permission denied for ${usage} on ${columnIds.length} column(s)`, {
      columnIds,
      usage,
    });
  }
}

export class FilterValidationError extends SchemaGridServerError {
  declare readonly details: { errors: CoreFilterValidationError[] };
  constructor(errors: CoreFilterValidationError[]) {
    super("INVALID_FILTER", errors.map((e) => e.message).join("; ") || "Invalid filter", { errors });
  }
  get errors(): CoreFilterValidationError[] {
    return this.details.errors;
  }
}

export class UnsupportedOperatorError extends SchemaGridServerError {
  declare readonly details: { columnId?: string; operator: string; kind?: string };
  constructor(operator: string, details: { columnId?: string; kind?: string } = {}) {
    super("UNSUPPORTED_OPERATOR", `Unsupported operator "${operator}"`, { operator, ...details });
  }
}

export class CursorError extends SchemaGridServerError {
  constructor(message = "Invalid cursor", details: ErrorDetails = {}) {
    super("INVALID_CURSOR", message, details);
  }
}

export interface SchemaIssue {
  code: string;
  columnId?: string;
  path: (string | number)[];
  message: string;
}

export class SchemaValidationError extends SchemaGridServerError {
  declare readonly details: { issues: SchemaIssue[] };
  constructor(issues: SchemaIssue[]) {
    super("INVALID_SCHEMA", issues.map((i) => i.message).join("; ") || "Invalid schema", { issues });
  }
  get issues(): SchemaIssue[] {
    return this.details.issues;
  }
}

export class FormulaQueryLimitError extends SchemaGridServerError {
  declare readonly details: { columnIds: string[]; rowCap: number };
  constructor(columnIds: string[], rowCap: number) {
    super(
      "FORMULA_QUERY_LIMIT",
      `Filtering/sorting on non-SQL formula columns is limited to ${rowCap} candidate rows`,
      { columnIds, rowCap },
    );
  }
}

export class GroupingError extends SchemaGridServerError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("GROUPING_ERROR", message, details);
  }
}

/** A row passed to `createRows` has an invalid, unknown or non-editable cell. */
export class RowValidationError extends SchemaGridServerError {
  declare readonly details: { rowIndex: number; columnId: string; message: string };
  constructor(rowIndex: number, columnId: string, message: string) {
    super("INVALID_ROW", `Row ${rowIndex}: ${columnId}: ${message}`, { rowIndex, columnId, message });
  }
}

/** DDL helpers (from `@ranjeetk25/schema-grid-server/ddl`) that create the tables this package reads. */
export type TableDdlHelper =
  | "createRowsTableDDL"
  | "createChangeLogTableDDL"
  | "createGridSchemasTableDDL"
  | "createExtensionCellsTableDDL";

/**
 * A table this package needs does not exist (MySQL `ER_NO_SUCH_TABLE`, errno
 * 1146). The message names the table and the DDL helper that creates it.
 * Wire code `MISSING_TABLE` (HTTP 500).
 */
export class MissingTableError extends SchemaGridServerError {
  declare readonly details: { table: string; ddl: TableDdlHelper };
  constructor(table: string, ddl: TableDdlHelper, cause?: unknown) {
    super(
      "MISSING_TABLE",
      `Table \`${table}\` does not exist. Create it with ${ddl}({ table: "${table}" }) from "@ranjeetk25/schema-grid-server/ddl" (run the statement's .sql once), then retry.`,
      { table, ddl },
    );
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/** The name in MySQL's "Table 'db.name' doesn't exist" message, or undefined. */
function missingTableName(err: unknown): string | undefined {
  const message = typeof (err as { message?: unknown })?.message === "string" ? (err as { message: string }).message : "";
  const m = /Table '(?:[^'.]+\.)?([^']+)' doesn't exist/.exec(message);
  return m?.[1];
}

/** True for mysql2's `ER_NO_SUCH_TABLE` (errno 1146), looking through wrapper errors' `cause`. */
export function isNoSuchTableError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth++) {
    const e = current as { errno?: unknown; code?: unknown; cause?: unknown };
    if (e.errno === 1146 || e.code === "ER_NO_SUCH_TABLE") return true;
    current = e.cause;
  }
  return false;
}

/**
 * Turns a driver "no such table" error into a `MissingTableError` when the
 * missing table is one of `known` (table name → DDL helper); anything else is
 * rethrown unchanged. Use it around every statement that touches package tables.
 */
export function translateMissingTable(err: unknown, known: Readonly<Record<string, TableDdlHelper>>): never {
  if (isNoSuchTableError(err)) {
    const name = missingTableName(err) ?? missingTableName((err as { cause?: unknown })?.cause);
    const entries = Object.entries(known);
    const hit = (name !== undefined ? entries.find(([table]) => table === name) : undefined) ?? (entries.length === 1 ? entries[0] : undefined);
    if (hit) throw new MissingTableError(hit[0], hit[1], err);
  }
  throw err;
}

/** `fn()` with `translateMissingTable` applied to its rejection. */
export async function guardMissingTable<T>(known: Readonly<Record<string, TableDdlHelper>>, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    return translateMissingTable(err, known);
  }
}
