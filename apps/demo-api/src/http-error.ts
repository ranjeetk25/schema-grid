import {
  CursorError,
  FilterValidationError,
  FormulaQueryLimitError,
  GroupingError,
  PermissionError,
  RowValidationError,
  type SchemaGridServerError,
  SchemaValidationError,
  UnsupportedOperatorError,
} from "@ranjeetk25/schema-grid-server";
import { z } from "zod";

/** Wire error code for the statuses this app raises (see docs/wire-contract.md). */
const WIRE_CODES: Record<number, string> = {
  400: "INPUT_INVALID",
  401: "UNAUTHENTICATED",
  403: "PERMISSION_DENIED",
};

/**
 * An error carrying its own HTTP status (bad input, unknown job, stale
 * schema…). REST routes answer `{ error: { name, message } }` via
 * `toErrorResponse`; on the wire-contract grid route its `code` (when the
 * status has one) is passed through by `toWireError`.
 */
export class HttpError extends Error {
  readonly code: string | undefined;

  constructor(
    readonly status: number,
    name: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = name;
    this.code = WIRE_CODES[status];
  }
}

export interface ErrorBody {
  error: { name: string; message: string; details?: unknown };
}

const BAD_REQUEST: (new (...args: never[]) => Error)[] = [
  FilterValidationError,
  CursorError,
  SchemaValidationError,
  RowValidationError,
  UnsupportedOperatorError,
  GroupingError,
  FormulaQueryLimitError,
];

/** Error → HTTP status + `{ error: { name, message, details? } }`. */
export function toErrorResponse(err: unknown): {
  status: number;
  body: ErrorBody;
} {
  if (err instanceof HttpError) {
    return {
      status: err.status,
      body: {
        error: {
          name: err.name,
          message: err.message,
          ...(err.details === undefined ? {} : { details: err.details }),
        },
      },
    };
  }
  if (err instanceof z.ZodError) {
    return {
      status: 400,
      body: {
        error: {
          name: "InputValidationError",
          message: "Invalid request body",
          details: { issues: err.issues },
        },
      },
    };
  }
  if (err instanceof PermissionError) {
    return {
      status: 403,
      body: {
        error: { name: err.name, message: err.message, details: err.details },
      },
    };
  }
  if (BAD_REQUEST.some((cls) => err instanceof cls)) {
    const e = err as SchemaGridServerError;
    return {
      status: 400,
      body: { error: { name: e.name, message: e.message, details: e.details } },
    };
  }
  // io errors (ImportConfigError / SheetNotFoundError / HiddenColumnError) are matched by name
  // so this module stays free of the io package.
  if (
    err instanceof Error &&
    (err.name === "ImportConfigError" || err.name === "SheetNotFoundError")
  ) {
    return {
      status: 400,
      body: { error: { name: err.name, message: err.message } },
    };
  }
  if (err instanceof Error && err.name === "HiddenColumnError") {
    return {
      status: 403,
      body: { error: { name: err.name, message: err.message } },
    };
  }
  const name = err instanceof Error ? err.name : "Error";
  const message = err instanceof Error ? err.message : String(err);
  return { status: 500, body: { error: { name, message } } };
}
