import { act, render, renderHook, waitFor } from "@testing-library/react";
import type { CellEditRequestEvent, ColDef, GridApi } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { describe, expect, it, vi } from "vitest";
import { SCHEMA_GRID_CLIENT_MODULES, SCHEMA_GRID_INFINITE_MODULES } from "../../src/agModules";
import { type SchemaGridProps, type UseSchemaGridResult, useSchemaGrid } from "../../src/grid/useSchemaGrid";
import type { GridRow, IoExportOptions, ViewDef } from "../../src/internal/core";
import { createInMemoryDataSource } from "../fixtures/dataSource";
import { ADMIN, AGENT, fixtureRows, fixtureSchema } from "../fixtures/schema";

function baseProps(overrides: Partial<SchemaGridProps<GridRow>> = {}): SchemaGridProps<GridRow> {
  return {
    schema: fixtureSchema,
    dataSource: createInMemoryDataSource(fixtureSchema, fixtureRows),
    user: ADMIN,
    ...overrides,
  };
}

/** Lets AG Grid's timers and our microtasks drain. */
async function settle(ms = 60): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

/** renderHook with props created once (a fresh data source per render would reload forever). */
function renderStable(props: SchemaGridProps<GridRow>) {
  return renderHook(() => useSchemaGrid(props));
}

function colIds(defs: unknown): string[] {
  return ((defs ?? []) as ColDef[]).map((d) => d.colId ?? "");
}

function rowIds(rows: unknown): string[] {
  return ((rows ?? []) as GridRow[]).map((r) => r.id);
}

/** Mounts a real AgGridReact over the hook's gridProps (autoHeight, no virtualisation). */
function mountGrid(props: SchemaGridProps<GridRow>) {
  const ref: { current: UseSchemaGridResult<GridRow> | null } = { current: null };
  function Harness(p: { props: SchemaGridProps<GridRow> }) {
    const result = useSchemaGrid(p.props);
    ref.current = result;
    return (
      <div style={{ width: 1200, height: 600 }}>
        <AgGridReact {...result.gridProps} />
      </div>
    );
  }
  const merged: SchemaGridProps<GridRow> = {
    ...props,
    gridOptions: { domLayout: "autoHeight", suppressColumnVirtualisation: true, ...props.gridOptions },
  };
  const utils = render(<Harness props={merged} />);
  const current = () => {
    if (!ref.current) throw new Error("hook not rendered");
    return ref.current;
  };
  const ready = async (): Promise<GridApi<GridRow>> => {
    let api: GridApi<GridRow> | null = null;
    await waitFor(() => {
      api = current().api();
      expect(api).not.toBeNull();
    });
    return api as unknown as GridApi<GridRow>;
  };
  return { ...utils, current, ready };
}

describe("useSchemaGrid — client mode", () => {
  it("pages through dataSource.fetch until done and exposes all rows as rowData", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, fixtureRows);
    const { result } = renderStable(baseProps({ dataSource: ds, pageSize: 2 }));
    expect(result.current.loadState).toBe("loading");
    await waitFor(() => expect(rowIds(result.current.gridProps.rowData)).toHaveLength(4));
    await waitFor(() => expect(result.current.loadState).toBe("idle"));
    expect(ds.calls.fetch.mock.calls.length).toBeGreaterThanOrEqual(2);
    const first = ds.calls.fetch.mock.calls[0]?.[0] as { page: { offset: number; limit: number }; includeTotal?: boolean };
    expect(first.page).toEqual({ offset: 0, limit: 2 });
    expect(first.includeTotal).toBe(true);
    expect(result.current.gridProps.rowModelType ?? "clientSide").toBe("clientSide");
    expect(result.current.gridProps.readOnlyEdit).toBe(true);
    expect(result.current.stores.rows.all()).toHaveLength(4);
  });

  it("re-derives rowData from a query-store filter change without refetching", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, fixtureRows);
    const { result } = renderStable(baseProps({ dataSource: ds }));
    await waitFor(() => expect(rowIds(result.current.gridProps.rowData)).toHaveLength(4));
    const fetches = ds.calls.fetch.mock.calls.length;

    act(() => {
      result.current.stores.query.setFilter({ columnId: "payment", operator: "is", value: "paid" });
    });
    await waitFor(() => expect(rowIds(result.current.gridProps.rowData)).toEqual(["r1"]));

    act(() => {
      result.current.stores.query.setSort([{ columnId: "score", dir: "desc" }]);
      result.current.stores.query.setFilter(null);
    });
    await waitFor(() => expect(rowIds(result.current.gridProps.rowData)).toEqual(["r4", "r1", "r2", "r3"]));
    expect(ds.calls.fetch.mock.calls.length).toBe(fetches);
  });

  it("combines externalFilter with the query filter", async () => {
    const { result } = renderStable(baseProps({ externalFilter: { columnId: "status", operator: "is", value: "open" } }));
    await waitFor(() => expect(rowIds(result.current.gridProps.rowData)).toEqual(["r1", "r3"]));
  });

  it("builds group display rows when groupBy is set", async () => {
    const { result } = renderStable(baseProps());
    await waitFor(() => expect(rowIds(result.current.gridProps.rowData)).toHaveLength(4));
    act(() => result.current.stores.query.setGroupBy([{ columnId: "status" }]));
    await waitFor(() => {
      const rows = (result.current.gridProps.rowData ?? []) as { __sg?: string }[];
      expect(rows.filter((r) => r.__sg === "group")).toHaveLength(3);
    });
  });

  it("omits access-hidden columns from columnDefs", () => {
    const agent = renderStable(baseProps({ user: AGENT }));
    expect(colIds(agent.result.current.gridProps.columnDefs)).not.toContain("salary");
    expect(agent.result.current.access.get("salary")).toBe("hidden");
    const admin = renderStable(baseProps({ user: ADMIN }));
    expect(colIds(admin.result.current.gridProps.columnDefs)).toContain("salary");
  });

  it("uses the client module set", () => {
    const { result } = renderStable(baseProps());
    expect(result.current.gridProps.modules).toEqual([...SCHEMA_GRID_CLIENT_MODULES]);
  });

  it("never lets gridOptions override locked options", () => {
    const userRowData: GridRow[] = [];
    const { result } = renderStable(
      baseProps({
        gridOptions: {
          readOnlyEdit: false,
          rowModelType: "infinite",
          context: { x: 1 },
          getRowId: () => "x",
          rowData: userRowData,
          postSortRows: () => {},
          maintainColumnOrder: false,
          domLayout: "autoHeight",
        },
      }),
    );
    expect(result.current.gridProps.readOnlyEdit).toBe(true);
    expect(result.current.gridProps.rowModelType ?? "clientSide").toBe("clientSide");
    expect(result.current.gridProps.context).toHaveProperty("stores");
    expect(result.current.gridProps.domLayout).toBe("autoHeight");
    expect(result.current.gridProps.getRowId?.({ data: fixtureRows[0] } as never)).toBe("r1");
    expect(result.current.gridProps.rowData).not.toBe(userRowData);
    expect(result.current.gridProps.maintainColumnOrder).toBe(true);
  });

  it("an edit through onCellEditRequest reaches applyChanges and updates rowData", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, fixtureRows);
    const { result } = renderStable(baseProps({ dataSource: ds }));
    await waitFor(() => expect(rowIds(result.current.gridProps.rowData)).toHaveLength(4));
    const r1 = (result.current.gridProps.rowData as GridRow[]).find((r) => r.id === "r1");
    const event = {
      source: "edit",
      data: r1,
      column: { getColId: () => "name" },
      newValue: "Zed",
      oldValue: "Asha",
    } as unknown as CellEditRequestEvent<GridRow>;
    act(() => result.current.gridProps.onCellEditRequest?.(event));
    await waitFor(() => expect(ds.calls.applyChanges).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const updated = (result.current.gridProps.rowData as GridRow[]).find((r) => r.id === "r1");
      expect(updated?.cells.name).toBe("Zed");
    });
    await waitFor(() => expect(result.current.undo.canUndo()).toBe(true));
    await act(() => result.current.undo.undo());
    await waitFor(() => {
      const reverted = (result.current.gridProps.rowData as GridRow[]).find((r) => r.id === "r1");
      expect(reverted?.cells.name).toBe("Asha");
    });
    expect(ds.calls.applyChanges).toHaveBeenCalledTimes(2);
    expect(result.current.undo.canRedo()).toBe(true);
  });
});

describe("useSchemaGrid — server mode", () => {
  it("uses the infinite row model with a datasource and the infinite module set", () => {
    const { result } = renderStable(baseProps({ mode: "server", pageSize: 50 }));
    const gp = result.current.gridProps;
    expect(gp.rowModelType).toBe("infinite");
    expect(gp.cacheBlockSize).toBe(50);
    expect(gp.datasource).toBeDefined();
    expect(gp.rowData).toBeUndefined();
    expect(gp.modules).toEqual([...SCHEMA_GRID_INFINITE_MODULES]);
  });

  it("swaps in a fresh datasource (no purge) and fetches once with the new query on a query-store change", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, fixtureRows);
    const grid = mountGrid(baseProps({ dataSource: ds, mode: "server", pageSize: 10 }));
    const api = await grid.ready();
    await waitFor(() => expect(grid.current().stores.rows.all()).toHaveLength(4));
    await settle();
    const purge = vi.spyOn(api, "purgeInfiniteCache");
    const before = grid.current().gridProps.datasource;
    const fetches = ds.calls.fetch.mock.calls.length;

    act(() => grid.current().stores.query.setSearch("Asha"));
    await waitFor(() => expect(ds.calls.fetch.mock.calls.length).toBe(fetches + 1));
    await settle();
    expect(ds.calls.fetch.mock.calls.length).toBe(fetches + 1);
    expect((ds.calls.fetch.mock.calls.at(-1)?.[0] as { search?: string }).search).toBe("Asha");
    expect(grid.current().gridProps.datasource).not.toBe(before);
    expect(purge).not.toHaveBeenCalled();

    await act(() => grid.current().refetch());
    expect(purge).toHaveBeenCalledTimes(1);
  });

  it("a query-store filter change fetches exactly once with the new filter", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, fixtureRows);
    const grid = mountGrid(baseProps({ dataSource: ds, mode: "server", pageSize: 10 }));
    await grid.ready();
    await waitFor(() => expect(grid.current().stores.rows.all()).toHaveLength(4));
    await settle();
    const fetches = ds.calls.fetch.mock.calls.length;
    act(() => grid.current().stores.query.setFilter({ columnId: "payment", operator: "is", value: "paid" }));
    await waitFor(() => expect(ds.calls.fetch.mock.calls.length).toBeGreaterThan(fetches));
    await settle();
    expect(ds.calls.fetch.mock.calls.length).toBe(fetches + 1);
    expect((ds.calls.fetch.mock.calls.at(-1)?.[0] as { filter: unknown }).filter).toEqual({
      columnId: "payment",
      operator: "is",
      value: "paid",
    });
  });

  it("a query-store filter change raises exactly one grid filterChanged (no spurious filter-component re-fire)", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, fixtureRows);
    const grid = mountGrid(baseProps({ dataSource: ds, mode: "server", pageSize: 10 }));
    const api = await grid.ready();
    await waitFor(() => expect(grid.current().stores.rows.all()).toHaveLength(4));
    await settle();
    const sources: string[] = [];
    api.addEventListener("filterChanged", (e) => sources.push(String(e.source)));
    act(() => grid.current().stores.query.setFilter({ columnId: "payment", operator: "is", value: "paid" }));
    await waitFor(() =>
      expect((ds.calls.fetch.mock.calls.at(-1)?.[0] as { filter: unknown }).filter).toEqual({
        columnId: "payment",
        operator: "is",
        value: "paid",
      }),
    );
    await settle();
    expect(sources).toEqual(["api"]);
  });

  it("a header sort fetches exactly once, already using the new sort (no stale-query fetch)", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, fixtureRows);
    const grid = mountGrid(baseProps({ dataSource: ds, mode: "server", pageSize: 10 }));
    const api = await grid.ready();
    await waitFor(() => expect(grid.current().stores.rows.all()).toHaveLength(4));
    await settle();
    const fetches = ds.calls.fetch.mock.calls.length;
    act(() => {
      api.applyColumnState({ state: [{ colId: "name", sort: "asc" }], defaultState: { sort: null } });
    });
    await waitFor(() => expect(ds.calls.fetch.mock.calls.length).toBeGreaterThan(fetches));
    await settle();
    const sorts = ds.calls.fetch.mock.calls.slice(fetches).map((c) => (c[0] as { sort: unknown }).sort);
    expect(sorts).toEqual([[{ columnId: "name", dir: "asc" }]]);
    expect(grid.current().stores.query.getState().sort).toEqual([{ columnId: "name", dir: "asc" }]);
  });

  it("never sends sort or groupBy on columns the user cannot read", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, fixtureRows);
    const grid = mountGrid(baseProps({ dataSource: ds, mode: "server", user: AGENT, pageSize: 10 }));
    await grid.ready();
    await waitFor(() => expect(ds.calls.fetch).toHaveBeenCalled());
    await settle();
    act(() =>
      grid.current().stores.query.setSort([
        { columnId: "salary", dir: "desc" },
        { columnId: "name", dir: "asc" },
      ]),
    );
    await waitFor(() =>
      expect((ds.calls.fetch.mock.calls.at(-1)?.[0] as { sort: unknown }).sort).toEqual([{ columnId: "name", dir: "asc" }]),
    );
    act(() => grid.current().stores.query.setGroupBy([{ columnId: "salary" }]));
    await settle();
    for (const call of ds.calls.fetch.mock.calls) {
      const q = call[0] as { sort: { columnId: string }[]; groupBy?: unknown };
      expect(q.sort.map((s) => s.columnId)).not.toContain("salary");
      expect(q.groupBy).toBeUndefined();
    }
  });

  it("merges externalFilter into the server query", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, fixtureRows);
    const external = { columnId: "status", operator: "is", value: "open" };
    const grid = mountGrid(baseProps({ dataSource: ds, mode: "server", externalFilter: external }));
    await grid.ready();
    await waitFor(() => expect(ds.calls.fetch).toHaveBeenCalled());
    expect((ds.calls.fetch.mock.calls[0]?.[0] as { filter: unknown }).filter).toEqual(external);
  });

  it("exportCurrentView uses the injected io option with the grid's tz", async () => {
    const buildExportBlob = vi.fn(async (_opts: IoExportOptions) => new Blob(["x"]));
    const { result } = renderStable(
      baseProps({ mode: "server", pageSize: 50, tz: "Europe/London", io: { buildExportBlob } }),
    );
    const blob = await result.current.exportCurrentView("xlsx", "leads.xlsx");
    expect(blob).toBeInstanceOf(Blob);
    expect(buildExportBlob).toHaveBeenCalledTimes(1);
    expect(buildExportBlob.mock.calls[0]?.[0]).toMatchObject({
      format: "xlsx",
      tz: "Europe/London",
      fileName: "leads.xlsx",
      rows: expect.any(Array),
    });
  });

  it("reports rowModelKey", () => {
    const server = renderStable(baseProps({ mode: "server" }));
    expect(server.result.current.rowModelKey).toBe("infinite");
    const client = renderStable(baseProps());
    expect(client.result.current.rowModelKey).toBe("clientSide");
  });
});

describe("useSchemaGrid — mounted grid", () => {
  it("fires onViewChange on a query-store sort change and on a header sort", async () => {
    const onViewChange = vi.fn<(view: ViewDef) => void>();
    const grid = mountGrid(baseProps({ onViewChange }));
    const api = await grid.ready();
    await waitFor(() => expect(api.getDisplayedRowCount()).toBe(4));

    act(() => grid.current().stores.query.setSort([{ columnId: "score", dir: "desc" }]));
    await waitFor(() => expect(onViewChange).toHaveBeenCalled());
    expect(onViewChange.mock.calls.at(-1)?.[0].sort).toEqual([{ columnId: "score", dir: "desc" }]);

    act(() => {
      api.applyColumnState({ state: [{ colId: "name", sort: "asc" }], defaultState: { sort: null } });
    });
    await waitFor(() => expect(grid.current().stores.query.getState().sort).toEqual([{ columnId: "name", dir: "asc" }]));
    await waitFor(() => expect(onViewChange.mock.calls.at(-1)?.[0].sort).toEqual([{ columnId: "name", dir: "asc" }]));

    // Identical consecutive views are not re-emitted.
    const count = onViewChange.mock.calls.length;
    act(() => grid.current().stores.query.setSort([{ columnId: "name", dir: "asc" }]));
    await new Promise((r) => setTimeout(r, 20));
    expect(onViewChange.mock.calls.length).toBe(count);
  });

  it("keeps the grid order equal to core's derived order", async () => {
    const grid = mountGrid(baseProps());
    const api = await grid.ready();
    await waitFor(() => expect(api.getDisplayedRowCount()).toBe(4));
    act(() => grid.current().stores.query.setSort([{ columnId: "score", dir: "asc" }]));
    await waitFor(() => {
      const ids: string[] = [];
      api.forEachNodeAfterFilterAndSort((n) => ids.push(n.data?.id ?? ""));
      // nulls sort last
      expect(ids).toEqual(["r2", "r1", "r4", "r3"]);
    });
  });

  it("syncs the query-store filter to the grid filter model and back", async () => {
    const grid = mountGrid(baseProps());
    const api = await grid.ready();
    await waitFor(() => expect(api.getDisplayedRowCount()).toBe(4));

    const cond = { columnId: "payment", operator: "is", value: "paid" };
    act(() => grid.current().stores.query.setFilter(cond));
    await waitFor(() => expect(api.getFilterModel()).toEqual({ payment: cond }));
    await waitFor(() => expect(api.getDisplayedRowCount()).toBe(1));

    const cond2 = { columnId: "status", operator: "is", value: "open" };
    await act(async () => {
      await api.setColumnFilterModel("status", cond2);
      api.onFilterChanged();
    });
    await waitFor(() =>
      expect(grid.current().stores.query.getState().filter).toEqual({ op: "and", children: [cond, cond2] }),
    );
  });

  it("applies the view prop on grid ready", async () => {
    const view: ViewDef = {
      id: "v1",
      name: "V1",
      filter: { columnId: "status", operator: "is", value: "open" },
      sort: [{ columnId: "name", dir: "desc" }],
      columnState: [],
      groupBy: [],
      pageSize: 100,
    };
    const grid = mountGrid(baseProps({ view }));
    const api = await grid.ready();
    await waitFor(() => expect(api.getDisplayedRowCount()).toBe(2));
    expect(grid.current().stores.query.getState().sort).toEqual([{ columnId: "name", dir: "desc" }]);
    expect(grid.current().captureView()?.id).toBe("v1");
  });

  it("refreshes exactly the changed cells when cell status changes", async () => {
    const grid = mountGrid(baseProps());
    const api = await grid.ready();
    await waitFor(() => expect(api.getDisplayedRowCount()).toBe(4));
    const refresh = vi.spyOn(api, "refreshCells");
    act(() =>
      grid.current().stores.cellStatus.setPending([
        { rowId: "r2", columnId: "score" },
        { rowId: "r2", columnId: "name" },
      ]),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(refresh).toHaveBeenCalledTimes(1);
    const arg = refresh.mock.calls[0]?.[0];
    expect(arg?.rowNodes?.map((n) => n.id)).toEqual(["r2"]);
    expect(arg?.columns).toEqual(["score", "name"]);
    expect(arg?.force).toBe(true);
  });
});

describe("useSchemaGrid — externalFilter (trusted host input)", () => {
  it("applies an external filter on a column hidden from the user and sends it to the server", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, fixtureRows);
    const external = { columnId: "salary", operator: "gt", value: 60 };
    const { result } = renderStable(baseProps({ dataSource: ds, user: AGENT, externalFilter: external }));
    await waitFor(() => expect(result.current.loadState).toBe("idle"));
    await waitFor(() => expect(rowIds(result.current.gridProps.rowData)).toEqual(["r2"]));
    expect(result.current.filterErrors.external).toEqual([]);
    expect((ds.calls.fetch.mock.calls[0]?.[0] as { filter: unknown }).filter).toEqual(external);
  });

  it("an invalid user filter is dropped (with errors) while the external filter still applies", async () => {
    const { result } = renderStable(baseProps({ user: AGENT, externalFilter: { columnId: "status", operator: "is", value: "open" } }));
    await waitFor(() => expect(rowIds(result.current.gridProps.rowData)).toEqual(["r1", "r3"]));
    act(() => result.current.stores.query.setFilter({ columnId: "salary", operator: "gt", value: 0 }));
    await waitFor(() => expect(result.current.filterErrors.user.length).toBeGreaterThan(0));
    expect(rowIds(result.current.gridProps.rowData)).toEqual(["r1", "r3"]);
    expect(result.current.filterErrors.external).toEqual([]);
  });

  it("an invalid external filter fails closed: zero rows, errors surfaced, nothing fetched", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, fixtureRows);
    const { result } = renderStable(baseProps({ dataSource: ds, externalFilter: { columnId: "nope", operator: "is", value: 1 } }));
    await waitFor(() => expect(result.current.filterErrors.external.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 20));
    expect(rowIds(result.current.gridProps.rowData)).toEqual([]);
    expect(ds.calls.fetch).not.toHaveBeenCalled();
    expect(result.current.loadState).toBe("error");
  });

  it("handles a deep-OR external filter next to a deep-OR user filter without depth errors", async () => {
    const external = {
      op: "or" as const,
      children: [
        {
          op: "and" as const,
          children: [
            { columnId: "status", operator: "is", value: "open" },
            { columnId: "payment", operator: "is", value: "paid" },
          ],
        },
        { op: "and" as const, children: [{ columnId: "score", operator: "gt", value: 15 }] },
      ],
    };
    const user = {
      op: "or" as const,
      children: [
        { op: "and" as const, children: [{ columnId: "name", operator: "is", value: "Dev" }] },
        { op: "and" as const, children: [{ columnId: "name", operator: "is", value: "Zed" }] },
      ],
    };
    const { result } = renderStable(baseProps({ externalFilter: external }));
    await waitFor(() => expect(rowIds(result.current.gridProps.rowData)).toEqual(["r1", "r4"]));
    act(() => result.current.stores.query.setFilter(user));
    await waitFor(() => expect(rowIds(result.current.gridProps.rowData)).toEqual(["r4"]));
    expect(result.current.filterErrors).toEqual({ user: [], external: [] });
  });

  it("refetches when the external filter changes", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, fixtureRows);
    let external = { columnId: "status", operator: "is", value: "open" };
    const { result, rerender } = renderHook(() => useSchemaGrid(baseProps({ dataSource: ds, externalFilter: external })));
    await waitFor(() => expect(rowIds(result.current.gridProps.rowData)).toEqual(["r1", "r3"]));
    const fetches = ds.calls.fetch.mock.calls.length;
    external = { columnId: "status", operator: "is", value: "closed" };
    rerender();
    await waitFor(() => expect(rowIds(result.current.gridProps.rowData)).toEqual(["r2"]));
    expect(ds.calls.fetch.mock.calls.length).toBeGreaterThan(fetches);
    expect((ds.calls.fetch.mock.calls.at(-1)?.[0] as { filter: unknown }).filter).toEqual(external);
  });
});

describe("useSchemaGrid — unreadable columns and robustness", () => {
  it("prunes an initial view's sort/groupBy/filter on unreadable columns", () => {
    const view: ViewDef = {
      id: "v",
      name: "V",
      filter: {
        op: "and",
        children: [
          { columnId: "salary", operator: "gt", value: 1 },
          { columnId: "status", operator: "is", value: "open" },
        ],
      },
      sort: [
        { columnId: "salary", dir: "desc" },
        { columnId: "name", dir: "asc" },
      ],
      columnState: [],
      groupBy: [{ columnId: "salary" }, { columnId: "status", aggregations: [{ columnId: "salary", agg: "sum" }] }],
      pageSize: 100,
    };
    const { result } = renderStable(baseProps({ user: AGENT, view }));
    const q = result.current.stores.query.getState();
    expect(q.sort).toEqual([{ columnId: "name", dir: "asc" }]);
    expect(q.groupBy).toEqual([{ columnId: "status", aggregations: [] }]);
    expect(q.filter).toEqual({ op: "and", children: [{ columnId: "status", operator: "is", value: "open" }] });
  });

  it("never groups by an unreadable column in client mode", async () => {
    const { result } = renderStable(baseProps({ user: AGENT }));
    await waitFor(() => expect(rowIds(result.current.gridProps.rowData)).toHaveLength(4));
    act(() => result.current.stores.query.setGroupBy([{ columnId: "salary" }]));
    await new Promise((r) => setTimeout(r, 10));
    const rows = (result.current.gridProps.rowData ?? []) as { __sg?: string }[];
    expect(rows.some((r) => r.__sg === "group")).toBe(false);
    expect(rows).toHaveLength(4);
  });

  it("a refetch never clobbers a cell with a pending write", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, fixtureRows);
    const slow = { ...ds, applyChanges: vi.fn(() => new Promise<never>(() => {})) };
    const { result } = renderStable(baseProps({ dataSource: slow }));
    await waitFor(() => expect(rowIds(result.current.gridProps.rowData)).toHaveLength(4));
    const r1 = result.current.stores.rows.getRow("r1");
    const event = {
      source: "edit",
      data: r1,
      column: { getColId: () => "name" },
      newValue: "Zed",
      oldValue: "Asha",
    } as unknown as CellEditRequestEvent<GridRow>;
    act(() => result.current.gridProps.onCellEditRequest?.(event));
    await waitFor(() => expect(result.current.stores.cellStatus.get("r1", "name").pending).toBe(true));
    await act(() => result.current.refetch());
    expect(result.current.stores.rows.getRow("r1")?.cells.name).toBe("Zed");
    expect(result.current.stores.rows.getRow("r2")?.cells.name).toBe("Bala");
  });

  it("refetch removes rows gone from the server but keeps rows added during the load", async () => {
    const { result } = renderStable(baseProps());
    await waitFor(() => expect(result.current.loadState).toBe("idle"));
    act(() => result.current.stores.rows.upsert([{ id: "ghost", version: 1, updatedAt: "", cells: {} }]));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.refetch();
      result.current.stores.rows.upsert([{ id: "local", version: 1, updatedAt: "", cells: {} }]);
    });
    await act(() => pending);
    const ids = result.current.stores.rows.all().map((r) => r.id);
    expect(ids).not.toContain("ghost");
    expect(ids).toContain("local");
  });

  it("surfaces load errors via loadState and lastError", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, fixtureRows);
    const failing = { ...ds, fetch: vi.fn(() => Promise.reject(new Error("boom"))) };
    const { result } = renderStable(baseProps({ dataSource: failing }));
    await waitFor(() => expect(result.current.loadState).toBe("error"));
    expect((result.current.lastError as Error).message).toBe("boom");
  });

  it("keeps notInView rows in client rowData at their previous position", async () => {
    const { result } = renderStable(baseProps());
    await waitFor(() => expect(rowIds(result.current.gridProps.rowData)).toEqual(["r1", "r2", "r3", "r4"]));
    act(() => result.current.stores.rows.setNotInView(["r2"], true));
    act(() => result.current.stores.query.setFilter({ columnId: "payment", operator: "isAnyOf", value: ["paid", "failed"] }));
    await waitFor(() => expect(rowIds(result.current.gridProps.rowData)).toEqual(["r1", "r2", "r4"]));
  });
});
