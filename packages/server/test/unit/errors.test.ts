import { describe, expect, it } from "vitest";
import {
  CursorError,
  FilterValidationError,
  FormulaQueryLimitError,
  GroupingError,
  PermissionError,
  SchemaGridServerError,
  SchemaValidationError,
  UnsupportedOperatorError,
} from "../../src/errors";

const cases: [SchemaGridServerError, new (...a: never[]) => SchemaGridServerError, string][] = [
  [new PermissionError(["c1"], "filter"), PermissionError, "PERMISSION_DENIED"],
  [
    new FilterValidationError([{ code: "unknownColumn", path: [0], message: "Unknown column" }]),
    FilterValidationError,
    "INVALID_FILTER",
  ],
  [new UnsupportedOperatorError("foo", { columnId: "c1" }), UnsupportedOperatorError, "UNSUPPORTED_OPERATOR"],
  [new CursorError(), CursorError, "INVALID_CURSOR"],
  [new SchemaValidationError([{ code: "dup", path: ["columns", 0], message: "dup" }]), SchemaValidationError, "INVALID_SCHEMA"],
  [new FormulaQueryLimitError(["f1"], 5000), FormulaQueryLimitError, "FORMULA_QUERY_LIMIT"],
  [new GroupingError("nope"), GroupingError, "GROUPING_ERROR"],
];

describe("errors", () => {
  it.each(cases)("%o has class, base class, stable code and JSON details", (err, cls, code) => {
    expect(err).toBeInstanceOf(cls);
    expect(err).toBeInstanceOf(SchemaGridServerError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe(code);
    expect(JSON.parse(JSON.stringify(err.details))).toEqual(err.details);
  });

  it("PermissionError carries column ids and usage", () => {
    const e = new PermissionError(["a", "b"], "sort");
    expect(e.details).toEqual({ columnIds: ["a", "b"], usage: "sort" });
    expect(e.name).toBe("PermissionError");
  });

  it("FormulaQueryLimitError carries the row cap", () => {
    expect(new FormulaQueryLimitError(["f"], 10).details).toEqual({ columnIds: ["f"], rowCap: 10 });
  });
});
