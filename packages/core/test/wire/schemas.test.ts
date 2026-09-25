import { describe, expect, it } from "vitest";
import type { FilterNode } from "../../src/filter/types";
import type { GridQuery } from "../../src/query/types";
import { createFixtureRows } from "../../src/testing/rows";
import { FIXTURE_COLUMN_IDS as C } from "../../src/testing/schema";
import { GRID_OPERATIONS, isGridOperation, OPTIONAL_GRID_OPERATIONS } from "../../src/wire/operations";
import { wireSchemas } from "../../src/wire/schemas";

const spec8: FilterNode = {
  op: "and",
  children: [
    { columnId: C.status, operator: "isNot", value: "paid" },
    { columnId: C.callDate, operator: "isWithin", value: { relative: "yesterday" } },
  ],
};
const query = (over: Partial<GridQuery> = {}): GridQuery => ({
  filter: null,
  sort: [],
  page: { offset: 0, limit: 50 },
  ...over,
});

describe("GRID_OPERATIONS", () => {
  it("lists the DataSource operations in contract order", () => {
    expect(GRID_OPERATIONS).toEqual([
      "fetch",
      "applyChanges",
      "createRows",
      "deleteRows",
      "getChanges",
      "getOptions",
      "createOption",
      "lookup",
      "capabilities",
    ]);
    expect(OPTIONAL_GRID_OPERATIONS).toEqual(["getChanges", "getOptions", "createOption", "lookup"]);
  });

  it("isGridOperation only accepts own operation names", () => {
    expect(isGridOperation("fetch")).toBe(true);
    expect(isGridOperation("lookup")).toBe(true);
    for (const bad of ["toString", "__proto__", "constructor", "Fetch", "", 1, null]) {
      expect(isGridOperation(bad)).toBe(false);
    }
  });

  it("has an input and output schema for every operation", () => {
    for (const op of GRID_OPERATIONS) {
      expect(typeof wireSchemas[op].input.safeParse).toBe("function");
      expect(typeof wireSchemas[op].output.safeParse).toBe("function");
    }
  });
});

describe("wireSchemas inputs", () => {
  it("accepts the spec §8 query and preserves it exactly", () => {
    const q = query({ filter: spec8, sort: [{ columnId: C.name, dir: "asc" }], includeTotal: true });
    const parsed = wireSchemas.fetch.input.safeParse(q);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(q);
  });

  it("accepts every FilterValue shape, cursor paging, search and groupBy", () => {
    const filter: FilterNode = {
      op: "or",
      children: [
        { columnId: C.name, operator: "isEmpty" },
        { columnId: C.status, operator: "isAnyOf", value: ["paid", null] },
        { columnId: C.paid, operator: "between", value: { from: 1, to: 5 } },
        { columnId: C.owner, operator: "isMe", value: { me: true } },
        { columnId: C.isActive, operator: "is", value: true },
        { op: "and", children: [{ columnId: C.callDate, operator: "isWithin", value: { relative: "lastNDays", n: 7 } }] },
      ],
    };
    const q = query({
      filter,
      search: "ann",
      groupBy: [{ columnId: C.status, aggregations: [{ columnId: C.paid, agg: "sum" }] }],
      page: { cursor: "abc", limit: 10 },
    });
    const parsed = wireSchemas.fetch.input.safeParse(q);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(q);
  });

  it("does not limit filter depth (the data source does)", () => {
    const deep: FilterNode = { op: "and", children: [{ op: "or", children: [{ op: "and", children: [] }] }] };
    expect(wireSchemas.fetch.input.safeParse(query({ filter: deep })).success).toBe(true);
  });

  it("rejects malformed queries", () => {
    const bad: unknown[] = [
      null,
      {},
      { ...query(), sort: [{ columnId: "x", dir: "up" }] },
      { ...query(), page: { offset: -1, limit: 10 } },
      { ...query(), page: { offset: 0, limit: 0 } },
      { ...query(), page: { offset: 0, cursor: "c", limit: 10 } },
      { ...query(), filter: { op: "xor", children: [] } },
      { ...query(), filter: { columnId: C.name } },
      { ...query(), filter: { columnId: C.name, operator: "is", value: { relative: "someday" } } },
      { ...query(), groupBy: [{ columnId: C.status, aggregations: [{ columnId: C.paid, agg: "median" }] }] },
    ];
    for (const input of bad) expect(wireSchemas.fetch.input.safeParse(input).success, JSON.stringify(input)).toBe(false);
  });

  it("wraps multi-argument operations in named objects", () => {
    expect(wireSchemas.createRows.input.safeParse({ partials: [{ id: "x", cells: { name: "A" } }, {}] }).success).toBe(true);
    expect(wireSchemas.deleteRows.input.safeParse({ ids: ["r1"] }).success).toBe(true);
    expect(wireSchemas.getChanges.input.safeParse({ since: "0" }).success).toBe(true);
    expect(wireSchemas.getOptions.input.safeParse({ columnId: C.status }).success).toBe(true);
    expect(wireSchemas.getOptions.input.safeParse({ columnId: C.status, search: "pa" }).success).toBe(true);
    expect(wireSchemas.createOption.input.safeParse({ columnId: C.stage, label: "New" }).success).toBe(true);
    expect(wireSchemas.lookup.input.safeParse({ columnId: C.programs, search: "" }).success).toBe(true);
    expect(wireSchemas.deleteRows.input.safeParse(["r1"]).success).toBe(false);
    expect(wireSchemas.lookup.input.safeParse({ columnId: C.programs }).success).toBe(false);
  });

  it("validates change batches including source and baseVersions", () => {
    const batch = {
      id: "b1",
      changes: [{ rowId: "r1", columnId: C.name, prev: "A", next: { nested: [1] } }],
      baseVersions: { r1: 1 },
      source: "paste",
    };
    expect(wireSchemas.applyChanges.input.safeParse(batch).success).toBe(true);
    expect(wireSchemas.applyChanges.input.safeParse({ ...batch, source: "magic" }).success).toBe(false);
    expect(wireSchemas.applyChanges.input.safeParse({ ...batch, baseVersions: { r1: "1" } }).success).toBe(false);
  });
});

describe("wireSchemas outputs", () => {
  it("accepts fixture rows with arbitrary cell values", () => {
    const rows = createFixtureRows();
    const res = wireSchemas.fetch.output.safeParse({ rows, total: rows.length, nextCursor: "n" });
    expect(res.success).toBe(true);
  });

  it("accepts nested group results", () => {
    const groups = [
      {
        columnId: C.status,
        value: "paid",
        key: "paid",
        count: 2,
        aggregates: [{ columnId: C.paid, agg: "sum", value: 10 }],
        children: [{ columnId: C.stage, value: null, key: "", count: 2, aggregates: [] }],
      },
    ];
    expect(wireSchemas.fetch.output.safeParse({ rows: [], groups }).success).toBe(true);
  });

  it("rejects rows without id/version and non-object cells", () => {
    expect(wireSchemas.fetch.output.safeParse({ rows: [{ id: "r1", cells: {} }] }).success).toBe(false);
    expect(
      wireSchemas.fetch.output.safeParse({ rows: [{ id: "r1", version: 1, updatedAt: "x", cells: 3 }] }).success,
    ).toBe(false);
  });

  it("covers change results, feeds, options, link refs and deleteRows", () => {
    expect(
      wireSchemas.applyChanges.output.safeParse({
        applied: [],
        conflicts: [{ rowId: "r1", columnId: C.name, serverValue: "x", serverVersion: 2, updatedAt: "t" }],
        errors: [{ rowId: "r1", columnId: C.name, message: "bad" }],
      }).success,
    ).toBe(true);
    expect(
      wireSchemas.getChanges.output.safeParse({ cursor: "1", rows: [], deletedRowIds: ["r3"], schemaVersion: 1 })
        .success,
    ).toBe(true);
    expect(wireSchemas.getOptions.output.safeParse([{ id: "a", label: "A", color: "red" }]).success).toBe(true);
    expect(wireSchemas.createOption.output.safeParse({ id: "a", label: "A" }).success).toBe(true);
    expect(wireSchemas.lookup.output.safeParse([{ id: "p1", label: "P" }]).success).toBe(true);
    expect(wireSchemas.createRows.output.safeParse([]).success).toBe(true);
    expect(wireSchemas.deleteRows.output.safeParse(null).success).toBe(true);
    expect(wireSchemas.deleteRows.output.safeParse({}).success).toBe(false);
  });
});

describe("wireSchemas.capabilities", () => {
  const full = {
    maxPageSize: 200,
    sort: { columnIds: ["a"] },
    filter: "all",
    operators: { a: ["is"] },
    groupBy: false,
    search: true,
    changeFeed: "updates-only",
    write: { cells: false, createRows: false, deleteRows: false },
    options: true,
    lookup: false,
    export: { maxRows: 10000 },
  };

  it("takes null as input", () => {
    expect(wireSchemas.capabilities.input.safeParse(null).success).toBe(true);
    expect(wireSchemas.capabilities.input.safeParse({}).success).toBe(false);
  });

  it("accepts a full capabilities object and rejects malformed ones", () => {
    const parsed = wireSchemas.capabilities.output.safeParse(full);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(full);
    expect(wireSchemas.capabilities.output.safeParse({ ...full, changeFeed: "sometimes" }).success).toBe(false);
    expect(wireSchemas.capabilities.output.safeParse({ ...full, maxPageSize: 0 }).success).toBe(false);
    expect(wireSchemas.capabilities.output.safeParse({ ...full, sort: "some" }).success).toBe(false);
  });
});
