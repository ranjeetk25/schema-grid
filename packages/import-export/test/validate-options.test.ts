import { describe, expect, it } from "vitest";
import { matchOption, splitMulti } from "../src/import/options";
import type {
  CellValidation,
  ColumnMapping,
  ParsedTable,
  ValidateRowsOptions,
  ValidationReport,
} from "../src/import/types";
import { validateRows } from "../src/import/validate";
import { makeRegistry } from "./helpers/registry";
import { makeColumns } from "./helpers/schema";

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error("missing");
  return v;
}

function cellOf(r: ValidationReport, i: number, id: string): CellValidation {
  return must(must(r.rows[i]).cells[id]);
}

function run(
  headers: string[],
  columnIds: (string | null)[],
  rows: string[][],
  opts: Partial<ValidateRowsOptions> = {},
): ValidationReport {
  const parsed: ParsedTable = { headers, rows, truncated: false };
  const mapping: ColumnMapping[] = headers.map((header, headerIndex) => ({
    header,
    headerIndex,
    columnId: columnIds[headerIndex] ?? null,
    confidence: 1,
  }));
  return validateRows(parsed, mapping, makeColumns(), makeRegistry(), {
    mode: "create",
    unknownOptions: "create",
    ...opts,
  });
}

const OPTS = [
  { value: "opt_paid", label: "Paid" },
  { value: "opt_in_progress", label: "In  Progress" },
];

describe("matchOption", () => {
  it("matches the label ignoring case and surrounding whitespace", () => {
    expect(matchOption("  paid ", OPTS)).toEqual(OPTS[0]);
  });

  it("collapses internal whitespace runs", () => {
    expect(matchOption("in progress", OPTS)).toEqual(OPTS[1]);
    expect(matchOption("IN   PROGRESS", OPTS)).toEqual(OPTS[1]);
  });

  it("falls back to the option value", () => {
    expect(matchOption("OPT_PAID", OPTS)).toEqual(OPTS[0]);
  });

  it("prefers a label match over a value match", () => {
    const opts = [
      { value: "b", label: "A" },
      { value: "a", label: "B" },
    ];
    expect(matchOption("a", opts)).toEqual(opts[0]);
  });

  it("returns null when nothing matches or input is blank", () => {
    expect(matchOption("Refunded", OPTS)).toBeNull();
    expect(matchOption("   ", OPTS)).toBeNull();
  });
});

describe("splitMulti", () => {
  it("splits on , and ;, trims, drops empties, dedupes case-insensitively", () => {
    expect(splitMulti("A; b, C,,a")).toEqual(["A", "b", "C"]);
  });

  it("returns [] for blank input", () => {
    expect(splitMulti(" ,; ")).toEqual([]);
  });
});

describe("validateRows: select policy", () => {
  it("c_pay unknown value under create is valid and listed in newOptions", () => {
    const r = run(["Name", "Pay"], ["c_name", "c_pay"], [["A", "Refunded"]]);
    const cell = cellOf(r, 0, "c_pay");
    expect(cell.error).toBeUndefined();
    expect(cell.value).toBe("Refunded");
    expect(r.summary.newOptions).toEqual({ c_pay: ["Refunded"] });
    expect(r.summary.valid).toBe(1);
  });

  it("c_pay unknown value under reject is a cell error and the row is invalid", () => {
    const r = run(["Name", "Pay"], ["c_name", "c_pay"], [["A", "Refunded"]], {
      unknownOptions: "reject",
    });
    expect(cellOf(r, 0, "c_pay").error).toBe('Unknown option "Refunded"');
    expect(r.summary).toMatchObject({ valid: 0, invalid: 1, newOptions: {} });
  });

  it("a known option in different case maps to its id with no new option", () => {
    const r = run(["Name", "Pay"], ["c_name", "c_pay"], [["A", "paid"]]);
    expect(cellOf(r, 0, "c_pay").value).toBe("opt_paid");
    expect(r.summary.newOptions).toEqual({});
  });

  it("an unknown value repeated across rows is listed once, first spelling kept", () => {
    const r = run(
      ["Name", "Pay"],
      ["c_name", "c_pay"],
      [
        ["A", "Refunded"],
        ["B", "refunded"],
        ["C", " REFUNDED "],
      ],
    );
    expect(r.summary.newOptions).toEqual({ c_pay: ["Refunded"] });
    expect(r.summary.valid).toBe(3);
  });

  it("c_stage (creatableSelect) follows the same policy", () => {
    const created = run(["Name", "Stage"], ["c_name", "c_stage"], [["A", "Lost"]]);
    expect(cellOf(created, 0, "c_stage").value).toBe("Lost");
    expect(created.summary.newOptions).toEqual({ c_stage: ["Lost"] });

    const rejected = run(["Name", "Stage"], ["c_name", "c_stage"], [["A", "Lost"]], {
      unknownOptions: "reject",
    });
    expect(cellOf(rejected, 0, "c_stage").error).toBe('Unknown option "Lost"');
    expect(rejected.summary.newOptions).toEqual({});

    const known = run(["Name", "Stage"], ["c_name", "c_stage"], [["A", "won"]]);
    expect(cellOf(known, 0, "c_stage").value).toBe("stage_won");
  });
});

describe("validateRows: multiSelect policy", () => {
  it('c_tags "A; b, C,,A" gives [tag_a, tag_b, tag_c]', () => {
    const r = run(["Name", "Tags"], ["c_name", "c_tags"], [["X", "A; b, C,,A"]]);
    expect(cellOf(r, 0, "c_tags").value).toEqual(["tag_a", "tag_b", "tag_c"]);
    expect(r.summary.newOptions).toEqual({});
  });

  it("known ids are ordered by option config, new labels last", () => {
    const r = run(["Name", "Tags"], ["c_name", "c_tags"], [["X", "Z, C, a"]]);
    expect(cellOf(r, 0, "c_tags").value).toEqual(["tag_a", "tag_c", "Z"]);
  });

  it('c_tags "A, Z" under create adds Z to newOptions', () => {
    const r = run(["Name", "Tags"], ["c_name", "c_tags"], [["X", "A, Z"]]);
    expect(cellOf(r, 0, "c_tags").value).toEqual(["tag_a", "Z"]);
    expect(r.summary.newOptions).toEqual({ c_tags: ["Z"] });
    expect(r.summary.valid).toBe(1);
  });

  it("under reject, one error names every unknown piece", () => {
    const r = run(["Name", "Tags"], ["c_name", "c_tags"], [["X", "A, Z, Y"]], {
      unknownOptions: "reject",
    });
    expect(cellOf(r, 0, "c_tags").error).toBe('Unknown option(s) "Z", "Y"');
    expect(r.summary).toMatchObject({ invalid: 1, newOptions: {} });
  });

  it("a split yielding nothing is empty (not an error)", () => {
    const r = run(["Name", "Tags"], ["c_name", "c_tags"], [["X", ",;"]]);
    const cell = cellOf(r, 0, "c_tags");
    expect(cell.error).toBeUndefined();
    expect(cell.value).toEqual([]);
  });

  it("a required multiSelect whose split yields nothing gets Required in create", () => {
    const cols = makeColumns().map((c) =>
      c.id === "c_tags" ? { ...c, required: true } : c,
    );
    const r = validateRows(
      { headers: ["Name", "Tags"], rows: [["X", ",;"]], truncated: false },
      [
        { header: "Name", headerIndex: 0, columnId: "c_name", confidence: 1 },
        { header: "Tags", headerIndex: 1, columnId: "c_tags", confidence: 1 },
      ],
      cols,
      makeRegistry(),
      { mode: "create", unknownOptions: "create" },
    );
    expect(cellOf(r, 0, "c_tags").error).toBe("Required");
  });
});

describe("validateRows: limit", () => {
  it("limit 2 on 10 rows validates and counts only 2", () => {
    const rows = Array.from({ length: 10 }, (_, i) => [`N${i}`]);
    const r = run(["Name"], ["c_name"], rows, { limit: 2 });
    expect(r.rows).toHaveLength(2);
    expect(r.summary.valid + r.summary.invalid).toBe(2);
  });

  it("new options from rows past the limit are not collected", () => {
    const r = run(
      ["Name", "Pay"],
      ["c_name", "c_pay"],
      [
        ["A", "Paid"],
        ["B", "Refunded"],
      ],
      { limit: 1 },
    );
    expect(r.summary.newOptions).toEqual({});
  });
});

describe("validateRows: summary.unknownOptions and errorKind", () => {
  it("lists unknown values per column under BOTH policies; newOptions only under create", () => {
    const rows = [
      ["A", "Refunded", "A, Z"],
      ["B", "refunded", "Y"],
      ["C", "Paid", "z"],
    ];
    const created = run(["Name", "Pay", "Tags"], ["c_name", "c_pay", "c_tags"], rows);
    expect(created.summary.unknownOptions).toEqual({ c_pay: ["Refunded"], c_tags: ["Z", "Y"] });
    expect(created.summary.newOptions).toEqual({ c_pay: ["Refunded"], c_tags: ["Z", "Y"] });

    const rejected = run(["Name", "Pay", "Tags"], ["c_name", "c_pay", "c_tags"], rows, {
      unknownOptions: "reject",
    });
    expect(rejected.summary.unknownOptions).toEqual({ c_pay: ["Refunded"], c_tags: ["Z", "Y"] });
    expect(rejected.summary.newOptions).toEqual({});
  });

  it("is empty when every value is known", () => {
    const r = run(["Name", "Pay"], ["c_name", "c_pay"], [["A", "paid"]], { unknownOptions: "reject" });
    expect(r.summary.unknownOptions).toEqual({});
  });

  it("tags reject-policy cells with errorKind unknownOption; valid cells have none", () => {
    const r = run(["Name", "Pay", "Tags"], ["c_name", "c_pay", "c_tags"], [["A", "Refunded", "A, Z"]], {
      unknownOptions: "reject",
    });
    expect(cellOf(r, 0, "c_pay").errorKind).toBe("unknownOption");
    expect(cellOf(r, 0, "c_tags").errorKind).toBe("unknownOption");
    expect(cellOf(r, 0, "c_name").errorKind).toBeUndefined();
    const created = run(["Name", "Pay"], ["c_name", "c_pay"], [["A", "Refunded"]]);
    expect(cellOf(created, 0, "c_pay").errorKind).toBeUndefined();
  });

  it("a required multiSelect whose split yields nothing is errorKind required", () => {
    const cols = makeColumns().map((c) => (c.id === "c_tags" ? { ...c, required: true } : c));
    const r = validateRows(
      { headers: ["Name", "Tags"], rows: [["X", ",;"]], truncated: false },
      [
        { header: "Name", headerIndex: 0, columnId: "c_name", confidence: 1 },
        { header: "Tags", headerIndex: 1, columnId: "c_tags", confidence: 1 },
      ],
      cols,
      makeRegistry(),
      { mode: "create", unknownOptions: "create" },
    );
    expect(cellOf(r, 0, "c_tags").errorKind).toBe("required");
  });
});
