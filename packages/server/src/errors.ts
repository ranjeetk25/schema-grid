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

export class PermissionError extends SchemaGridServerError {
  declare readonly details: { columnIds: string[]; usage: PermissionUsage };
  constructor(columnIds: string[], usage: PermissionUsage, message?: string) {
    super("PERMISSION_DENIED", message ?? `Permission denied for ${usage} on ${columnIds.length} column(s)`, {
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
