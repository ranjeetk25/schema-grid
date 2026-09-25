import { describe, expect, it } from "vitest";
import { validateRows } from "../src/import/validate";
import type {
  CellValidation,
  ColumnMapping,
  ParsedTable,
  RowValidation,
  ValidateRowsOptions,
  ValidationReport,
} from "../src/import/types";
import type { AnyFieldType, ColumnDef } from "../src/internal/core";
import { ImportConfigError } from "../src/internal/errors";
import { makeRegistry } from "./helpers/registry";
import { makeAccess, makeColumns, makeSchema } from "./helpers/schema";

function table(headers: string[], rows: string[][], headerRow?: number): ParsedTable {
  return headerRow === undefined
    ? { headers, rows, truncated: false }
    : { headers, rows, truncated: false, headerRow };
}

/** Maps header i → columnIds[i] (null = unmapped). */
function mapping(headers: string[], columnIds: (string | null)[]): ColumnMapping[] {
  return headers.map((header, headerIndex) => ({
    header,
    headerIndex,
    columnId: columnIds[headerIndex] ?? null,
    confidence: 1,
  }));
}

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error("missing");
  return v;
}

function rowOf(r: ValidationReport, i: number): RowValidation {
  return must(r.rows[i]);
}

function cellOf(r: ValidationReport, i: number, id: string): CellValidation {
  return must(rowOf(r, i).cells[id]);
}

const CREATE: ValidateRowsOptions = { mode: "create", unknownOptions: "reject" };

function run(
  headers: string[],
  columnIds: (string | null)[],
  rows: string[][],
  opts: ValidateRowsOptions = CREATE,
  schema: ColumnDef[] = makeColumns(),
) {
  return validateRows(
    table(headers, rows),
    mapping(headers, columnIds),
    schema,
    makeRegistry(),
    opts,
  );
}

describe("validateRows: parsing", () => {
  it("gives a cell error for a non-number in a numeric column", () => {
    const r = run(["Name", "Amount"], ["c_name", "c_amount"], [["A", "abc"]]);
    const cell = cellOf(r, 0, "c_amount");
    expect(cell.error).toBeTruthy();
    expect(cell.raw).toBe("abc");
    expect(r.summary.invalid).toBe(1);
  });

  it("uses the field type's parsed value for a valid number", () => {
    const r = run(["Name", "Amount"], ["c_name", "c_amount"], [["A", " 12.5 "]]);
    const cell = cellOf(r, 0, "c_amount");
    expect(cell.error).toBeUndefined();
    expect(cell.value).toBe(12.5);
    expect(cell.raw).toBe("12.5");
  });

  it("keys cells by columnId and ignores unmapped headers", () => {
    const r = run(["Name", "Junk"], ["c_name", null], [["A", "x"]]);
    expect(Object.keys(rowOf(r, 0).cells)).toEqual(["c_name"]);
  });

  it("treats a missing trailing cell as empty", () => {
    const r = run(["Name", "Amount"], ["c_name", "c_amount"], [["A"]]);
    expect(cellOf(r, 0, "c_amount")).toEqual({ value: null, raw: "" });
  });

  it("turns a throwing parse into a cell error instead of crashing", () => {
    const registry = makeRegistry();
    const boom: AnyFieldType = {
      ...must(registry.get("text")),
      id: "boom",
      parse: () => {
        throw new Error("kaboom");
      },
    };
    registry.register(boom);
    const cols = [
      ...makeColumns(),
      { ...must(makeColumns()[0]), id: "c_boom", key: "boom", type: "boom", required: false },
    ];
    const r = validateRows(
      table(["Name", "Boom"], [["A", "x"]]),
      mapping(["Name", "Boom"], ["c_name", "c_boom"]),
      cols,
      registry,
      CREATE,
    );
    expect(cellOf(r, 0, "c_boom").error).toBe("kaboom");
    expect(r.summary.invalid).toBe(1);
  });
});

describe("validateRows: required", () => {
  it("create mode: empty required cell gets Required", () => {
    const r = run(["Name", "Amount"], ["c_name", "c_amount"], [["  ", "1"]]);
    expect(cellOf(r, 0, "c_name")).toEqual({ value: null, raw: "", error: "Required" });
    expect(r.summary.invalid).toBe(1);
  });

  it("update mode: same row has no Required error and the cell is skipped", () => {
    const r = run(
      ["Email", "Name"],
      ["c_email", "c_name"],
      [["a@x.com", ""]],
      { mode: "update", keyColumnId: "c_email", unknownOptions: "reject" },
    );
    const cell = cellOf(r, 0, "c_name");
    expect(cell.error).toBeUndefined();
    expect(cell.skip).toBe(true);
    expect(cell.value).toBeNull();
    expect(r.summary.valid).toBe(1);
  });

  it("upsert: keyed rows skip empties, keyless rows get Required", () => {
    const r = run(
      ["Email", "Name"],
      ["c_email", "c_name"],
      [
        ["a@x.com", ""],
        ["", ""],
      ],
      { mode: "upsert", keyColumnId: "c_email", unknownOptions: "reject" },
    );
    expect(cellOf(r, 0, "c_name").skip).toBe(true);
    expect(cellOf(r, 0, "c_name").error).toBeUndefined();
    expect(cellOf(r, 1, "c_name").skip).toBeUndefined();
    expect(cellOf(r, 1, "c_name").error).toBe("Required");
  });
});

describe("validateRows: keys", () => {
  it("update without keyColumnId throws ImportConfigError", () => {
    expect(() =>
      run(["Name"], ["c_name"], [["A"]], { mode: "update", unknownOptions: "reject" }),
    ).toThrow(ImportConfigError);
  });

  it("upsert with an unmapped key column throws", () => {
    expect(() =>
      run(["Name"], ["c_name"], [["A"]], {
        mode: "upsert",
        keyColumnId: "c_email",
        unknownOptions: "reject",
      }),
    ).toThrow(ImportConfigError);
  });

  it("update row with empty key gets Missing key", () => {
    const r = run(
      ["Email", "Name"],
      ["c_email", "c_name"],
      [["", "A"]],
      { mode: "update", keyColumnId: "c_email", unknownOptions: "reject" },
    );
    expect(rowOf(r, 0).rowError).toBe("Missing key");
    expect(r.summary.invalid).toBe(1);
  });

  it("upsert with empty key is valid (treated as a create)", () => {
    const r = run(
      ["Email", "Name"],
      ["c_email", "c_name"],
      [["", "A"]],
      { mode: "upsert", keyColumnId: "c_email", unknownOptions: "reject" },
    );
    expect(rowOf(r, 0).rowError).toBeUndefined();
    expect(r.summary.valid).toBe(1);
  });

  it("a repeated key sets rowError on the later occurrence only", () => {
    const r = validateRows(
      table(
        ["Email", "Name"],
        [
          ["a@x.com", "A"],
          ["b@x.com", "B"],
          ["A@X.COM ", "C"],
        ],
      ),
      mapping(["Email", "Name"], ["c_email", "c_name"]),
      makeSchema(),
      makeRegistry(),
      { mode: "update", keyColumnId: "c_email", unknownOptions: "reject" },
    );
    expect(rowOf(r, 0).rowError).toBeUndefined();
    expect(rowOf(r, 1).rowError).toBeUndefined();
    expect(rowOf(r, 2).rowError).toBe("Duplicate key (first seen on row 2)");
    expect(r.summary).toMatchObject({ valid: 2, invalid: 1 });
  });

  it("the key column may be read-only when access is given", () => {
    const access = makeAccess();
    access.set("c_email", "read");
    const r = run(
      ["Email", "Name"],
      ["c_email", "c_name"],
      [["a@x.com", "A"]],
      { mode: "update", keyColumnId: "c_email", unknownOptions: "reject", access },
    );
    expect(r.summary.valid).toBe(1);
  });
});

describe("validateRows: setup errors", () => {
  it("mapping to a formula column throws", () => {
    expect(() => run(["Score"], ["c_score"], [["1"]])).toThrow(ImportConfigError);
  });

  it("mapping to a read-only column with access given throws", () => {
    expect(() =>
      run(["Name", "Note"], ["c_name", "c_note"], [["A", "n"]], {
        ...CREATE,
        access: makeAccess(),
      }),
    ).toThrow(ImportConfigError);
  });

  it("mapping to a hidden column with access given throws", () => {
    expect(() =>
      run(["Name", "Secret"], ["c_name", "c_secret"], [["A", "s"]], {
        ...CREATE,
        access: makeAccess(),
      }),
    ).toThrow(ImportConfigError);
  });

  it("a hidden key column throws", () => {
    const access = makeAccess();
    access.set("c_email", "hidden");
    expect(() =>
      run(["Email", "Name"], ["c_email", "c_name"], [["a@x.com", "A"]], {
        mode: "update",
        keyColumnId: "c_email",
        unknownOptions: "reject",
        access,
      }),
    ).toThrow(ImportConfigError);
  });

  it("a currency or datetime key column throws", () => {
    for (const [header, id] of [
      ["Amount", "c_amount"],
      ["Last Call", "c_call"],
    ] as const) {
      expect(() =>
        run([header, "Name"], [id, "c_name"], [["1", "A"]], {
          mode: "update",
          keyColumnId: id,
          unknownOptions: "reject",
        }),
      ).toThrow(ImportConfigError);
    }
  });

  it("mapping to an unknown column throws", () => {
    expect(() => run(["X"], ["c_nope"], [["1"]])).toThrow(ImportConfigError);
  });

  it("two headers mapped to the same column throws", () => {
    expect(() => run(["Name", "Name 2"], ["c_name", "c_name"], [["A", "B"]])).toThrow(
      ImportConfigError,
    );
  });

  it("a column whose field type is not registered throws", () => {
    const cols = [
      ...makeColumns(),
      { ...must(makeColumns()[0]), id: "c_x", key: "x", type: "mystery", required: false },
    ];
    expect(() => run(["X"], ["c_x"], [["1"]], CREATE, cols)).toThrow(ImportConfigError);
  });
});

describe("validateRows: summary", () => {
  it("unmappedRequired lists c_name when name isn't mapped in create mode", () => {
    const r = run(["Amount"], ["c_amount"], [["1"]]);
    expect(r.summary.unmappedRequired).toEqual(["c_name"]);
  });

  it("unmappedRequired is empty in update mode", () => {
    const r = run(["Email"], ["c_email"], [["a@x.com"]], {
      mode: "update",
      keyColumnId: "c_email",
      unknownOptions: "reject",
    });
    expect(r.summary.unmappedRequired).toEqual([]);
  });

  it("unmappedRequired excludes required columns the user cannot edit", () => {
    const access = makeAccess();
    access.set("c_name", "read");
    const r = run(["Amount"], ["c_amount"], [["1"]], { ...CREATE, access });
    expect(r.summary.unmappedRequired).toEqual([]);
  });

  it("valid + invalid add up to the number of rows; newOptions is empty", () => {
    const r = run(
      ["Name", "Amount"],
      ["c_name", "c_amount"],
      [
        ["A", "1"],
        ["", "2"],
        ["C", "x"],
        ["D", ""],
      ],
    );
    expect(r.rows).toHaveLength(4);
    expect(r.summary.valid + r.summary.invalid).toBe(4);
    expect(r.summary).toMatchObject({ valid: 2, invalid: 2, newOptions: {} });
  });

  it("sourceRow = headerRow + index + 1 (headerRow 2)", () => {
    const r = validateRows(
      table(["Name"], [["A"], ["B"]], 2),
      mapping(["Name"], ["c_name"]),
      makeSchema(),
      makeRegistry(),
      CREATE,
    );
    expect(r.rows.map((x) => [x.index, x.sourceRow])).toEqual([
      [0, 3],
      [1, 4],
    ]);
  });

  it("sourceRow defaults to headerRow 1", () => {
    const r = run(["Name"], ["c_name"], [["A"]]);
    expect(rowOf(r, 0).sourceRow).toBe(2);
  });
});
