/**
 * v0.2 C2: `useSchemaGrid` reads the data source's capabilities and turns
 * affordances off accordingly.
 */
import { act, render, renderHook, waitFor } from "@testing-library/react";
import type { ColDef, EditableCallbackParams, GridApi } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { describe, expect, it, vi } from "vitest";
import type { SchemaGridHookContext } from "../../src/grid/gridContext";
import { type SchemaGridProps, type UseSchemaGridResult, useSchemaGrid } from "../../src/grid/useSchemaGrid";
import {
  DEFAULT_CAPABILITIES,
  type DataSourceCapabilities,
  type GridQuery,
  type GridRow,
  type IoExportOptions,
  inferCapabilities,
} from "../../src/internal/core";
import { createInMemoryDataSource } from "../fixtures/dataSource";
import { ADMIN, fixtureRows, fixtureSchema, row } from "../fixtures/schema";

function baseProps(overrides: Partial<SchemaGridProps<GridRow>> = {}): SchemaGridProps<GridRow> {
  return {
    schema: fixtureSchema,
    dataSource: createInMemoryDataSource(fixtureSchema, fixtureRows),
    user: ADMIN,
    ...overrides,
  };
}

async function settle(ms = 60): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

function renderStable(props: SchemaGridProps<GridRow>) {
  return renderHook(() => useSchemaGrid(props));
}

function mountGrid(props: SchemaGridProps<GridRow>) {
  const ref: { current: UseSchemaGridResult<GridRow> | null } = { current: null };
  function Harness(p: { props: SchemaGridProps<GridRow> }) {
    const result = useSchemaGrid(p.props);
    ref.current = result;
    return (
      <div style={{ width: 1200, height: 600 }}>
        <AgGridReact key={result.rowModelKey} {...result.gridProps} />
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

function def(defs: unknown, id: string): ColDef<GridRow> {
  const d = ((defs ?? []) as ColDef<GridRow>[]).find((x) => x.colId === id);
  if (!d) throw new Error(`no coldef ${id}`);
  return d;
}

function isEditable(d: ColDef<GridRow>, data: GridRow): boolean {
  if (typeof d.editable === "function") return d.editable({ data } as EditableCallbackParams<GridRow>);
  return d.editable === true;
}

function queries(fetch: { mock: { calls: unknown[][] } }): GridQuery[] {
  return fetch.mock.calls.map((c) => c[0] as GridQuery);
}

describe("useSchemaGrid — data-source capabilities (C2)", () => {
  it("exposes default effectiveCapabilities before load and the raw capabilities once loaded", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, fixtureRows, { capabilities: { maxPageSize: 50 } });
    const { result } = renderStable(baseProps({ dataSource: ds }));
    expect(result.current.capabilities).toBeUndefined();
    expect(result.current.effectiveCapabilities.maxPageSize).toBe(DEFAULT_CAPABILITIES.maxPageSize);
    await waitFor(() => expect(result.current.capabilities?.maxPageSize).toBe(50));
    expect(result.current.effectiveCapabilities.maxPageSize).toBe(50);
    expect(ds.calls.capabilities).toHaveBeenCalledTimes(1);
  });

  it("a source without capabilities() uses inferred capabilities", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, fixtureRows);
    const { result } = renderStable(baseProps({ dataSource: ds }));
    await waitFor(() => expect(result.current.capabilities).toEqual(inferCapabilities(ds)));
  });

  it("falls back to inferCapabilities silently when capabilities() rejects", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, fixtureRows, {
      capabilities: () => Promise.reject(new Error("UNKNOWN_OPERATION")),
    });
    const { result } = renderStable(baseProps({ dataSource: ds }));
    await waitFor(() => expect(result.current.capabilities).toEqual(inferCapabilities(ds)));
    await waitFor(() => expect(result.current.loadState).toBe("idle"));
    expect(result.current.lastError).toBeUndefined();
    expect(result.current.stores.rows.all()).toHaveLength(4);
  });

  it("keeps the schema reference (no recompile) when capabilities change nothing", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, fixtureRows, { capabilities: {} });
    const { result } = renderStable(baseProps({ dataSource: ds }));
    const before = result.current.gridProps.columnDefs;
    await waitFor(() => expect(result.current.capabilities).toBeDefined());
    expect(result.current.gridProps.columnDefs).toBe(before);
  });

  it("unsortable columns: ColDef sortable false, and a sort on them is never sent", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, fixtureRows, { capabilities: { sort: { columnIds: ["name"] } } });
    const grid = mountGrid(baseProps({ dataSource: ds, mode: "server" }));
    await grid.ready();
    await waitFor(() => expect(grid.current().capabilities).toBeDefined());
    expect(def(grid.current().gridProps.columnDefs, "score").sortable).toBe(false);
    expect(def(grid.current().gridProps.columnDefs, "name").sortable).toBe(true);
    expect(grid.current().effectiveCapabilities.columns.score?.sortable).toBe(false);
    act(() => grid.current().stores.query.setSort([{ columnId: "score", dir: "asc" }, { columnId: "name", dir: "desc" }]));
    await settle();
    const last = queries(ds.calls.fetch).at(-1);
    expect(last?.sort).toEqual([{ columnId: "name", dir: "desc" }]);
  });

  it("unfilterable columns: ColDef filter false, and a filter on them is rejected", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, fixtureRows, { capabilities: { filter: { columnIds: ["name"] } } });
    const { result } = renderStable(baseProps({ dataSource: ds }));
    await waitFor(() => expect(result.current.capabilities).toBeDefined());
    expect(def(result.current.gridProps.columnDefs, "score").filter).toBe(false);
    expect(def(result.current.gridProps.columnDefs, "name").filter).not.toBe(false);
    await waitFor(() => expect(result.current.stores.rows.all()).toHaveLength(4));
    act(() => result.current.stores.query.setFilter({ columnId: "score", operator: "gte", value: 10 }));
    await waitFor(() => expect(result.current.filterErrors.user.map((e) => e.code)).toContain("unfilterableColumn"));
    expect((result.current.gridProps.rowData ?? []).length).toBe(4);
  });

  it("groupBy:false prunes groupBy from server queries and hides Group by in the header menu", async () => {
    const onGroupByColumn = vi.fn();
    const ds = createInMemoryDataSource(fixtureSchema, fixtureRows, { capabilities: { groupBy: false } });
    const grid = mountGrid(baseProps({ dataSource: ds, mode: "server", onGroupByColumn }));
    await grid.ready();
    await waitFor(() => expect(grid.current().capabilities).toBeDefined());
    const ctx = () => grid.current().gridProps.context as SchemaGridHookContext<GridRow>;
    await waitFor(() => expect(ctx().headerMenu?.onGroupByColumn).toBeUndefined());
    act(() => grid.current().stores.query.setGroupBy([{ columnId: "payment" }]));
    act(() => grid.current().stores.query.setSearch("a"));
    await settle(100);
    expect(grid.current().rowModelKey).toBe("infinite");
    expect(queries(ds.calls.fetch).some((q) => q.groupBy !== undefined)).toBe(false);
  });

  it("offers Group by when the source supports grouping", async () => {
    const onGroupByColumn = vi.fn();
    const { result } = renderStable(baseProps({ onGroupByColumn }));
    await waitFor(() => expect(result.current.capabilities).toBeDefined());
    expect((result.current.gridProps.context as SchemaGridHookContext<GridRow>).headerMenu?.onGroupByColumn).toBeTypeOf("function");
  });

  it("search:false never sends search (server) nor applies it (client)", async () => {
    const serverDs = createInMemoryDataSource(fixtureSchema, fixtureRows, { capabilities: { search: false } });
    const grid = mountGrid(baseProps({ dataSource: serverDs, mode: "server" }));
    await grid.ready();
    await waitFor(() => expect(grid.current().capabilities).toBeDefined());
    act(() => grid.current().stores.query.setSearch("zzz-no-match"));
    await settle(100);
    expect(queries(serverDs.calls.fetch).some((q) => q.search !== undefined)).toBe(false);
    grid.unmount();

    const clientDs = createInMemoryDataSource(fixtureSchema, fixtureRows, { capabilities: { search: false } });
    const { result } = renderStable(baseProps({ dataSource: clientDs }));
    await waitFor(() => expect(result.current.capabilities).toBeDefined());
    await waitFor(() => expect(result.current.stores.rows.all()).toHaveLength(4));
    act(() => result.current.stores.query.setSearch("zzz-no-match"));
    await settle();
    expect((result.current.gridProps.rowData ?? []).length).toBe(4);
  });

  it("changeFeed:false disables polling", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, fixtureRows, { capabilities: { changeFeed: false } });
    const grid = mountGrid(baseProps({ dataSource: ds, poll: { enabled: true, intervalMs: 10 } }));
    await grid.ready();
    await waitFor(() => expect(grid.current().capabilities).toBeDefined());
    await settle(30);
    const count = ds.calls.getChanges.mock.calls.length;
    await settle(120);
    expect(ds.calls.getChanges.mock.calls.length).toBe(count);
  });

  it('changeFeed:"updates-only" keeps polling', async () => {
    const ds = createInMemoryDataSource(fixtureSchema, fixtureRows, { capabilities: { changeFeed: "updates-only" } });
    const grid = mountGrid(baseProps({ dataSource: ds, poll: { enabled: true, intervalMs: 10 } }));
    await grid.ready();
    await waitFor(() => expect(grid.current().capabilities).toBeDefined());
    await waitFor(() => expect(ds.calls.getChanges.mock.calls.length).toBeGreaterThan(1));
  });

  it("write.cells:false makes every cell read-only", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, fixtureRows, { capabilities: { write: { cells: false, createRows: true, deleteRows: true } } });
    const { result } = renderStable(baseProps({ dataSource: ds }));
    expect(isEditable(def(result.current.gridProps.columnDefs, "name"), row("r1", {}))).toBe(true);
    await waitFor(() => expect(result.current.capabilities).toBeDefined());
    expect(result.current.access.get("name")).toBe("read");
    expect(isEditable(def(result.current.gridProps.columnDefs, "name"), row("r1", {}))).toBe(false);
    expect((result.current.gridProps.context as SchemaGridHookContext<GridRow>).canEditCell(row("r1", {}), "name")).toBe(false);
  });

  it("maxPageSize clamps the client fetch limit and loads every row across short pages", async () => {
    const rows = Array.from({ length: 7 }, (_, i) => row(`m${i}`, { name: `Row ${i}` }));
    const ds = createInMemoryDataSource(fixtureSchema, rows, { capabilities: { maxPageSize: 2 } });
    const { result } = renderStable(baseProps({ dataSource: ds, pageSize: 100 }));
    await waitFor(() => expect(result.current.capabilities).toBeDefined());
    // Whatever the initial (pre-capabilities) load asked for, every row arrives.
    await waitFor(() => expect(result.current.stores.rows.all()).toHaveLength(7));
    ds.calls.fetch.mockClear();
    await act(() => result.current.refetch());
    const limits = queries(ds.calls.fetch).map((q) => q.page.limit);
    expect(limits.length).toBeGreaterThan(0);
    expect(limits.every((l) => l === 2)).toBe(true);
    expect(result.current.stores.rows.all()).toHaveLength(7);
  });

  it("maxPageSize clamps the server block size", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, fixtureRows, { capabilities: { maxPageSize: 2 } });
    const grid = mountGrid(baseProps({ dataSource: ds, mode: "server", pageSize: 100 }));
    await grid.ready();
    await waitFor(() => expect(grid.current().gridProps.cacheBlockSize).toBe(2));
    await waitFor(() => expect(grid.current().stores.rows.all()).toHaveLength(4));
  });

  it("exportCurrentView through the hook pages a clamping source to the end (1,200 rows, maxPageSize 200)", async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => row(`x${String(i).padStart(5, "0")}`, { name: `Row ${i}` }));
    const ds = createInMemoryDataSource(fixtureSchema, rows, { capabilities: { maxPageSize: 200 } });
    const captured: GridRow[][] = [];
    const buildExportBlob = vi.fn(async (opts: IoExportOptions) => {
      captured.push(opts.rows as GridRow[]);
      return new Blob(["x"]);
    });
    const { result } = renderStable(baseProps({ dataSource: ds, mode: "server", io: { buildExportBlob } }));
    await waitFor(() => expect(result.current.capabilities).toBeDefined());
    ds.calls.fetch.mockClear();
    await act(async () => {
      await result.current.exportCurrentView("csv");
    });
    expect(captured[0]).toHaveLength(1200);
    expect(queries(ds.calls.fetch).every((q) => q.page.limit <= 200)).toBe(true);
  });

  it("export.maxRows truncates the hook's export", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(`y${String(i).padStart(3, "0")}`, { name: `Row ${i}` }));
    const ds = createInMemoryDataSource(fixtureSchema, rows, { capabilities: { export: { maxRows: 12 } } });
    const captured: GridRow[][] = [];
    const buildExportBlob = vi.fn(async (opts: IoExportOptions) => {
      captured.push(opts.rows as GridRow[]);
      return new Blob(["x"]);
    });
    const { result } = renderStable(baseProps({ dataSource: ds, mode: "server", io: { buildExportBlob } }));
    await waitFor(() => expect(result.current.capabilities).toBeDefined());
    await act(async () => {
      await result.current.exportCurrentView("csv");
    });
    expect(captured[0]).toHaveLength(12);
  });

  it("refetches capabilities after the change feed reports a schema change; the host's onSchemaChanged still fires", async () => {
    let caps: Partial<DataSourceCapabilities> = {};
    const ds = createInMemoryDataSource(fixtureSchema, fixtureRows, { capabilities: () => caps });
    const onSchemaChanged = vi.fn();
    const grid = mountGrid(baseProps({ dataSource: ds, poll: { enabled: true, intervalMs: 10 }, events: { onSchemaChanged } }));
    await grid.ready();
    await waitFor(() => expect(grid.current().capabilities?.groupBy).toBe(true));
    expect(ds.calls.capabilities).toHaveBeenCalledTimes(1);
    caps = { groupBy: false };
    ds.bumpSchemaVersion();
    await waitFor(() => expect(onSchemaChanged).toHaveBeenCalledWith(2));
    await waitFor(() => expect(grid.current().capabilities?.groupBy).toBe(false));
    expect(grid.current().effectiveCapabilities.groupBy).toBe(false);
    expect(ds.calls.capabilities).toHaveBeenCalledTimes(2);
  });

  it("refetches capabilities when the data source changes", async () => {
    const first = createInMemoryDataSource(fixtureSchema, fixtureRows, { capabilities: { maxPageSize: 10 } });
    const second = createInMemoryDataSource(fixtureSchema, fixtureRows, { capabilities: { maxPageSize: 20 } });
    const props = baseProps({ dataSource: first });
    const { result, rerender } = renderHook((p: SchemaGridProps<GridRow>) => useSchemaGrid(p), { initialProps: props });
    await waitFor(() => expect(result.current.capabilities?.maxPageSize).toBe(10));
    rerender({ ...props, dataSource: second });
    await waitFor(() => expect(result.current.capabilities?.maxPageSize).toBe(20));
    expect(second.calls.capabilities).toHaveBeenCalledTimes(1);
  });
});
