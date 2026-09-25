import { describe, expect, expectTypeOf, it } from "vitest";
import type { DataSource, RowPartial } from "../../src/datasource/types";
import type { GridEventName, GridEvents } from "../../src/events/types";
import type { GridRow } from "../../src/rows/types";
import type { QueryResult } from "../../src/query/types";

describe("DataSource", () => {
  it("an object with only the four required methods satisfies DataSource", () => {
    const ds: DataSource = {
      fetch: async () => ({ rows: [] }),
      applyChanges: async () => ({ applied: [], conflicts: [], errors: [] }),
      createRows: async (partials) => partials.map((p, i) => ({
        id: p.id ?? String(i),
        version: 1,
        updatedAt: "2026-01-01T00:00:00.000Z",
        cells: { ...(p.cells ?? {}) },
      })),
      deleteRows: async () => undefined,
    };
    expect(ds).toBeDefined();
    expectTypeOf(ds).toMatchTypeOf<DataSource>();
  });

  it("beforeCellsChange must return a Promise; a synchronous return is a type error", () => {
    const events: GridEvents = {
      beforeCellsChange: async (batch) => batch,
    };
    expect(events).toBeDefined();

    const bad: GridEvents = {
      // @ts-expect-error beforeCellsChange must be async / return a Promise
      beforeCellsChange: (batch) => batch,
    };
    expect(bad).toBeDefined();
  });

  it("DataSource of a custom row type propagates Row into fetch's QueryResult", () => {
    interface MyRow extends GridRow {
      extra: string;
    }
    type MyFetch = DataSource<MyRow>["fetch"];
    expectTypeOf<Awaited<ReturnType<MyFetch>>>().toEqualTypeOf<QueryResult<MyRow>>();

    type MyPartial = RowPartial<MyRow>;
    expectTypeOf<MyPartial["cells"]>().toEqualTypeOf<Partial<MyRow["cells"]> | undefined>();
  });

  it("GridEventName includes the spec event names", () => {
    type Expected =
      | "beforeCellsChange"
      | "onCellsChange"
      | "onRowsCreate"
      | "onRowsDelete"
      | "onColumnCreate"
      | "onColumnUpdate"
      | "onColumnDelete"
      | "onOptionCreate"
      | "onViewChange"
      | "onConflict"
      | "onRemoteChanges";
    expectTypeOf<GridEventName>().toEqualTypeOf<Expected>();
  });
});
