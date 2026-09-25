import { describe, expect, it } from "vitest";
import { chunkRows, keyOf, toChangeBatches } from "../src/import/change-batches";
import type {
  ColumnMapping,
  ImportMode,
  ParsedTable,
  ValidationReport,
} from "../src/import/types";
import { validateRows } from "../src/import/validate";
import type { GridRow } from "../src/internal/core";
import { makeRegistry } from "./helpers/registry";
import { getColumn, makeRow, makeSchema } from "./helpers/schema";

const registry = makeRegistry();
const schema = makeSchema();
const emailCol = getColumn("c_email");

function report(
  headers: string[],
  columnIds: (string | null)[],
  rows: string[][],
  mode: ImportMode,
  unknownOptions: "create" | "reject" = "reject",
): ValidationReport {
  const parsed: ParsedTable = { headers, rows, truncated: false };
  const mapping: ColumnMapping[] = headers.map((header, headerIndex) => ({
    header,
    headerIndex,
    columnId: columnIds[headerIndex] ?? null,
    confidence: 1,
  }));
  return validateRows(parsed, mapping, schema, registry, {
    mode,
    unknownOptions,
    ...(mode === "create" ? {} : { keyColumnId: "c_email" }),
  });
}

function byEmail(rows: GridRow[]): Map<string, GridRow> {
  return new Map(rows.map((r) => [keyOf(r.cells.email, emailCol, registry), r]));
}

let seq = 0;
const idFactory = () => `b${++seq}`;

function plan(
  r: ValidationReport,
  existing: GridRow[],
  mode: ImportMode,
  chunkSize?: number,
) {
  return toChangeBatches(r, byEmail(existing), {
    schema,
    registry,
    mode,
    ...(mode === "create" ? {} : { keyColumnId: "c_email" }),
    ...(chunkSize === undefined ? {} : { chunkSize }),
    idFactory,
  });
}

describe("keyOf", () => {
  it("is case- and whitespace-insensitive", () => {
    expect(keyOf("  ASHA@Example.com ", emailCol, registry)).toBe(
      keyOf("asha@example.com", emailCol, registry),
    );
    expect(keyOf("asha@example.com", emailCol, registry)).toBe("asha@example.com");
  });

  it("returns an empty string for null/undefined", () => {
    expect(keyOf(null, emailCol, registry)).toBe("");
    expect(keyOf(undefined, emailCol, registry)).toBe("");
  });

  it("falls back to String(value) for an unknown field type", () => {
    const col = { ...emailCol, type: "mystery" };
    expect(keyOf(" AbC ", col, registry)).toBe("abc");
  });

  it("a file key with different case matches an existing row", () => {
    const existing = [makeRow({ email: "asha@example.com", name: "Old" })];
    const r = report(["Email", "Name"], ["c_email", "c_name"], [["  ASHA@Example.com ", "New"]], "update");
    const p = plan(r, existing, "update");
    expect(p.rejected).toEqual([]);
    expect(p.updates).toHaveLength(1);
  });
});

describe("chunkRows", () => {
  it("splits 1201 items into 500/500/201", () => {
    const items = Array.from({ length: 1201 }, (_, i) => i);
    expect(chunkRows(items).map((c) => c.length)).toEqual([500, 500, 201]);
  });

  it("honours a custom size and returns [] for no items", () => {
    expect(chunkRows([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
    expect(chunkRows([])).toEqual([]);
  });

  it("throws RangeError for size < 1", () => {
    expect(() => chunkRows([1], 0)).toThrow(RangeError);
  });
});

describe("toChangeBatches: create", () => {
  it("keys cells by column.key and includes empty cells as null", () => {
    const r = report(
      ["Name", "Pay", "Amount"],
      ["c_name", "c_pay", "c_amount"],
      [["Asha", "Paid", ""]],
      "create",
    );
    const p = plan(r, [], "create");
    expect(p.creates).toEqual([
      { cells: { name: "Asha", paymentStatus: "opt_paid", amount: null } },
    ]);
    expect(p.createSourceRows).toEqual([2]);
    expect(p.updates).toEqual([]);
  });

  it("invalid rows go to rejected with sourceRow and columnId", () => {
    const r = report(
      ["Name", "Amount"],
      ["c_name", "c_amount"],
      [
        ["Asha", "1"],
        ["", "abc"],
      ],
      "create",
    );
    const p = plan(r, [], "create");
    expect(p.creates).toHaveLength(1);
    expect(p.rejected).toEqual([
      { sourceRow: 3, columnId: "c_name", message: "Required" },
      { sourceRow: 3, columnId: "c_amount", message: expect.stringMatching(/number/i) },
    ]);
  });
});

describe("toChangeBatches: update", () => {
  it("an update identical to the existing row is left out", () => {
    const existing = [makeRow({ email: "a@x.com", name: "Asha", tags: ["tag_a", "tag_b"] })];
    const r = report(
      ["Email", "Name", "Tags"],
      ["c_email", "c_name", "c_tags"],
      [["a@x.com", "Asha", "a; B"]],
      "update",
    );
    const p = plan(r, existing, "update");
    expect(p.updates).toEqual([]);
    expect(p.rejected).toEqual([]);
    expect(p.updateSourceRows).toEqual({});
  });

  it("one changed column gives a single CellChange with prev/next and baseVersions", () => {
    const row = makeRow({ email: "a@x.com", name: "Asha", amount: 10 }, { version: 7 });
    const r = report(
      ["Email", "Name", "Amount"],
      ["c_email", "c_name", "c_amount"],
      [["a@x.com", "Asha", "12.5"]],
      "update",
    );
    const p = plan(r, [row], "update");
    expect(p.updates).toHaveLength(1);
    const batch = p.updates[0];
    expect(batch?.changes).toEqual([
      { rowId: row.id, columnId: "c_amount", prev: 10, next: 12.5 },
    ]);
    expect(batch?.baseVersions).toEqual({ [row.id]: 7 });
    expect(batch?.source).toBe("import");
    expect(p.updateSourceRows).toEqual({ [row.id]: 2 });
  });

  it("skipped (empty) cells are not emitted", () => {
    const row = makeRow({ email: "a@x.com", name: "Asha", amount: 10 });
    const r = report(
      ["Email", "Name", "Amount"],
      ["c_email", "c_name", "c_amount"],
      [["a@x.com", "", "10"]],
      "update",
    );
    expect(plan(r, [row], "update").updates).toEqual([]);
  });

  it("treats null, undefined and empty string as equal-empty", () => {
    const row = makeRow({ email: "a@x.com", name: "Asha" });
    const r = report(
      ["Email", "Tags"],
      ["c_email", "c_tags"],
      [["a@x.com", ",;"]],
      "update",
    );
    expect(plan(r, [row], "update").updates).toEqual([]);
  });

  it("update: unknown key is rejected; upsert: the same row is created", () => {
    const existing = [makeRow({ email: "a@x.com", name: "Asha" })];
    const rows = [["nobody@x.com", "Zed"]];

    const u = plan(report(["Email", "Name"], ["c_email", "c_name"], rows, "update"), existing, "update");
    expect(u.rejected).toEqual([
      { sourceRow: 2, columnId: "c_email", message: "No existing row for key" },
    ]);
    expect(u.creates).toEqual([]);

    const up = plan(report(["Email", "Name"], ["c_email", "c_name"], rows, "upsert"), existing, "upsert");
    expect(up.rejected).toEqual([]);
    expect(up.creates).toEqual([{ cells: { email: "nobody@x.com", name: "Zed" } }]);
    expect(up.createSourceRows).toEqual([2]);
  });

  it("upsert: found key updates, empty key creates", () => {
    const row = makeRow({ email: "a@x.com", name: "Asha" });
    const r = report(
      ["Email", "Name"],
      ["c_email", "c_name"],
      [
        ["a@x.com", "Asha K"],
        ["", "New Person"],
      ],
      "upsert",
    );
    const p = plan(r, [row], "upsert");
    expect(p.updates[0]?.changes).toEqual([
      { rowId: row.id, columnId: "c_name", prev: "Asha", next: "Asha K" },
    ]);
    expect(p.creates).toEqual([{ cells: { email: null, name: "New Person" } }]);
    expect(p.createSourceRows).toEqual([3]);
  });

  it("never emits a change for the key column", () => {
    const row = makeRow({ email: "A@x.com", name: "Asha" });
    const r = report(["Email"], ["c_email"], [["a@x.com"]], "update");
    expect(plan(r, [row], "update").updates).toEqual([]);
  });
});

describe("toChangeBatches: batching", () => {
  function bulk(n: number) {
    const existing: GridRow[] = [];
    const rows: string[][] = [];
    for (let i = 0; i < n; i++) {
      existing.push(makeRow({ email: `u${i}@x.com`, name: `Old ${i}` }));
      rows.push([`u${i}@x.com`, `New ${i}`]);
    }
    return { existing, r: report(["Email", "Name"], ["c_email", "c_name"], rows, "update") };
  }

  it("1201 valid update rows give batches of 500/500/201 distinct rows", () => {
    const { existing, r } = bulk(1201);
    const p = plan(r, existing, "update");
    expect(p.updates.map((b) => Object.keys(b.baseVersions).length)).toEqual([500, 500, 201]);
    expect(p.updates.map((b) => new Set(b.changes.map((c) => c.rowId)).size)).toEqual([
      500, 500, 201,
    ]);
    expect(p.updates.every((b) => b.source === "import")).toBe(true);
    expect(new Set(p.updates.map((b) => b.id)).size).toBe(3);
    expect(Object.keys(p.updateSourceRows)).toHaveLength(1201);
  });

  it("chunkSize 2 is honoured and keeps a row's changes in one batch", () => {
    const existing = [0, 1, 2].map((i) =>
      makeRow({ email: `u${i}@x.com`, name: `Old ${i}`, amount: 1 }),
    );
    const r = report(
      ["Email", "Name", "Amount"],
      ["c_email", "c_name", "c_amount"],
      [0, 1, 2].map((i) => [`u${i}@x.com`, `New ${i}`, "2"]),
      "update",
    );
    const p = plan(r, existing, "update", 2);
    expect(p.updates.map((b) => b.changes.length)).toEqual([4, 2]);
    expect(p.updates.map((b) => Object.keys(b.baseVersions).length)).toEqual([2, 1]);
    expect(p.updates.every((b) => b.source === "import")).toBe(true);
  });
});

describe("toChangeBatches: review fixes", () => {
  function one(
    headers: string[],
    columnIds: string[],
    row: string[],
    existing: GridRow[],
    mode: ImportMode = "update",
  ) {
    return plan(report(headers, columnIds, [row], mode), existing, mode);
  }

  it("upsert with an unknown key and empty required name is rejected, not created", () => {
    const p = one(["Email", "Name"], ["c_email", "c_name"], ["new@x.com", ""], [], "upsert");
    expect(p.creates).toEqual([]);
    expect(p.rejected).toEqual([{ sourceRow: 2, columnId: "c_name", message: "Required" }]);
  });

  it("key-only upsert with an unknown key is rejected for the unmapped required name", () => {
    const p = one(["Email"], ["c_email"], ["new@x.com"], [], "upsert");
    expect(p.creates).toEqual([]);
    expect(p.rejected).toEqual([{ sourceRow: 2, columnId: "c_name", message: "Required" }]);
  });

  it("upsert create writes skipped mapped cells as null", () => {
    const p = one(
      ["Email", "Name", "Amount"],
      ["c_email", "c_name", "c_amount"],
      ["new@x.com", "Zed", ""],
      [],
      "upsert",
    );
    expect(p.creates).toEqual([{ cells: { email: "new@x.com", name: "Zed", amount: null } }]);
  });

  it("multiSelect with the same ids in a different order is a no-op", () => {
    const row = makeRow({ email: "a@x.com", tags: ["tag_b", "tag_a"] });
    const p = one(["Email", "Tags"], ["c_email", "c_tags"], ["a@x.com", "A, B"], [row]);
    expect(p.updates).toEqual([]);
    expect(p.unchangedSourceRows).toEqual([2]);
  });

  it("boolean false over null is a change; true over true is not", () => {
    const a = makeRow({ email: "a@x.com", active: null });
    const pa = one(["Email", "Active"], ["c_email", "c_active"], ["a@x.com", "no"], [a]);
    expect(pa.updates[0]?.changes).toEqual([
      { rowId: a.id, columnId: "c_active", prev: null, next: false },
    ]);

    const b = makeRow({ email: "b@x.com", active: true });
    const pb = one(["Email", "Active"], ["c_email", "c_active"], ["b@x.com", "yes"], [b]);
    expect(pb.updates).toEqual([]);
  });

  it("datetime ...Z vs ....000Z is a no-op", () => {
    const row = makeRow({ email: "a@x.com", lastCall: "2026-09-25T05:00:00Z" });
    const p = one(
      ["Email", "Last Call"],
      ["c_email", "c_call"],
      ["a@x.com", "2026-09-25T05:00:00.000Z"],
      [row],
    );
    expect(p.updates).toEqual([]);
  });

  it("user with the same id but a different name is a no-op", () => {
    const row = makeRow({ email: "a@x.com", owner: { id: "u1", name: "Ravi" } });
    const p = one(["Email", "Owner"], ["c_email", "c_owner"], ["a@x.com", "u1"], [row]);
    expect(p.updates).toEqual([]);
  });

  it('text "" vs null is a no-op', () => {
    const row = makeRow({ email: "a@x.com", note: null });
    const r: ValidationReport = {
      rows: [
        {
          index: 0,
          sourceRow: 2,
          cells: {
            c_email: { value: "a@x.com", raw: "a@x.com" },
            c_note: { value: "", raw: "x" },
          },
        },
      ],
      summary: { valid: 1, invalid: 0, newOptions: {}, unmappedRequired: [] },
    };
    const p = plan(r, [row], "update");
    expect(p.updates).toEqual([]);
    expect(p.unchangedSourceRows).toEqual([2]);
  });

  it("a row with a cell error and a rowError gives two rejections", () => {
    const existing = [makeRow({ email: "a@x.com", amount: 1 })];
    const r = report(
      ["Email", "Amount"],
      ["c_email", "c_amount"],
      [
        ["a@x.com", "2"],
        ["a@x.com", "abc"],
      ],
      "update",
    );
    const p = plan(r, existing, "update");
    expect(p.rejected).toEqual([
      { sourceRow: 3, columnId: "c_amount", message: expect.stringMatching(/number/i) },
      { sourceRow: 3, message: "Duplicate key (first seen on row 2)" },
    ]);
  });

  it("a new creatableSelect label in update: next is the raw label, newOptions holds it", () => {
    const row = makeRow({ email: "a@x.com", stage: "stage_new" });
    const r = report(["Email", "Stage"], ["c_email", "c_stage"], [["a@x.com", "Lost"]], "update", "create");
    expect(r.summary.newOptions).toEqual({ c_stage: ["Lost"] });
    const p = plan(r, [row], "update");
    expect(p.updates[0]?.changes).toEqual([
      { rowId: row.id, columnId: "c_stage", prev: "stage_new", next: "Lost" },
    ]);
  });

  it("baseVersions excludes elided rows in a mixed chunk", () => {
    const same = makeRow({ email: "a@x.com", name: "Asha" });
    const diff = makeRow({ email: "b@x.com", name: "Old" });
    const r = report(
      ["Email", "Name"],
      ["c_email", "c_name"],
      [
        ["a@x.com", "Asha"],
        ["b@x.com", "New"],
      ],
      "update",
    );
    const p = plan(r, [same, diff], "update");
    expect(p.updates).toHaveLength(1);
    expect(p.updates[0]?.baseVersions).toEqual({ [diff.id]: diff.version });
    expect(p.updateSourceRows).toEqual({ [diff.id]: 3 });
    expect(p.unchangedSourceRows).toEqual([2]);
  });

  it("chunkSize < 1 throws RangeError", () => {
    const r = report(["Name"], ["c_name"], [["A"]], "create");
    expect(() => plan(r, [], "create", 0)).toThrow(RangeError);
  });

  it("the default idFactory gives unique ids", () => {
    const existing = [0, 1, 2].map((i) => makeRow({ email: `u${i}@x.com`, name: "Old" }));
    const r = report(
      ["Email", "Name"],
      ["c_email", "c_name"],
      [0, 1, 2].map((i) => [`u${i}@x.com`, "New"]),
      "update",
    );
    const p = toChangeBatches(r, byEmail(existing), {
      schema,
      registry,
      mode: "update",
      keyColumnId: "c_email",
      chunkSize: 1,
    });
    const ids = p.updates.map((b) => b.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
  });
});
