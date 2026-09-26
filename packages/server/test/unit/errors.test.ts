import { describe, expect, it } from "vitest";
import {
  CursorError,
  MissingTableError,
  guardMissingTable,
  isNoSuchTableError,
  translateMissingTable,
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

describe("MissingTableError (v0.3)", () => {
  const noSuchTable = (table: string) =>
    Object.assign(new Error(`Table 'app.${table}' doesn't exist`), { errno: 1146, code: "ER_NO_SUCH_TABLE", sqlState: "42S02" });

  it("names the table and the DDL helper to run", () => {
    const e = new MissingTableError("grid_schemas", "createGridSchemasTableDDL");
    expect(e.code).toBe("MISSING_TABLE");
    expect(e.message).toContain("`grid_schemas` does not exist");
    expect(e.message).toContain('createGridSchemasTableDDL({ table: "grid_schemas" })');
    expect(e.details).toEqual({ table: "grid_schemas", ddl: "createGridSchemasTableDDL" });
  });

  it("detects ER_NO_SUCH_TABLE directly and through a wrapper's cause", () => {
    expect(isNoSuchTableError(noSuchTable("x"))).toBe(true);
    expect(isNoSuchTableError(Object.assign(new Error("Failed query"), { cause: noSuchTable("x") }))).toBe(true);
    expect(isNoSuchTableError(new Error("socket hang up"))).toBe(false);
  });

  it("translateMissingTable maps a known table (by the message's table name) and rethrows anything else", () => {
    const known = { grid_rows: "createRowsTableDDL", grid_change_log: "createChangeLogTableDDL" } as const;
    expect(() => translateMissingTable(noSuchTable("grid_change_log"), known)).toThrow(MissingTableError);
    try {
      translateMissingTable(Object.assign(new Error("wrapped"), { cause: noSuchTable("grid_rows") }), known);
    } catch (e) {
      expect((e as MissingTableError).details).toEqual({ table: "grid_rows", ddl: "createRowsTableDDL" });
    }
    const other = noSuchTable("something_else");
    expect(() => translateMissingTable(other, known)).toThrow(other);
    const plain = new Error("nope");
    expect(() => translateMissingTable(plain, known)).toThrow(plain);
    // A single known table is assumed when the driver message carries no name.
    expect(() => translateMissingTable(Object.assign(new Error("gone"), { errno: 1146 }), { grid_schemas: "createGridSchemasTableDDL" })).toThrow(
      MissingTableError,
    );
  });

  it("guardMissingTable wraps an async call", async () => {
    await expect(guardMissingTable({ t: "createExtensionCellsTableDDL" }, async () => 1)).resolves.toBe(1);
    await expect(
      guardMissingTable({ t: "createExtensionCellsTableDDL" }, async () => {
        throw noSuchTable("t");
      }),
    ).rejects.toBeInstanceOf(MissingTableError);
  });
});
