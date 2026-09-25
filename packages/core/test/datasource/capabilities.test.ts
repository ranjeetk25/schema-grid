import { describe, expect, it } from "vitest";
import {
  applyEffectiveCapabilities,
  DEFAULT_CAPABILITIES,
  type DataSourceCapabilities,
  getDataSourceCapabilities,
  inferCapabilities,
  mergeCapabilities,
  normalizeCapabilities,
} from "../../src/datasource/capabilities";
import type { DataSource } from "../../src/datasource/types";
import type { GridRow } from "../../src/rows/types";
import type { GridSchema } from "../../src/schema/types";
import { createFixtureSchema, FIXTURE_COLUMN_IDS as C } from "../../src/testing/schema";

function minimal(overrides: Partial<DataSource<GridRow>> = {}): DataSource<GridRow> {
  return {
    fetch: async () => ({ rows: [] }),
    applyChanges: async () => ({ applied: [], conflicts: [], errors: [] }),
    createRows: async () => [],
    deleteRows: async () => undefined,
    ...overrides,
  };
}

const caps = (over: Partial<DataSourceCapabilities> = {}): DataSourceCapabilities => ({ ...DEFAULT_CAPABILITIES, ...over });

describe("DEFAULT_CAPABILITIES", () => {
  it("allows everything with a 500 row page cap", () => {
    expect(DEFAULT_CAPABILITIES).toEqual({
      maxPageSize: 500,
      sort: "all",
      filter: "all",
      groupBy: true,
      search: true,
      changeFeed: true,
      write: { cells: true, createRows: true, deleteRows: true },
      options: true,
      lookup: true,
      export: {},
    });
    expect(Object.isFrozen(DEFAULT_CAPABILITIES)).toBe(true);
  });
});

describe("normalizeCapabilities", () => {
  it("fills a partial from the defaults, merging write field by field", () => {
    expect(normalizeCapabilities({ maxPageSize: 200, write: { cells: false } as never })).toEqual({
      ...DEFAULT_CAPABILITIES,
      maxPageSize: 200,
      write: { cells: false, createRows: true, deleteRows: true },
    });
  });

  it("accepts the updates-only change feed", () => {
    expect(normalizeCapabilities({ changeFeed: "updates-only" }).changeFeed).toBe("updates-only");
  });
});

describe("inferCapabilities", () => {
  it("derives the optional-operation flags from what the source implements", () => {
    expect(inferCapabilities(minimal())).toEqual({
      ...DEFAULT_CAPABILITIES,
      changeFeed: false,
      options: false,
      lookup: false,
    });
    const full = minimal({ getChanges: async () => ({ cursor: "0", rows: [], deletedRowIds: [], schemaVersion: 1 }), getOptions: async () => [], lookup: async () => [] });
    expect(inferCapabilities(full)).toEqual(DEFAULT_CAPABILITIES);
  });
});

describe("getDataSourceCapabilities", () => {
  it("uses capabilities() when present (sync or async) and normalises it", async () => {
    expect(await getDataSourceCapabilities(minimal({ capabilities: () => caps({ groupBy: false }) }))).toMatchObject({
      groupBy: false,
    });
    expect(await getDataSourceCapabilities(minimal({ capabilities: async () => caps({ search: false }) }))).toMatchObject({
      search: false,
    });
  });

  it("falls back to inferCapabilities when the source has none", async () => {
    expect(await getDataSourceCapabilities(minimal())).toEqual(inferCapabilities(minimal()));
  });
});

describe("mergeCapabilities", () => {
  const schema: GridSchema = createFixtureSchema();

  it("with default caps, every non-formula column is sortable/filterable/settable", () => {
    const eff = mergeCapabilities(schema, DEFAULT_CAPABILITIES);
    expect(eff.columns[C.name]).toEqual({ sortable: true, filterable: true, settable: true });
    expect(eff.groupBy).toBe(true);
    expect(eff.search).toBe(true);
    expect(eff.maxPageSize).toBe(500);
    expect(eff.write).toEqual({ cells: true, createRows: true, deleteRows: true });
  });

  it("intersects column options with the source's sort/filter lists", () => {
    const s: GridSchema = {
      ...schema,
      columns: schema.columns.map((c) =>
        c.id === C.name ? { ...c, sortable: false } : c.id === C.fee ? { ...c, filterable: false, settable: false } : c,
      ),
    };
    const eff = mergeCapabilities(
      s,
      caps({ sort: { columnIds: [C.name, C.fee] }, filter: { columnIds: [C.fee, C.status] }, operators: { [C.status]: ["is"] } }),
    );
    expect(eff.columns[C.name]).toEqual({ sortable: false, filterable: false, settable: true });
    expect(eff.columns[C.fee]).toEqual({ sortable: true, filterable: false, settable: false });
    expect(eff.columns[C.status]).toEqual({ sortable: false, filterable: true, settable: true, operators: ["is"] });
  });

  it("write.cells:false makes every column unsettable", () => {
    const eff = mergeCapabilities(schema, caps({ write: { cells: false, createRows: false, deleteRows: false } }));
    expect(Object.values(eff.columns).every((c) => !c.settable)).toBe(true);
  });

  it("formula columns are never settable", () => {
    const first = schema.columns[0];
    if (!first) throw new Error("fixture has columns");
    const s: GridSchema = {
      ...schema,
      columns: [...schema.columns, { ...first, id: "f", key: "f", type: "formula", formula: "1" }],
    };
    expect(mergeCapabilities(s, DEFAULT_CAPABILITIES).columns.f?.settable).toBe(false);
  });
});

describe("applyEffectiveCapabilities", () => {
  const schema: GridSchema = createFixtureSchema();

  it("returns the same schema object when nothing is restricted", () => {
    expect(applyEffectiveCapabilities(schema, mergeCapabilities(schema, DEFAULT_CAPABILITIES))).toBe(schema);
  });

  it("writes the effective restrictions onto the column options", () => {
    const out = applyEffectiveCapabilities(
      schema,
      mergeCapabilities(schema, caps({ sort: { columnIds: [] }, write: { cells: false, createRows: true, deleteRows: true } })),
    );
    expect(out).not.toBe(schema);
    const name = out.columns.find((c) => c.id === C.name);
    expect(name).toMatchObject({ sortable: false, settable: false });
    expect(name?.filterable).toBeUndefined();
  });
});
