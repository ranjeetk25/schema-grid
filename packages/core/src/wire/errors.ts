/** JSON error body every transport carries for a failed grid operation. */
export interface WireError {
  code: string;
  message: string;
  details?: unknown;
}

/** HTTP status for each wire error code. Unknown codes map to 500. */
export const WIRE_ERROR_STATUS = {
  INPUT_INVALID: 400,
  FILTER_INVALID: 400,
  INVALID_CURSOR: 400,
  SCHEMA_INVALID: 400,
  ROW_INVALID: 400,
  GROUPING_INVALID: 400,
  UNAUTHENTICATED: 401,
  PERMISSION_DENIED: 403,
  UNKNOWN_OPERATION: 404,
  FORMULA_ROW_CAP: 413,
  INTERNAL: 500,
  OUTPUT_INVALID: 500,
  UNSUPPORTED_OPERATION: 501,
} as const satisfies Record<string, number>;

export type WireErrorCode = keyof typeof WIRE_ERROR_STATUS;

const has = (table: object, key: string): boolean => Object.prototype.hasOwnProperty.call(table, key);

export function isWireErrorCode(code: string): code is WireErrorCode {
  return has(WIRE_ERROR_STATUS, code);
}

export function httpStatusFor(code: string): number {
  return isWireErrorCode(code) ? WIRE_ERROR_STATUS[code] : 500;
}

export function isWireError(value: unknown): value is WireError {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { code?: unknown; message?: unknown };
  return typeof v.code === "string" && typeof v.message === "string";
}

/**
 * Error codes raised by `@masai/schema-grid-server` (upper case) and the
 * in-memory data source (camel case), mapped to wire codes. Matched by
 * duck-typing so core never imports the server.
 */
const SOURCE_CODES: Record<string, WireErrorCode> = {
  PERMISSION_DENIED: "PERMISSION_DENIED",
  INVALID_FILTER: "FILTER_INVALID",
  UNSUPPORTED_OPERATOR: "FILTER_INVALID",
  INVALID_CURSOR: "INVALID_CURSOR",
  INVALID_SCHEMA: "SCHEMA_INVALID",
  FORMULA_QUERY_LIMIT: "FORMULA_ROW_CAP",
  GROUPING_ERROR: "GROUPING_INVALID",
  INVALID_ROW: "ROW_INVALID",
  unknownColumn: "INPUT_INVALID",
  unreadableColumn: "PERMISSION_DENIED",
  unknownOperator: "FILTER_INVALID",
  valueKindMismatch: "FILTER_INVALID",
  depthExceeded: "FILTER_INVALID",
  invalidAggregation: "GROUPING_INVALID",
  invalidPage: "INPUT_INVALID",
  invalidCursor: "INVALID_CURSOR",
  notEditable: "PERMISSION_DENIED",
  unsupportedColumnType: "INPUT_INVALID",
  invalidValue: "INPUT_INVALID",
};

/** Fallback by error class name when no `code` is recognised. */
const SOURCE_NAMES: Record<string, WireErrorCode> = {
  PermissionError: "PERMISSION_DENIED",
  FilterValidationError: "FILTER_INVALID",
  UnsupportedOperatorError: "FILTER_INVALID",
  CursorError: "INVALID_CURSOR",
  SchemaValidationError: "SCHEMA_INVALID",
  FormulaQueryLimitError: "FORMULA_ROW_CAP",
  GroupingError: "GROUPING_INVALID",
  RowValidationError: "ROW_INVALID",
  InMemoryMutationError: "ROW_INVALID",
};

export interface ToWireErrorOptions {
  /** Include the original message of unrecognised errors. Default false ("Internal error"). */
  exposeInternal?: boolean;
}

/** A JSON-safe deep copy, or undefined when the value is empty or not serialisable. */
function jsonSafe(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) return undefined;
  try {
    const text = JSON.stringify(value);
    return text === undefined ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}

function build(code: string, message: string, details?: unknown): WireError {
  const safe = jsonSafe(details);
  return safe === undefined ? { code, message } : { code, message, details: safe };
}

/** Maps anything thrown by a data source to a `WireError` (never throws). */
export function toWireError(err: unknown, options: ToWireErrorOptions = {}): WireError {
  if (typeof err === "object" && err !== null) {
    const e = err as { code?: unknown; name?: unknown; message?: unknown; details?: unknown; errors?: unknown };
    const message = typeof e.message === "string" && e.message !== "" ? e.message : "Error";
    const code = typeof e.code === "string" ? e.code : undefined;
    const name = typeof e.name === "string" ? e.name : undefined;

    if (name === "InMemoryQueryError" && code !== undefined) {
      const errors = Array.isArray(e.errors) ? e.errors : [];
      const wire = errors.length > 0 ? "FILTER_INVALID" : (SOURCE_CODES[code] ?? "INPUT_INVALID");
      return build(wire, message, errors.length > 0 ? { reason: code, errors } : { reason: code });
    }
    if (code !== undefined && has(SOURCE_CODES, code)) {
      return build(SOURCE_CODES[code] as WireErrorCode, message, e.details);
    }
    if (code !== undefined && isWireErrorCode(code)) return build(code, message, e.details);
    if (name !== undefined && has(SOURCE_NAMES, name)) {
      return build(SOURCE_NAMES[name] as WireErrorCode, message, e.details);
    }
    if (options.exposeInternal && typeof e.message === "string") return { code: "INTERNAL", message: e.message };
  }
  return { code: "INTERNAL", message: "Internal error" };
}

/** Thrown by remote data sources when the other side answered with a `WireError`. */
export class RemoteDataSourceError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(error: WireError, status: number = httpStatusFor(error.code)) {
    super(error.message);
    this.name = "RemoteDataSourceError";
    this.code = error.code;
    this.status = status;
    this.details = error.details;
  }

  toWireError(): WireError {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details };
  }
}
