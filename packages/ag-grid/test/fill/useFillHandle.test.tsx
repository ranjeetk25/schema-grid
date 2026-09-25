import type { CellClassParams, CellMouseOverEvent, Column, GridApi, IRowNode } from "ag-grid-community";
import { act, renderHook, waitFor } from "@testing-library/react";
import { type MutableRefObject, useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { computeFillTarget, type FillReport, useFillHandle } from "../../src/fill/useFillHandle";
import { createKeyboardRegistry } from "../../src/grid/keyboard";
import { createDefaultRegistry, type ChangeBatch, type GridRow } from "../../src/internal/core";
import { createRangeCellClassRules } from "../../src/range/useRangeSelection";
import { createRangeStore } from "../../src/state/rangeStore";
import { SG_CLASSES } from "../../src/theme/classNames";
import { createFakeGridApi, type FakeColumnSpec } from "../fixtures/fakeGridApi";
import { fixtureSchema, row } from "../fixtures/schema";
import { renderGrid } from "../renderGrid";

const COLS: FakeColumnSpec[] = [{ colId: "name" }, { colId: "score" }, { colId: "status" }, { colId: "email" }];
const ROWS: GridRow[] = [
  row("a", { name: "A", score: 1, status: "s1", email: "a@x.io" }),
  row("b", { name: "B", score: 2, status: "s2", email: "b@x.io" }),
  row("c", { name: "C", score: null, status: null, email: null }),
  row("d", { name: "D", score: null, status: null, email: null }),
  row("e", { name: "E", score: null, status: null, email: null }),
];

function setup(opts: { readOnly?: string[] } = {}) {
  const fake = createFakeGridApi<GridRow>({ columns: COLS, rows: ROWS });
  const rangeStore = createRangeStore();
  const keyboard = createKeyboardRegistry<GridRow>();
  const submit = vi.fn(async (_changes: ChangeBatch["changes"], _source: ChangeBatch["source"]) => ({}) as never);
  const announce = vi.fn();
  const onReport = vi.fn<(r: FillReport) => void>();
  const readOnly = new Set(opts.readOnly ?? []);
  const registry = createDefaultRegistry();
  const hook = renderHook(() => {
    const apiRef = useRef<GridApi<GridRow> | null>(fake.api) as MutableRefObject<GridApi<GridRow> | null>;
    return useFillHandle<GridRow>({
      apiRef,
      rangeStore,
      controller: { submit },
      schema: fixtureSchema,
      registry,
      canEditCell: (_row, columnId) => !readOnly.has(columnId),
      keyboard,
      announce,
      onReport,
    });
  });
  return { fake, rangeStore, keyboard, submit, announce, onReport, hook, h: () => hook.result.current };
}

const column = (colId: string) => ({ getColId: () => colId, getId: () => colId }) as unknown as Column;
function over(api: GridApi<GridRow>, rowIndex: number, colId: string): CellMouseOverEvent<GridRow> {
  return {
    node: api.getDisplayedRowAtIndex(rowIndex),
    column: column(colId),
    event: new MouseEvent("mouseover", { buttons: 1 }),
    api,
  } as unknown as CellMouseOverEvent<GridRow>;
}
function pointerDown() {
  return { button: 0, stopPropagation: vi.fn(), preventDefault: vi.fn() };
}
const pointerUp = () => act(() => document.dispatchEvent(new Event("pointerup")));

describe("computeFillTarget", () => {
  const ids = ["a", "b", "c", "d"];
  const source = { rowStart: 1, rowEnd: 2, colIds: ["a", "b"] };

  it("locks to the dominant axis (down wins ties) and only extends beyond the source", () => {
    expect(computeFillTarget(source, { rowIndex: 5, colId: "c" }, ids)).toEqual({
      axis: "down",
      target: { rowStart: 1, rowEnd: 5, colIds: ["a", "b"] },
      preview: { rowStart: 3, rowEnd: 5, colIds: ["a", "b"] },
    });
    expect(computeFillTarget(source, { rowIndex: 3, colId: "d" }, ids)).toEqual({
      axis: "right",
      target: { rowStart: 1, rowEnd: 2, colIds: ["a", "b", "c", "d"] },
      preview: { rowStart: 1, rowEnd: 2, colIds: ["c", "d"] },
    });
    expect(computeFillTarget(source, { rowIndex: 3, colId: "c" }, ids)?.axis).toBe("down");
  });

  it("returns null inside the source and for up/left (out of scope)", () => {
    expect(computeFillTarget(source, { rowIndex: 2, colId: "b" }, ids)).toBeNull();
    expect(computeFillTarget(source, { rowIndex: 0, colId: "a" }, ids)).toBeNull();
    expect(computeFillTarget({ ...source, colIds: ["c"] }, { rowIndex: 1, colId: "a" }, ids)).toBeNull();
    expect(computeFillTarget(source, { rowIndex: 3, colId: "zz" }, ids)).toBeNull();
  });
});

describe("useFillHandle", () => {
  it("handle down, over and up submits ONE 'fill' batch and selects the filled range", async () => {
    const { fake, rangeStore, submit, h, announce, onReport } = setup();
    act(() => {
      rangeStore.setAnchor({ rowIndex: 0, colId: "score" });
      rangeStore.setFocus({ rowIndex: 1, colId: "score" });
    });
    const ev = pointerDown();
    act(() => h().onFillHandlePointerDown(ev, { rowIndex: 1, colId: "score" }));
    expect(ev.stopPropagation).toHaveBeenCalled();
    expect(h().isFilling()).toBe(true);

    act(() => h().onCellMouseOver(over(fake.api, 3, "score")));
    expect(rangeStore.getState().fillPreview).toEqual({ rowStart: 2, rowEnd: 3, colIds: ["score"] });
    act(() => h().onCellMouseOver(over(fake.api, 4, "score")));
    expect(rangeStore.getState().fillPreview).toEqual({ rowStart: 2, rowEnd: 4, colIds: ["score"] });

    pointerUp();
    expect(submit).toHaveBeenCalledTimes(1);
    const [changes, source] = submit.mock.calls[0] ?? [];
    expect(source).toBe("fill");
    expect(changes?.map((c) => [c.rowId, c.columnId, c.next])).toEqual([
      ["c", "score", 3],
      ["d", "score", 4],
      ["e", "score", 5],
    ]);
    expect(rangeStore.getState().fillPreview).toBeNull();
    expect(rangeStore.get()).toEqual({ anchor: { rowIndex: 0, colId: "score" }, focus: { rowIndex: 4, colId: "score" } });
    expect(h().isFilling()).toBe(false);
    expect(announce).toHaveBeenCalledWith("Fill: 3 cells filled", "polite");
    expect(onReport).toHaveBeenCalledWith({ axis: "down", filledCells: 3, skippedReadOnly: 0 });
    // A later pointerup is a no-op.
    pointerUp();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("locks the axis: a mostly-rightward drag fills right only", () => {
    const { fake, rangeStore, submit, h } = setup();
    act(() => rangeStore.setAnchor({ rowIndex: 0, colId: "name" }));
    act(() => h().onFillHandlePointerDown(pointerDown(), { rowIndex: 0, colId: "name" }));
    act(() => h().onCellMouseOver(over(fake.api, 1, "email")));
    expect(rangeStore.getState().fillPreview).toEqual({ rowStart: 0, rowEnd: 0, colIds: ["score", "status", "email"] });
    act(() => h().onCellMouseOver(over(fake.api, 3, "score")));
    expect(rangeStore.getState().fillPreview).toEqual({ rowStart: 1, rowEnd: 3, colIds: ["name"] });
    act(() => h().onCellMouseOver(over(fake.api, 0, "status")));
    pointerUp();
    const [changes] = submit.mock.calls[0] ?? [];
    expect(new Set(changes?.map((c) => c.rowId))).toEqual(new Set(["a"]));
    expect(changes?.map((c) => c.columnId)).toEqual(["score", "status"]);
  });

  it("Esc cancels without a submit (root key registry and document)", () => {
    const { fake, rangeStore, submit, keyboard, h } = setup();
    act(() => rangeStore.setAnchor({ rowIndex: 0, colId: "score" }));
    act(() => h().onFillHandlePointerDown(pointerDown(), { rowIndex: 0, colId: "score" }));
    act(() => h().onCellMouseOver(over(fake.api, 3, "score")));
    const esc = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    act(() => keyboard.handleRootKeyDown(esc));
    expect(esc.defaultPrevented).toBe(true);
    expect(h().isFilling()).toBe(false);
    expect(rangeStore.getState().fillPreview).toBeNull();
    pointerUp();
    expect(submit).not.toHaveBeenCalled();
    expect(rangeStore.get()).toEqual({ anchor: { rowIndex: 0, colId: "score" }, focus: { rowIndex: 0, colId: "score" } });

    // Focus outside the grid root: the document listener still cancels.
    act(() => h().onFillHandlePointerDown(pointerDown(), { rowIndex: 0, colId: "score" }));
    act(() => h().onCellMouseOver(over(fake.api, 2, "score")));
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    pointerUp();
    expect(submit).not.toHaveBeenCalled();
  });

  it("read-only targets are skipped and reported", () => {
    const { fake, rangeStore, submit, h, announce, onReport } = setup({ readOnly: ["status"] });
    act(() => rangeStore.setAnchor({ rowIndex: 0, colId: "name" }));
    act(() => rangeStore.setFocus({ rowIndex: 0, colId: "name" }));
    act(() => h().onFillHandlePointerDown(pointerDown(), { rowIndex: 0, colId: "name" }));
    act(() => h().onCellMouseOver(over(fake.api, 0, "email")));
    pointerUp();
    const [changes] = submit.mock.calls[0] ?? [];
    expect(changes?.map((c) => c.columnId)).toEqual(["score", "email"]);
    expect(announce).toHaveBeenCalledWith("Fill: 2 cells filled, 1 read-only cell skipped", "polite");
    expect(onReport).toHaveBeenCalledWith({ axis: "right", filledCells: 2, skippedReadOnly: 1 });
  });

  it("everything read-only: no submit, still reported", () => {
    const { fake, rangeStore, submit, h, onReport } = setup({ readOnly: ["score"] });
    act(() => rangeStore.setAnchor({ rowIndex: 0, colId: "score" }));
    act(() => h().onFillHandlePointerDown(pointerDown(), { rowIndex: 0, colId: "score" }));
    act(() => h().onCellMouseOver(over(fake.api, 2, "score")));
    pointerUp();
    expect(submit).not.toHaveBeenCalled();
    expect(onReport).toHaveBeenCalledWith({ axis: "down", filledCells: 0, skippedReadOnly: 2 });
  });

  it("ignores non-primary buttons and mouse-over when not filling; release inside the source is a no-op", () => {
    const { fake, rangeStore, submit, h } = setup();
    act(() => rangeStore.setAnchor({ rowIndex: 0, colId: "score" }));
    act(() => h().onFillHandlePointerDown({ ...pointerDown(), button: 2 }, { rowIndex: 0, colId: "score" }));
    expect(h().isFilling()).toBe(false);
    act(() => h().onCellMouseOver(over(fake.api, 3, "score")));
    expect(rangeStore.getState().fillPreview).toBeNull();
    act(() => h().onFillHandlePointerDown(pointerDown(), { rowIndex: 0, colId: "score" }));
    act(() => h().onCellMouseOver(over(fake.api, 2, "score")));
    act(() => h().onCellMouseOver(over(fake.api, 0, "score")));
    expect(rangeStore.getState().fillPreview).toBeNull();
    pointerUp();
    expect(submit).not.toHaveBeenCalled();
  });

  it("refreshes preview cells in one batched refreshCells; the rule marks them dashed", () => {
    const { fake, rangeStore, h } = setup();
    act(() => rangeStore.setAnchor({ rowIndex: 0, colId: "score" }));
    act(() => h().onFillHandlePointerDown(pointerDown(), { rowIndex: 0, colId: "score" }));
    fake.spies.refreshCells?.mockClear();
    act(() => h().onCellMouseOver(over(fake.api, 2, "score")));
    expect(fake.spies.refreshCells).toHaveBeenCalledTimes(1);
    const arg = fake.spies.refreshCells?.mock.calls[0]?.[0] as { rowNodes: IRowNode[]; columns: string[] };
    expect(arg.rowNodes.map((n) => n.rowIndex)).toEqual([1, 2]);
    expect(arg.columns).toEqual(["score"]);

    const rules = createRangeCellClassRules<GridRow>();
    const rule = rules[SG_CLASSES.fillPreview] as (p: CellClassParams<GridRow>) => boolean;
    const params = (rowIndex: number, colId: string) =>
      ({
        node: fake.api.getDisplayedRowAtIndex(rowIndex),
        colDef: { colId },
        column: column(colId),
        api: fake.api,
        context: { dataSource: {}, events: () => undefined, stores: { range: rangeStore } },
      }) as unknown as CellClassParams<GridRow>;
    expect(rule(params(2, "score"))).toBe(true);
    expect(rule(params(0, "score"))).toBe(false);
    expect(rule(params(2, "name"))).toBe(false);
  });

  it("removes document listeners and clears the preview on unmount", () => {
    const { fake, rangeStore, submit, h, hook } = setup();
    const remove = vi.spyOn(document, "removeEventListener");
    act(() => rangeStore.setAnchor({ rowIndex: 0, colId: "score" }));
    act(() => h().onFillHandlePointerDown(pointerDown(), { rowIndex: 0, colId: "score" }));
    act(() => h().onCellMouseOver(over(fake.api, 2, "score")));
    hook.unmount();
    expect(remove).toHaveBeenCalledWith("pointerup", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("keydown", expect.any(Function));
    expect(rangeStore.getState().fillPreview).toBeNull();
    pointerUp();
    expect(submit).not.toHaveBeenCalled();
    remove.mockRestore();
  });
});

describe("<SchemaGrid> fill handle (integration)", () => {
  const cellEl = (container: HTMLElement, rowId: string, colId: string) =>
    container.querySelector(`.ag-row[row-id="${rowId}"] .ag-cell[col-id="${colId}"]`) as HTMLElement;

  it("drag the handle down over cells → one 'fill' applyChanges batch", async () => {
    const { container, waitForRows, handle, ds } = renderGrid();
    await waitForRows();
    act(() => {
      handle.current?.stores.range.setAnchor({ rowIndex: 0, colId: "name" });
    });
    const fillHandle = await waitFor(() => {
      const el = cellEl(container, "r1", "name").querySelector("[data-sg-fill-handle]");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    act(() => {
      fillHandle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, buttons: 1 }));
    });
    act(() => {
      cellEl(container, "r3", "name").dispatchEvent(new MouseEvent("mouseover", { bubbles: true, buttons: 1 }));
    });
    await waitFor(() =>
      expect(handle.current?.stores.range.getState().fillPreview).toEqual({ rowStart: 1, rowEnd: 2, colIds: ["name"] }),
    );
    await waitFor(() => expect(cellEl(container, "r2", "name").classList.contains(SG_CLASSES.fillPreview)).toBe(true));
    // The range was not reset by the handle's pointerdown.
    expect(handle.current?.stores.range.get()?.anchor).toEqual({ rowIndex: 0, colId: "name" });
    act(() => {
      document.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    });
    await waitFor(() => expect(ds.calls.applyChanges).toHaveBeenCalledTimes(1));
    const batch = ds.calls.applyChanges.mock.calls[0]?.[0] as ChangeBatch;
    expect(batch.source).toBe("fill");
    expect(batch.changes.map((c) => [c.rowId, c.columnId, c.next])).toEqual([
      ["r2", "name", "Asha"],
      ["r3", "name", "Asha"],
    ]);
    expect(handle.current?.stores.range.get()?.focus).toEqual({ rowIndex: 2, colId: "name" });
    await waitFor(() => expect(cellEl(container, "r2", "name").classList.contains(SG_CLASSES.fillPreview)).toBe(false));
  });

  it.todo("real drag of the fill handle, including fills that cross virtualised rows (Playwright: see playwright-scenarios.md)");
});
