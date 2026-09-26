import { describe, expect, it } from "vitest";
import type { FilterNode } from "../../src/filter/types";
import type { GridQuery } from "../../src/query/types";
import { createFixtureRows } from "../../src/testing/rows";
import { FIXTURE_COLUMN_IDS as C } from "../../src/testing/schema";
import {
  GRID_OPERATIONS,
  GRID_SCHEMA_OPERATIONS,
  isGridOperation,
  isGridSchemaOperation,
  OPTIONAL_GRID_OPERATIONS,
} from "../../src/wire/operations";
import { createFixtureSchema } from "../../src/testing/schema";
import { wireSchemas } from "../../src/wire/schemas";
import { DEFAULT_CAPABILITIES } from "../../src/datasource/capabilities";

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
  it("lists the DataSource operations plus the grid-level schema operations (order-independent)", () => {
    expect([...GRID_OPERATIONS]).toEqual(
      expect.arrayContaining([
        "fetch",
        "applyChanges",
        "createRows",
        "deleteRows",
        "getChanges",
        "getOptions",
        "createOption",
        "lookup",
        "getRows",
        "capabilities",
        "getSchema",
        "updateSchema",
      ]),
    );
    expect(new Set(GRID_OPERATIONS).size).toBe(GRID_OPERATIONS.length);
    expect([...OPTIONAL_GRID_OPERATIONS]).toEqual(
      expect.arrayContaining(["getChanges", "getOptions", "createOption", "lookup", "getRows"]),
    );
    expect([...GRID_SCHEMA_OPERATIONS].sort()).toEqual(["getSchema", "updateSchema"]);
    for (const op of GRID_SCHEMA_OPERATIONS) expect(GRID_OPERATIONS).toContain(op);
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

  it("carries batch and per-change meta through (v0.3)", () => {
    const batch = {
      id: "b1",
      changes: [{ rowId: "r1", columnId: C.name, prev: "A", next: "B", meta: { decisionMessage: "ok" } }],
      baseVersions: { r1: 1 },
      source: "edit",
      meta: { reuploadDeadline: "2026-10-01" },
    };
    const parsed = wireSchemas.applyChanges.input.safeParse(batch);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(batch);
    expect(wireSchemas.applyChanges.input.safeParse({ ...batch, meta: "nope" }).success).toBe(false);
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
    const withRejected = {
      applied: [{ rowId: "r1", columnId: C.name, prev: "A", next: "B", meta: { note: 1 } }],
      conflicts: [{ rowId: "r2", columnId: C.name, serverValue: "x", serverVersion: 2, updatedAt: "t", meta: { note: 2 } }],
      errors: [],
      rejected: [{ rowId: "r3", columnId: C.name, prev: "A", next: "B" }],
    };
    const parsedRejected = wireSchemas.applyChanges.output.safeParse(withRejected);
    expect(parsedRejected.success).toBe(true);
    expect(parsedRejected.data).toEqual(withRejected);
    expect(
      wireSchemas.getChanges.output.safeParse({ cursor: "1", rows: [], deletedRowIds: ["r3"], schemaVersion: 1 })
        .success,
    ).toBe(true);
    expect(wireSchemas.getOptions.output.safeParse([{ id: "a", label: "A", color: "red" }]).success).toBe(true);
    expect(wireSchemas.getOptions.output.safeParse([{ id: "a", label: "A", settableBy: { roles: ["admin"] } }]).success).toBe(true);
    expect(wireSchemas.getOptions.output.safeParse([{ id: "a", label: "A", settableBy: "some" }]).success).toBe(false);
    expect(wireSchemas.createOption.output.safeParse({ id: "a", label: "A" }).success).toBe(true);
    expect(wireSchemas.lookup.output.safeParse([{ id: "p1", label: "P" }]).success).toBe(true);
    expect(wireSchemas.createRows.output.safeParse([]).success).toBe(true);
    expect(wireSchemas.deleteRows.output.safeParse(null).success).toBe(true);
    expect(wireSchemas.deleteRows.output.safeParse({}).success).toBe(false);
  });
});

describe("grid schema operations", () => {
  it("isGridSchemaOperation only accepts getSchema / updateSchema", () => {
    expect(isGridSchemaOperation("getSchema")).toBe(true);
    expect(isGridSchemaOperation("updateSchema")).toBe(true);
    for (const bad of ["fetch", "toString", "__proto__", "", null]) expect(isGridSchemaOperation(bad)).toBe(false);
  });

  it("getSchema takes null (or nothing) and answers a GridSchema", () => {
    expect(wireSchemas.getSchema.input.safeParse(null).success).toBe(true);
    expect(wireSchemas.getSchema.input.safeParse(undefined).success).toBe(true);
    expect(wireSchemas.getSchema.input.safeParse({ x: 1 }).success).toBe(false);
    const schema = createFixtureSchema();
    const parsed = wireSchemas.getSchema.output.safeParse(schema);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(schema);
  });

  it("updateSchema takes the GridSchema itself and keeps unknown column/view keys", () => {
    const schema = createFixtureSchema();
    const withExtras = {
      ...schema,
      columns: schema.columns.map((c, i) => (i === 0 ? { ...c, sortable: false, settable: false } : c)),
    };
    const parsed = wireSchemas.updateSchema.input.safeParse(withExtras);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(withExtras);
    expect(wireSchemas.updateSchema.output.safeParse(schema).success).toBe(true);
  });

  it("updateSchema rejects structurally broken schemas", () => {
    const schema = createFixtureSchema();
    for (const bad of [
      null,
      { ...schema, columns: "nope" },
      { ...schema, schemaVersion: "1" },
      { ...schema, id: undefined },
      { ...schema, columns: [{ id: "x" }] },
    ]) {
      expect(wireSchemas.updateSchema.input.safeParse(bad).success).toBe(false);
    }
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

  it("takes the v0.3 schema flags and tolerates a v0.2 answer without them", () => {
    const withSchema = { ...full, schema: { read: true, write: true } };
    const parsed = wireSchemas.capabilities.output.safeParse(withSchema);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(withSchema);
    expect(wireSchemas.capabilities.output.safeParse({ ...full, schema: { read: true } }).success).toBe(false);
  });
});

describe("v0.3.1 wire additions", () => {
  const row = { id: "r1", version: 2, updatedAt: "2026-09-24T21:00:00.000Z", cells: { name: "A" } };

  it("getRows takes { ids } and answers GridRow[]", () => {
    expect(wireSchemas.getRows.input.safeParse({ ids: ["r1", "r2"] }).success).toBe(true);
    expect(wireSchemas.getRows.input.safeParse({ ids: "r1" }).success).toBe(false);
    expect(wireSchemas.getRows.input.safeParse(null).success).toBe(false);
    expect(wireSchemas.getRows.output.safeParse([row]).success).toBe(true);
    expect(wireSchemas.getRows.output.safeParse([{ id: "r1" }]).success).toBe(false);
  });

  it("ChangeResult.rows passes through and stays optional", () => {
    const base = { applied: [], conflicts: [], errors: [] };
    expect(wireSchemas.applyChanges.output.safeParse(base).success).toBe(true);
    const parsed = wireSchemas.applyChanges.output.safeParse({ ...base, rows: [row] });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.rows).toEqual([row]);
    expect(wireSchemas.applyChanges.output.safeParse({ ...base, rows: [{ id: "r1" }] }).success).toBe(false);
  });

  it("ChangeBatch.resubmitOf passes through and stays optional", () => {
    const batch = { id: "b2", changes: [], baseVersions: {}, source: "edit" as const };
    expect(wireSchemas.applyChanges.input.safeParse(batch).success).toBe(true);
    const parsed = wireSchemas.applyChanges.input.safeParse({ ...batch, resubmitOf: "b1" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.resubmitOf).toBe("b1");
    expect(wireSchemas.applyChanges.input.safeParse({ ...batch, resubmitOf: 7 }).success).toBe(false);
  });

  it("Option.settableMessage survives getOptions / createOption", () => {
    const option = { id: "x", label: "X", settableBy: { roles: [] }, settableMessage: "Set by the AI pipeline" };
    const parsed = wireSchemas.getOptions.output.safeParse([option]);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data[0]).toEqual(option);
    expect(wireSchemas.createOption.output.safeParse(option).success).toBe(true);
  });

  it("capabilities.schema.reason passes through (optional)", () => {
    const caps = {
      ...DEFAULT_CAPABILITIES,
      schema: { read: true, write: false, reason: "store-unavailable" as const },
    };
    const parsed = wireSchemas.capabilities.output.safeParse(caps);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.schema).toEqual({ read: true, write: false, reason: "store-unavailable" });
    expect(wireSchemas.capabilities.output.safeParse({ ...caps, schema: { read: true, write: false, reason: "nope" } }).success).toBe(false);
  });
});
