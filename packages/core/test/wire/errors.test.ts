import { describe, expect, it } from "vitest";
import { InMemoryMutationError } from "../../src/memory/mutations";
import { InMemoryQueryError } from "../../src/memory/types";
import {
  WIRE_ERROR_STATUS,
  httpStatusFor,
  isWireError,
  RemoteDataSourceError,
  toWireError,
} from "../../src/wire/errors";

/** Mimics a server error class without importing the server package. */
class FakeServerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "FakeServerError";
  }
}

describe("httpStatusFor", () => {
  it("maps every wire code to its HTTP status", () => {
    expect(WIRE_ERROR_STATUS).toEqual({
      INPUT_INVALID: 400,
      FILTER_INVALID: 400,
      INVALID_CURSOR: 400,
      SCHEMA_INVALID: 400,
      ROW_INVALID: 400,
      GROUPING_INVALID: 400,
      UNAUTHENTICATED: 401,
      UNSORTABLE_COLUMN: 400,
      PERMISSION_DENIED: 403,
      UNKNOWN_OPERATION: 404,
      UNKNOWN_GRID: 404,
      METHOD_NOT_ALLOWED: 405,
      SCHEMA_CONFLICT: 409,
      FORMULA_ROW_CAP: 413,
      INTERNAL: 500,
      MISSING_TABLE: 500,
      OUTPUT_INVALID: 500,
      UNSUPPORTED_OPERATION: 501,
    });
    expect(httpStatusFor("PERMISSION_DENIED")).toBe(403);
    expect(httpStatusFor("SOMETHING_ELSE")).toBe(500);
    expect(httpStatusFor("toString")).toBe(500);
  });
});

describe("toWireError", () => {
  it.each([
    ["PERMISSION_DENIED", "PERMISSION_DENIED", 403],
    ["INVALID_FILTER", "FILTER_INVALID", 400],
    ["UNSUPPORTED_OPERATOR", "FILTER_INVALID", 400],
    ["INVALID_CURSOR", "INVALID_CURSOR", 400],
    ["INVALID_SCHEMA", "SCHEMA_INVALID", 400],
    ["FORMULA_QUERY_LIMIT", "FORMULA_ROW_CAP", 413],
    ["GROUPING_ERROR", "GROUPING_INVALID", 400],
    ["INVALID_ROW", "ROW_INVALID", 400],
  ])("maps server code %s to %s (%i) and keeps details", (source, code, status) => {
    const err = new FakeServerError(source, "boom", { columnIds: ["c1"] });
    const wire = toWireError(err);
    expect(wire).toEqual({ code, message: "boom", details: { columnIds: ["c1"] } });
    expect(httpStatusFor(wire.code)).toBe(status);
  });

  it.each([
    ["PermissionError", "PERMISSION_DENIED"],
    ["FilterValidationError", "FILTER_INVALID"],
    ["UnsupportedOperatorError", "FILTER_INVALID"],
    ["CursorError", "INVALID_CURSOR"],
    ["SchemaValidationError", "SCHEMA_INVALID"],
    ["FormulaQueryLimitError", "FORMULA_ROW_CAP"],
    ["GroupingError", "GROUPING_INVALID"],
    ["RowValidationError", "ROW_INVALID"],
    ["InMemoryMutationError", "ROW_INVALID"],
  ])("falls back to the class name %s -> %s", (name, code) => {
    const err = new Error("x");
    err.name = name;
    expect(toWireError(err).code).toBe(code);
  });

  it("maps in-memory query errors", () => {
    const filterErr = new InMemoryQueryError("unknownColumn", "Invalid filter", [
      { code: "unknownColumn", path: [0], columnId: "nope", message: "Unknown column" },
    ]);
    expect(toWireError(filterErr)).toEqual({
      code: "FILTER_INVALID",
      message: "Invalid filter",
      details: { reason: "unknownColumn", errors: filterErr.errors },
    });
    expect(toWireError(new InMemoryQueryError("invalidCursor", "c")).code).toBe("INVALID_CURSOR");
    expect(toWireError(new InMemoryQueryError("notEditable", "c")).code).toBe("PERMISSION_DENIED");
    expect(toWireError(new InMemoryQueryError("unreadableColumn", "c")).code).toBe("PERMISSION_DENIED");
    expect(toWireError(new InMemoryQueryError("invalidAggregation", "c")).code).toBe("GROUPING_INVALID");
    expect(toWireError(new InMemoryQueryError("depthExceeded", "c")).code).toBe("FILTER_INVALID");
    expect(toWireError(new InMemoryQueryError("unsortableColumn", "c")).code).toBe("UNSORTABLE_COLUMN");
    expect(
      toWireError(
        new InMemoryQueryError("unfilterableColumn", "Invalid filter", [
          { code: "unfilterableColumn", path: [], columnId: "a", message: "m" },
        ]),
      ).code,
    ).toBe("FILTER_INVALID");
    expect(toWireError({ code: "UNSORTABLE_COLUMN", message: "m", details: { columnIds: ["a"], usage: "sort" } })).toEqual({
      code: "UNSORTABLE_COLUMN",
      message: "m",
      details: { columnIds: ["a"], usage: "sort" },
    });
    for (const code of ["unknownColumn", "invalidPage", "unsupportedColumnType", "invalidValue"] as const) {
      expect(toWireError(new InMemoryQueryError(code, "c")).code).toBe("INPUT_INVALID");
    }
    expect(toWireError(new InMemoryMutationError("Row 0: bad"))).toEqual({
      code: "ROW_INVALID",
      message: "Row 0: bad",
    });
  });

  it("passes wire errors and RemoteDataSourceErrors through unchanged", () => {
    expect(toWireError({ code: "UNAUTHENTICATED", message: "log in" })).toEqual({
      code: "UNAUTHENTICATED",
      message: "log in",
    });
    const remote = new RemoteDataSourceError({ code: "FORMULA_ROW_CAP", message: "cap", details: { rowCap: 5 } });
    expect(toWireError(remote)).toEqual({ code: "FORMULA_ROW_CAP", message: "cap", details: { rowCap: 5 } });
  });

  it("hides unknown errors as INTERNAL unless exposure is requested", () => {
    const err = Object.assign(new Error("db password is hunter2"), { code: "ECONNREFUSED" });
    expect(toWireError(err)).toEqual({ code: "INTERNAL", message: "Internal error" });
    expect(toWireError(err, { exposeInternal: true })).toEqual({ code: "INTERNAL", message: "db password is hunter2" });
    expect(toWireError("string thrown")).toEqual({ code: "INTERNAL", message: "Internal error" });
    expect(toWireError(null)).toEqual({ code: "INTERNAL", message: "Internal error" });
  });

  it("drops non-JSON-safe details", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const wire = toWireError(new FakeServerError("PERMISSION_DENIED", "no", circular));
    expect(wire).toEqual({ code: "PERMISSION_DENIED", message: "no" });
  });
});

describe("isWireError / RemoteDataSourceError", () => {
  it("recognises the wire error shape", () => {
    expect(isWireError({ code: "X", message: "m" })).toBe(true);
    expect(isWireError({ code: "X", message: "m", details: [1] })).toBe(true);
    expect(isWireError({ code: 1, message: "m" })).toBe(false);
    expect(isWireError({ code: "X" })).toBe(false);
    expect(isWireError(null)).toBe(false);
  });

  it("carries code, status and details", () => {
    const err = new RemoteDataSourceError({ code: "PERMISSION_DENIED", message: "no", details: { a: 1 } });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("RemoteDataSourceError");
    expect(err.code).toBe("PERMISSION_DENIED");
    expect(err.status).toBe(403);
    expect(err.details).toEqual({ a: 1 });
    expect(err.message).toBe("no");
    expect(new RemoteDataSourceError({ code: "X", message: "m" }, 418).status).toBe(418);
    expect(err.toWireError()).toEqual({ code: "PERMISSION_DENIED", message: "no", details: { a: 1 } });
  });
});
