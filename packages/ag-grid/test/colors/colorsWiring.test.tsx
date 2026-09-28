/**
 * v0.4 cell colors through `<SchemaGrid>`: rendering (manual + rule colors),
 * the handle (`setCellColor`, `canPaint`, `colorRules`, `setColorRules`),
 * undo / redo / rollback, the change feed, views and the query wiring.
 */
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CellColorBatch, ColorRule, GridQuery, GridRow, GridSchema, ViewDef } from "../../src/internal/core";
import { createInMemoryDataSource } from "../fixtures/dataSource";
import { ADMIN, AGENT, fixtureRows, fixtureSchema } from "../fixtures/schema";
import { SchemaGrid, type SchemaGridHandle } from "../../src/grid/SchemaGrid";
import { type RenderGridResult, renderGrid, TEST_GRID_OPTIONS } from "../renderGrid";

const openRow: ColorRule = {
  id: "open",
  color: "green",
  target: { kind: "row" },
  when: { columnId: "status", operator: "is", value: "open" },
};
const paidName: ColorRule = {
  id: "paid",
  color: "red",
  target: { kind: "cells", columnIds: ["name"] },
  when: { columnId: "payment", operator: "is", value: "paid" },
};

function view(over: Partial<ViewDef> = {}): ViewDef {
  return { id: "v1", name: "View", filter: null, sort: [], columnState: [], groupBy: [], pageSize: 100, ...over };
}

/** A source that reports capabilities (core's in-memory source: cellColors all true). */
function colorSource(rows: GridRow[] = fixtureRows, opts: Parameters<typeof createInMemoryDataSource>[2] = {}) {
  return createInMemoryDataSource(fixtureSchema, rows, { capabilities: {}, ...opts });
}

function cell(g: RenderGridResult, rowId: string, colId: string): HTMLElement {
  const el = g.container.querySelector(`.ag-row[row-id="${rowId}"] [col-id="${colId}"]`);
  if (!el) throw new Error(`no cell ${rowId}/${colId}`);
  return el as HTMLElement;
}

function rowEls(g: RenderGridResult, rowId: string): HTMLElement[] {
  return [...g.container.querySelectorAll(`.ag-row[row-id="${rowId}"]`)] as HTMLElement[];
}

function select(g: RenderGridResult, anchor: [number, string], focus: [number, string] = anchor): void {
  const stores = g.handle.current?.stores;
  if (!stores) throw new Error("no stores");
  act(() => {
    stores.range.setAnchor({ rowIndex: anchor[0], colId: anchor[1] });
    stores.range.setFocus({ rowIndex: focus[0], colId: focus[1] });
  });
}

function handle(g: RenderGridResult) {
  const h = g.handle.current;
  if (!h) throw new Error("no handle");
  return h;
}

async function editCell(g: RenderGridResult, rowId: string, colId: string, value: string): Promise<void> {
  fireEvent.doubleClick(cell(g, rowId, colId), { detail: 2 });
  let input: HTMLInputElement | null = null;
  await waitFor(() => {
    input = cell(g, rowId, colId).querySelector("input");
    expect(input).not.toBeNull();
  });
  fireEvent.change(input as unknown as HTMLInputElement, { target: { value } });
  fireEvent.keyDown(input as unknown as HTMLInputElement, { key: "Enter" });
  await waitFor(() => expect(g.handle.current?.api()?.getEditingCells()).toEqual([]));
}

async function capsLoaded(g: RenderGridResult): Promise<void> {
  await waitFor(() => expect(handle(g).effectiveCapabilities.cellColors?.write).toBe(true));
}

describe("rendering", () => {
  it("paints manual colors and rule colors (row rules color the whole row, cells rules on top)", async () => {
    const rows = fixtureRows.map((r) => (r.id === "r2" ? { ...r, colors: { name: "blue" as const } } : r));
    const g = renderGrid({ rows, ds: colorSource(rows), props: { view: view({ colorRules: [paidName, openRow] }) } });
    await g.waitForRows();
    await capsLoaded(g);
    await waitFor(() => expect(cell(g, "r2", "name")).toHaveClass("sg-cell-colored", "sg-color-blue"));
    expect(cell(g, "r1", "name")).toHaveClass("sg-color-red");
    expect(cell(g, "r1", "score")).toHaveClass("sg-color-green");
    for (const el of rowEls(g, "r1")) expect(el).toHaveClass("sg-row-colored", "sg-color-green");
    expect(rowEls(g, "r2")[0]).not.toHaveClass("sg-row-colored");
    expect(cell(g, "r4", "name")).not.toHaveClass("sg-cell-colored");
  });

  it("hides manual colors when the source can't read them (rule colors still render)", async () => {
    const rows = fixtureRows.map((r) => ({ ...r, colors: { name: "blue" as const } }));
    const ds = createInMemoryDataSource(fixtureSchema, rows, {
      capabilities: { cellColors: { read: false, write: false, filter: false } },
    });
    const g = renderGrid({ rows, ds, props: { view: view({ colorRules: [openRow] }) } });
    await g.waitForRows();
    await waitFor(() => expect(handle(g).capabilities).toBeDefined());
    await g.settle();
    expect(cell(g, "r2", "name")).not.toHaveClass("sg-cell-colored");
    expect(cell(g, "r1", "name")).toHaveClass("sg-color-green");
    expect(handle(g).effectiveCapabilities.cellColors).toEqual({ read: false, write: false, filter: false });
  });

  it("renders a rule testing a filterable:false column and exposes the rules to the column filters (v0.4.1)", async () => {
    const schema: GridSchema = {
      ...fixtureSchema,
      columns: fixtureSchema.columns.map((c) => (c.id === "status" ? { ...c, filterable: false } : c)),
    };
    const ds = createInMemoryDataSource(schema, fixtureRows, { capabilities: {} });
    const g = renderGrid({ rows: fixtureRows, ds, props: { schema, view: view({ colorRules: [openRow] }) } });
    await g.waitForRows();
    await capsLoaded(g);
    await waitFor(() => expect(cell(g, "r1", "name")).toHaveClass("sg-color-green"));
    const context = handle(g).api()?.getGridOption("context") as { colorRules?: () => readonly ColorRule[] };
    expect(context.colorRules?.()).toEqual([openRow]);
  });

  it("setColorRules redraws, updates the view (onViewChange) and does not refetch in client mode", async () => {
    const onViewChange = vi.fn();
    const ds = colorSource();
    const g = renderGrid({ ds, props: { onViewChange } });
    await g.waitForRows();
    const fetches = ds.calls.fetch.mock.calls.length;
    expect(handle(g).colorRules).toEqual([]);
    act(() => handle(g).setColorRules([openRow]));
    await waitFor(() => expect(cell(g, "r3", "name")).toHaveClass("sg-color-green"));
    expect(handle(g).colorRules).toEqual([openRow]);
    expect(onViewChange).toHaveBeenLastCalledWith(expect.objectContaining({ colorRules: [openRow] }));
    expect(handle(g).captureView()?.colorRules).toEqual([openRow]);
    expect(ds.calls.fetch.mock.calls.length).toBe(fetches);
    act(() => handle(g).setColorRules([]));
    await waitFor(() => expect(cell(g, "r3", "name")).not.toHaveClass("sg-cell-colored"));
    expect(onViewChange.mock.calls.at(-1)?.[0]).not.toHaveProperty("colorRules");
  });

  it("client mode filters by the shown color", async () => {
    const g = renderGrid({ ds: colorSource(), props: { view: view({ colorRules: [openRow] }) } });
    await g.waitForRows();
    act(() => handle(g).stores.query.setFilter({ columnId: "name", operator: "colorIs", value: ["green"] }));
    await g.waitForRows(2);
    act(() => handle(g).setColorRules([{ ...openRow, when: { columnId: "status", operator: "is", value: "closed" } }]));
    await g.waitForRows(1);
    expect(rowEls(g, "r2")).toHaveLength(1);
  });
});

describe("filter by color on a column without a column filter", () => {
  it("a colorIs condition on a filterable:false column survives the grid's filter model round trip", async () => {
    const schema: GridSchema = {
      ...fixtureSchema,
      columns: fixtureSchema.columns.map((c) => (c.id === "email" ? { ...c, filterable: false } : c)),
    };
    const ds = createInMemoryDataSource(schema, fixtureRows, { capabilities: {} });
    const ref = createRef<SchemaGridHandle<GridRow>>();
    const { container } = render(
      <div style={{ width: 1600, height: 800 }}>
        <SchemaGrid<GridRow> ref={ref} schema={schema} dataSource={ds} user={ADMIN} view={view({ colorRules: [openRow] })} gridOptions={TEST_GRID_OPTIONS} />
      </div>,
    );
    await waitFor(() => expect(container.querySelectorAll(".ag-row[row-id]")).toHaveLength(4));
    const filter = {
      op: "and" as const,
      children: [
        { columnId: "email", operator: "colorIs", value: ["green"] },
        { columnId: "name", operator: "isNotEmpty" },
      ],
    };
    act(() => ref.current?.stores.query.setFilter(filter));
    await waitFor(() => expect(container.querySelectorAll(".ag-row[row-id]")).toHaveLength(2));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(ref.current?.stores.query.getState().filter).toEqual(filter);
    expect(ref.current?.api()?.getFilterModel()).toEqual({ name: filter.children[1] });
  });
});

describe("setCellColor / canPaint", () => {
  it("paints the range selection optimistically in one batch; canPaint follows capabilities + selection", async () => {
    const ds = colorSource();
    const g = renderGrid({ ds });
    await g.waitForRows();
    expect(handle(g).canPaint()).toBe(false); // nothing selected
    await capsLoaded(g);
    select(g, [0, "name"], [1, "score"]);
    expect(handle(g).canPaint()).toBe(true);
    let result: Awaited<ReturnType<ReturnType<typeof handle>["setCellColor"]>> = null;
    await act(async () => {
      result = await handle(g).setCellColor("purple");
    });
    expect(ds.calls.setCellColors).toHaveBeenCalledTimes(1);
    const batch = ds.calls.setCellColors.mock.calls[0]?.[0] as CellColorBatch;
    expect(batch.changes).toHaveLength(6); // name, notes, score × r1, r2
    expect(result).toMatchObject({ rejected: [] });
    await waitFor(() => expect(cell(g, "r2", "score")).toHaveClass("sg-color-purple"));
    expect(ds.rows().find((r) => r.id === "r1")?.colors).toEqual({ name: "purple", notes: "purple", score: "purple" });
  });

  it("falls back to the focused cell and accepts an explicit target", async () => {
    const ds = colorSource();
    const g = renderGrid({ ds });
    await g.waitForRows();
    await capsLoaded(g);
    act(() => handle(g).api()?.setFocusedCell(2, "email"));
    await act(async () => {
      await handle(g).setCellColor("orange");
    });
    expect((ds.calls.setCellColors.mock.calls[0]?.[0] as CellColorBatch).changes).toEqual([
      { rowId: "r3", columnId: "email", color: "orange" },
    ]);
    await act(async () => {
      await handle(g).setCellColor(null, [{ rowId: "r3", columnId: "email" }]);
    });
    expect(ds.rows().find((r) => r.id === "r3")?.colors).toBeUndefined();
  });

  it("skips (and reports) cells the user can't paint", async () => {
    const onCellColorReport = vi.fn();
    const ds = colorSource(fixtureRows, { user: AGENT });
    const g = renderGrid({ ds, user: AGENT, props: { onCellColorReport } });
    await g.waitForRows();
    await capsLoaded(g);
    const targets = [
      { rowId: "r1", columnId: "name" },
      { rowId: "r1", columnId: "status" }, // edit: admin only
      { rowId: "r1", columnId: "total" }, // formula
    ];
    let result: Awaited<ReturnType<ReturnType<typeof handle>["setCellColor"]>> = null;
    await act(async () => {
      result = await handle(g).setCellColor("red", targets);
    });
    expect((ds.calls.setCellColors.mock.calls[0]?.[0] as CellColorBatch).changes).toEqual([
      { rowId: "r1", columnId: "name", color: "red" },
    ]);
    expect(result).toMatchObject({
      applied: [{ rowId: "r1", columnId: "name", color: "red" }],
      rejected: [
        { rowId: "r1", columnId: "status", message: "Only specific people can edit this column" },
        { rowId: "r1", columnId: "total", message: "Column is read-only (formula)" },
      ],
    });
    expect(onCellColorReport).toHaveBeenCalledWith({ color: "red", requested: 3, applied: 1, skipped: 2, rejected: 0 });
    // Only read-only cells selected → can't paint.
    select(g, [0, "status"]);
    expect(handle(g).canPaint()).toBe(false);
  });

  it("returns null (and can't paint) when the source can't write colors", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, fixtureRows, {
      capabilities: { cellColors: { read: true, write: false, filter: true } },
    });
    const g = renderGrid({ ds });
    await g.waitForRows();
    await waitFor(() => expect(handle(g).capabilities).toBeDefined());
    select(g, [0, "name"]);
    expect(handle(g).canPaint()).toBe(false);
    let result: unknown = "unset";
    await act(async () => {
      result = await handle(g).setCellColor("red");
    });
    expect(result).toBeNull();
    expect(ds.calls.setCellColors).not.toHaveBeenCalled();
  });

  it("rolls back when the source fails (and rejects)", async () => {
    const ds = colorSource();
    const g = renderGrid({ ds });
    await g.waitForRows();
    await capsLoaded(g);
    ds.failNextColors(new Error("offline"));
    await act(async () => {
      await expect(handle(g).setCellColor("red", [{ rowId: "r4", columnId: "name" }])).rejects.toThrow("offline");
    });
    await g.settle();
    expect(cell(g, "r4", "name")).not.toHaveClass("sg-cell-colored");
    expect(handle(g).canUndo()).toBe(false);
  });

  it("one undo entry per paint; undo / redo re-issue setCellColors", async () => {
    const rows = fixtureRows.map((r) => (r.id === "r2" ? { ...r, colors: { name: "gray" as const } } : r));
    const ds = colorSource(rows);
    const g = renderGrid({ rows, ds });
    await g.waitForRows();
    await capsLoaded(g);
    await act(async () => {
      await handle(g).setCellColor("red", [
        { rowId: "r1", columnId: "name" },
        { rowId: "r2", columnId: "name" },
      ]);
    });
    expect(handle(g).canUndo()).toBe(true);
    await act(async () => {
      await handle(g).undo();
    });
    expect(ds.calls.setCellColors).toHaveBeenCalledTimes(2);
    expect((ds.calls.setCellColors.mock.calls[1]?.[0] as CellColorBatch).changes).toEqual([
      { rowId: "r1", columnId: "name", color: null },
      { rowId: "r2", columnId: "name", color: "gray" },
    ]);
    await waitFor(() => expect(cell(g, "r2", "name")).toHaveClass("sg-color-gray"));
    expect(handle(g).canUndo()).toBe(false);
    await act(async () => {
      await handle(g).redo();
    });
    expect(ds.rows().find((r) => r.id === "r2")?.colors).toEqual({ name: "red" });
    await waitFor(() => expect(cell(g, "r2", "name")).toHaveClass("sg-color-red"));
  });

  it("an edit and a row refresh after a paint keep the colors", async () => {
    const ds = colorSource();
    const g = renderGrid({ ds, props: { refetchAfterSave: true } });
    await g.waitForRows();
    await capsLoaded(g);
    await act(async () => {
      await handle(g).setCellColor("teal", [{ rowId: "r1", columnId: "name" }]);
    });
    await editCell(g, "r1", "email", "new@example.com");
    await waitFor(() => expect(ds.rows().find((r) => r.id === "r1")?.cells.email).toBe("new@example.com"));
    await g.settle();
    expect(handle(g).stores.rows.getRow("r1")?.colors).toEqual({ name: "teal" });
    await act(async () => {
      await handle(g).refreshRows(["r1"]);
    });
    expect(handle(g).stores.rows.getRow("r1")?.colors).toEqual({ name: "teal" });
    expect(cell(g, "r1", "name")).toHaveClass("sg-color-teal");
  });
});

describe("change feed", () => {
  it("merges colors painted elsewhere (same version) from the poll", async () => {
    const ds = colorSource();
    const g = renderGrid({ ds, props: { poll: { intervalMs: 30, enabled: true } } });
    await g.waitForRows();
    await capsLoaded(g);
    await ds.setCellColors({ id: "elsewhere", changes: [{ rowId: "r4", columnId: "email", color: "yellow" }] });
    await waitFor(() => expect(cell(g, "r4", "email")).toHaveClass("sg-color-yellow"), { timeout: 2000 });
    expect(handle(g).stores.rows.getRow("r4")?.version).toBe(1);
  });
});

describe("views + schema", () => {
  it("a schema column deletion drops dangling rule targets (and rules left without one)", async () => {
    const onViewChange = vi.fn();
    const ds = colorSource();
    const rules: ColorRule[] = [
      { ...paidName, target: { kind: "cells", columnIds: ["name", "email"] } },
      { id: "e", color: "blue", target: { kind: "cells", columnIds: ["email"] }, when: { columnId: "name", operator: "isNotEmpty" } },
      openRow,
    ];
    const ref = createRef<SchemaGridHandle<GridRow>>();
    const v = view({ colorRules: rules });
    const Host = (p: { schema: GridSchema }) => (
      <div style={{ width: 1600, height: 800 }}>
        <SchemaGrid<GridRow>
          ref={ref}
          schema={p.schema}
          dataSource={ds}
          user={ADMIN}
          view={v}
          onViewChange={onViewChange}
          gridOptions={TEST_GRID_OPTIONS}
        />
      </div>
    );
    const utils = render(<Host schema={fixtureSchema} />);
    await waitFor(() => expect(ref.current?.api()).toBeTruthy());
    expect(ref.current?.colorRules).toEqual(rules);
    const smaller: GridSchema = { ...fixtureSchema, columns: fixtureSchema.columns.filter((c) => c.id !== "email") };
    utils.rerender(<Host schema={smaller} />);
    await waitFor(() => expect(ref.current?.colorRules).toEqual([{ ...paidName, target: { kind: "cells", columnIds: ["name"] } }, openRow]));
    expect(onViewChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ colorRules: [{ ...paidName, target: { kind: "cells", columnIds: ["name"] } }, openRow] }),
    );
    utils.unmount();
  });
});

describe("server mode query", () => {
  it("sends colorRules with fetches; a rules change refetches only with a color condition", async () => {
    const ds = colorSource();
    const g = renderGrid({ ds, props: { mode: "server", view: view({ colorRules: [openRow] }) } });
    await g.waitForRows();
    const queries = () => ds.calls.fetch.mock.calls.map((c) => c[0] as GridQuery);
    await waitFor(() => expect(queries().at(-1)?.colorRules).toEqual([openRow]));
    const before = queries().length;
    act(() => handle(g).setColorRules([paidName]));
    await g.settle(80);
    expect(queries().length).toBe(before);
    await waitFor(() => expect(cell(g, "r1", "name")).toHaveClass("sg-color-red"));

    act(() => handle(g).stores.query.setFilter({ columnId: "name", operator: "colorIs", value: ["red"] }));
    await g.waitForRows(1);
    const withFilter = queries().length;
    act(() => handle(g).setColorRules([{ ...paidName, when: { columnId: "payment", operator: "is", value: "pending" } }]));
    await waitFor(() => expect(queries().length).toBeGreaterThan(withFilter));
    expect(queries().at(-1)?.colorRules?.[0]?.when).toEqual({ columnId: "payment", operator: "is", value: "pending" });
    await waitFor(() => expect(rowEls(g, "r2")).toHaveLength(1));
  });

  it("exportCurrentView pages with the rules", async () => {
    const ds = colorSource();
    const buildExportBlob = vi.fn(async () => new Blob(["x"]));
    const g = renderGrid({ ds, props: { mode: "server", view: view({ colorRules: [openRow] }), io: { buildExportBlob } } });
    await g.waitForRows();
    ds.calls.fetch.mockClear();
    await act(async () => {
      await handle(g).exportCurrentView("csv");
    });
    expect((ds.calls.fetch.mock.calls[0]?.[0] as GridQuery).colorRules).toEqual([openRow]);
  });
});
