import type {
  CellClassParams,
  CellFocusedEvent,
  CellMouseDownEvent,
  CellMouseOverEvent,
  Column,
  GridApi,
  IRowNode,
  SuppressKeyboardEventParams,
} from "ag-grid-community";
import type { CustomCellRendererProps } from "ag-grid-react";
import { act, fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import { afterAll, beforeAll } from "vitest";
import { type MutableRefObject, useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { createKeyboardRegistry, matchesShortcut, withSuppressKeyboardEvent } from "../../src/grid/keyboard";
import type { GridRow } from "../../src/internal/core";
import { createCellShell, wrapWithCellShell } from "../../src/range/CellShell";
import {
  createRangeCellClassRules,
  normalizedRangeFor,
  rangeRefreshTargets,
  rangeSizeMessage,
  useRangeSelection,
} from "../../src/range/useRangeSelection";
import { createRangeStore, type RangeStore } from "../../src/state/rangeStore";
import { SG_CLASSES } from "../../src/theme/classNames";
import { createFakeGridApi, type FakeColumnSpec } from "../fixtures/fakeGridApi";
import { fixtureRows } from "../fixtures/schema";
import { renderGrid } from "../renderGrid";

const COLS: FakeColumnSpec[] = [{ colId: "a" }, { colId: "b" }, { colId: "c" }, { colId: "d" }];
const ROWS = fixtureRows.slice(0, 3).concat(fixtureRows.slice(0, 1).map((r) => ({ ...r, id: "r4" })));

function setup(columns: FakeColumnSpec[] = COLS, rows: GridRow[] = ROWS) {
  const fake = createFakeGridApi<GridRow>({ columns, rows });
  const store = createRangeStore();
  const keyboard = createKeyboardRegistry<GridRow>();
  const announce = vi.fn();
  const hook = renderHook(() => {
    const apiRef = useRef<GridApi<GridRow> | null>(fake.api) as MutableRefObject<GridApi<GridRow> | null>;
    return useRangeSelection<GridRow>(apiRef, store, { keyboard, announce });
  });
  return { fake, store, keyboard, announce, hook, h: () => hook.result.current };
}

const column = (colId: string) => ({ getColId: () => colId, getId: () => colId }) as unknown as Column;
function node(api: GridApi<GridRow>, rowIndex: number): IRowNode<GridRow> {
  return api.getDisplayedRowAtIndex(rowIndex) as IRowNode<GridRow>;
}
function mouse(type: string, init: MouseEventInit = {}): MouseEvent {
  return new MouseEvent(type, { button: 0, buttons: 1, bubbles: true, ...init });
}
function mouseDown(api: GridApi<GridRow>, rowIndex: number, colId: string, init: MouseEventInit = {}) {
  return { node: node(api, rowIndex), column: column(colId), event: mouse("mousedown", init), api } as unknown as CellMouseDownEvent<GridRow>;
}
function mouseOver(api: GridApi<GridRow>, rowIndex: number, colId: string, init: MouseEventInit = {}) {
  return { node: node(api, rowIndex), column: column(colId), event: mouse("mouseover", init), api } as unknown as CellMouseOverEvent<GridRow>;
}
function focused(api: GridApi<GridRow>, rowIndex: number, colId: string, sourceEvent?: Event) {
  return { rowIndex, column: column(colId), rowPinned: null, api, sourceEvent } as unknown as CellFocusedEvent<GridRow>;
}
function key(
  api: GridApi<GridRow>,
  rowIndex: number,
  colId: string,
  keyName: string,
  init: KeyboardEventInit = {},
  editing = false,
): SuppressKeyboardEventParams<GridRow> {
  return {
    event: new KeyboardEvent("keydown", { key: keyName, shiftKey: true, cancelable: true, ...init }),
    editing,
    node: node(api, rowIndex),
    column: column(colId),
    colDef: { colId },
    data: node(api, rowIndex).data,
    api,
    context: undefined,
  } as unknown as SuppressKeyboardEventParams<GridRow>;
}
const refreshedColumns = (spy: ReturnType<typeof vi.fn>, call = 0) =>
  (spy.mock.calls[call]?.[0] as { columns: string[] }).columns.slice().sort();
const refreshedRows = (spy: ReturnType<typeof vi.fn>, call = 0) =>
  (spy.mock.calls[call]?.[0] as { rowNodes: IRowNode[]; force: boolean }).rowNodes.map((n) => n.rowIndex).sort();

describe("useRangeSelection — mouse", () => {
  it("plain mousedown sets the anchor, drag over extends, document mouseup ends the drag", () => {
    const { fake, store, h } = setup();
    act(() => h().onCellMouseDown(mouseDown(fake.api, 0, "a")));
    expect(store.get()).toEqual({ anchor: { rowIndex: 0, colId: "a" }, focus: { rowIndex: 0, colId: "a" } });
    expect(store.getState().dragging).toBe(true);
    act(() => h().onCellMouseOver(mouseOver(fake.api, 2, "c")));
    expect(store.get()?.focus).toEqual({ rowIndex: 2, colId: "c" });
    act(() => {
      document.dispatchEvent(new MouseEvent("mouseup"));
    });
    expect(store.getState().dragging).toBe(false);
    act(() => h().onCellMouseOver(mouseOver(fake.api, 1, "b")));
    expect(store.get()?.focus).toEqual({ rowIndex: 2, colId: "c" });
  });

  it("Shift+mousedown extends the existing range; a plain click resets it", () => {
    const { fake, store, h } = setup();
    act(() => h().onCellMouseDown(mouseDown(fake.api, 0, "a")));
    act(() => document.dispatchEvent(new MouseEvent("mouseup")));
    act(() => h().onCellMouseDown(mouseDown(fake.api, 2, "b", { shiftKey: true })));
    expect(store.get()).toEqual({ anchor: { rowIndex: 0, colId: "a" }, focus: { rowIndex: 2, colId: "b" } });
    act(() => document.dispatchEvent(new MouseEvent("mouseup")));
    act(() => h().onCellMouseDown(mouseDown(fake.api, 1, "c")));
    expect(store.get()).toEqual({ anchor: { rowIndex: 1, colId: "c" }, focus: { rowIndex: 1, colId: "c" } });
  });

  it("ignores non-primary buttons and full-width (group) rows", () => {
    const group = { __sg: "group", id: "g1", level: 0, columnId: "a", key: "x", label: "x", count: 1, aggregates: {}, expanded: true, groupPath: [] };
    const { fake, store, h } = setup(COLS, [group as unknown as GridRow, ...ROWS]);
    act(() => h().onCellMouseDown(mouseDown(fake.api, 0, "a")));
    expect(store.get()).toBeNull();
    act(() => h().onCellMouseDown(mouseDown(fake.api, 1, "a")));
    act(() => h().onCellMouseOver(mouseOver(fake.api, 0, "b")));
    expect(store.get()?.focus).toEqual({ rowIndex: 1, colId: "a" });
  });

  it("removes the document mouseup listener on unmount", () => {
    const { fake, store, h, hook } = setup();
    const remove = vi.spyOn(document, "removeEventListener");
    act(() => h().onCellMouseDown(mouseDown(fake.api, 0, "a")));
    hook.unmount();
    expect(remove).toHaveBeenCalledWith("mouseup", expect.any(Function), true);
    expect(remove).toHaveBeenCalledWith("pointerup", expect.any(Function), true);
    expect(store.getState().dragging).toBe(false);
    remove.mockRestore();
  });
});

describe("useRangeSelection — focus and keyboard", () => {
  it("keyboard focus sets the anchor; mouse-initiated or same-cell focus does not", () => {
    const { fake, store, h } = setup();
    act(() => h().onCellFocused(focused(fake.api, 1, "b")));
    expect(store.get()).toEqual({ anchor: { rowIndex: 1, colId: "b" }, focus: { rowIndex: 1, colId: "b" } });
    act(() => h().onCellMouseDown(mouseDown(fake.api, 0, "a")));
    act(() => h().onCellMouseOver(mouseOver(fake.api, 2, "c")));
    act(() => h().onCellFocused(focused(fake.api, 3, "d")));
    expect(store.get()?.anchor).toEqual({ rowIndex: 0, colId: "a" }); // dragging
    act(() => document.dispatchEvent(new MouseEvent("mouseup")));
    act(() => h().onCellFocused(focused(fake.api, 3, "d", mouse("mousedown", { shiftKey: true }))));
    expect(store.get()?.anchor).toEqual({ rowIndex: 0, colId: "a" }); // mouse focus → left to mousedown
    act(() => h().onCellFocused(focused(fake.api, 2, "c")));
    expect(store.get()?.anchor).toEqual({ rowIndex: 0, colId: "a" }); // same as range focus
  });

  it("Shift+ArrowDown extends, focuses the new focus cell and suppresses the grid default", () => {
    const { fake, store, keyboard } = setup();
    act(() => store.setAnchor({ rowIndex: 0, colId: "a" }));
    const params = key(fake.api, 0, "a", "ArrowDown");
    let handled = false;
    act(() => {
      handled = keyboard.suppressKeyboardEvent(params);
    });
    expect(handled).toBe(true);
    expect(params.event.defaultPrevented).toBe(true);
    expect(store.get()).toEqual({ anchor: { rowIndex: 0, colId: "a" }, focus: { rowIndex: 1, colId: "a" } });
    expect(fake.spies.setFocusedCell).toHaveBeenLastCalledWith(1, "a");
    act(() => {
      keyboard.suppressKeyboardEvent(key(fake.api, 1, "a", "ArrowRight"));
    });
    expect(store.get()?.focus).toEqual({ rowIndex: 1, colId: "b" });
  });

  it("Shift+Arrow starts from the focused cell when the range is elsewhere; ignores editing and plain arrows", () => {
    const { fake, store, keyboard } = setup();
    act(() => store.setAnchor({ rowIndex: 3, colId: "d" }));
    act(() => {
      keyboard.suppressKeyboardEvent(key(fake.api, 1, "b", "ArrowUp"));
    });
    expect(store.get()).toEqual({ anchor: { rowIndex: 1, colId: "b" }, focus: { rowIndex: 0, colId: "b" } });
    expect(keyboard.suppressKeyboardEvent(key(fake.api, 0, "b", "ArrowDown", {}, true))).toBe(false);
    expect(keyboard.suppressKeyboardEvent(key(fake.api, 0, "b", "ArrowDown", { shiftKey: false }))).toBe(false);
    expect(keyboard.suppressKeyboardEvent(key(fake.api, 0, "b", "ArrowDown", { ctrlKey: true }))).toBe(false);
  });

  it("hidden columns are never part of the range", () => {
    const { fake, store, keyboard } = setup([{ colId: "a" }, { colId: "b", hide: true }, { colId: "c" }]);
    act(() => store.setAnchor({ rowIndex: 0, colId: "a" }));
    act(() => {
      keyboard.suppressKeyboardEvent(key(fake.api, 0, "a", "ArrowRight"));
    });
    expect(store.get()?.focus).toEqual({ rowIndex: 0, colId: "c" });
    expect(normalizedRangeFor(fake.api, store.get())?.colIds).toEqual(["a", "c"]);
  });
});

describe("useRangeSelection — refresh and announce", () => {
  it("refreshes only the changed cells, in one batched call", () => {
    const { fake, store } = setup();
    act(() => store.setAnchor({ rowIndex: 0, colId: "a" }));
    act(() => store.setFocus({ rowIndex: 0, colId: "b" }));
    fake.spies.refreshCells?.mockClear();
    act(() => store.setFocus({ rowIndex: 0, colId: "c" }));
    // c joins; b loses its right edge. a is untouched.
    expect(fake.spies.refreshCells).toHaveBeenCalledTimes(1);
    expect(refreshedColumns(fake.spies.refreshCells as ReturnType<typeof vi.fn>)).toEqual(["b", "c"]);
    expect(refreshedRows(fake.spies.refreshCells as ReturnType<typeof vi.fn>)).toEqual([0]);
    expect((fake.spies.refreshCells?.mock.calls[0]?.[0] as { force?: boolean }).force).toBeUndefined();

    fake.spies.refreshCells?.mockClear();
    act(() => store.setDragging(true));
    expect(fake.spies.refreshCells).not.toHaveBeenCalled();
  });

  it("rangeRefreshTargets = rangeDiff + cells whose edges changed", () => {
    const prev = { rowStart: 0, rowEnd: 1, colIds: ["a", "b"] };
    const next = { rowStart: 0, rowEnd: 2, colIds: ["a", "b"] };
    const keys = rangeRefreshTargets(prev, next).map((c) => `${c.rowIndex}${c.colId}`).sort();
    expect(keys).toEqual(["1a", "1b", "2a", "2b"]);
    expect(rangeRefreshTargets(null, { rowStart: 0, rowEnd: 0, colIds: ["a"] })).toEqual([{ rowIndex: 0, colId: "a" }]);
  });

  it("announces the range size (singular forms, > 1 cell only, after a drag ends)", () => {
    expect(rangeSizeMessage({ rows: 3, cols: 2 })).toBe("3 rows by 2 columns selected");
    expect(rangeSizeMessage({ rows: 1, cols: 2 })).toBe("1 row by 2 columns selected");
    expect(rangeSizeMessage({ rows: 2, cols: 1 })).toBe("2 rows by 1 column selected");
    expect(rangeSizeMessage({ rows: 1, cols: 1 })).toBeNull();

    const { fake, announce, h } = setup();
    act(() => h().onCellMouseDown(mouseDown(fake.api, 0, "a")));
    act(() => h().onCellMouseOver(mouseOver(fake.api, 2, "b")));
    expect(announce).not.toHaveBeenCalled();
    act(() => document.dispatchEvent(new MouseEvent("mouseup")));
    expect(announce).toHaveBeenCalledWith("3 rows by 2 columns selected", "polite");
  });
});

describe("range cellClassRules", () => {
  it("mark range membership and edges from params.context.stores.range", () => {
    const { fake } = setup();
    const store = createRangeStore();
    store.setAnchor({ rowIndex: 0, colId: "a" });
    store.setFocus({ rowIndex: 1, colId: "b" });
    const rules = createRangeCellClassRules<GridRow>();
    const context = { dataSource: {}, events: () => undefined, stores: { range: store } };
    const classesOf = (rowIndex: number, colId: string) =>
      Object.entries(rules)
        .filter(([, fn]) =>
          (fn as (p: CellClassParams<GridRow>) => boolean)({
            node: node(fake.api, rowIndex),
            colDef: { colId },
            column: column(colId),
            api: fake.api,
            context,
          } as unknown as CellClassParams<GridRow>),
        )
        .map(([cls]) => cls)
        .sort();
    expect(classesOf(0, "a")).toEqual([SG_CLASSES.range, SG_CLASSES.rangeLeft, SG_CLASSES.rangeTop].sort());
    expect(classesOf(1, "b")).toEqual([SG_CLASSES.range, SG_CLASSES.rangeBottom, SG_CLASSES.rangeRight].sort());
    expect(classesOf(2, "a")).toEqual([]);
  });
});

describe("keyboard registry", () => {
  it("composes handlers first-true-wins and with a column's own suppressKeyboardEvent", () => {
    const reg = createKeyboardRegistry<GridRow>();
    const first = vi.fn(() => false);
    const second = vi.fn(() => true);
    const third = vi.fn(() => true);
    reg.register(first);
    const off = reg.register(second);
    reg.register(third);
    const p = {} as SuppressKeyboardEventParams<GridRow>;
    expect(reg.suppressKeyboardEvent(p)).toBe(true);
    expect(third).not.toHaveBeenCalled();
    off();
    reg.suppressKeyboardEvent(p);
    expect(third).toHaveBeenCalled();
    const own = vi.fn(() => false);
    const [def] = withSuppressKeyboardEvent([{ colId: "x", suppressKeyboardEvent: own }], reg.suppressKeyboardEvent);
    expect(def?.suppressKeyboardEvent?.(p)).toBe(true);
    expect(own).toHaveBeenCalled();

    const root = vi.fn((e: KeyboardEvent) => e.key === "z");
    reg.registerRoot(root);
    const ev = new KeyboardEvent("keydown", { key: "z", cancelable: true });
    reg.handleRootKeyDown(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});

describe("CellShell", () => {
  function shellProps(store: RangeStore, api: GridApi<GridRow>, rowIndex: number, colId: string, extra = {}) {
    return {
      api,
      node: node(api, rowIndex),
      column: column(colId),
      context: { dataSource: {}, events: () => undefined, stores: { range: store }, ...extra },
      value: "v",
    } as unknown as CustomCellRendererProps<GridRow>;
  }
  const Inner = (p: CustomCellRendererProps<GridRow>) => <span data-testid="inner">{String(p.value)}</span>;

  it("renders the fill handle only in the range's bottom-right cell and follows the store", () => {
    const { fake } = setup();
    const store = createRangeStore();
    const Shell = wrapWithCellShell<GridRow>(Inner);
    expect(wrapWithCellShell<GridRow>(Inner)).toBe(Shell);
    const renderSpy = vi.fn();
    const Counting = createCellShell<GridRow>((p) => {
      renderSpy();
      return <Inner {...p} />;
    });
    const view = render(
      <div>
        <div data-cell="0a"><Shell {...shellProps(store, fake.api, 0, "a")} /></div>
        <div data-cell="1b"><Shell {...shellProps(store, fake.api, 1, "b")} /></div>
        <div data-cell="2c"><Counting {...shellProps(store, fake.api, 2, "c")} /></div>
      </div>,
    );
    const handleIn = (k: string) => view.container.querySelector(`[data-cell="${k}"] [data-sg-fill-handle]`);
    expect(view.getAllByTestId("inner")).toHaveLength(3);
    expect(handleIn("0a")).toBeNull();
    act(() => store.setAnchor({ rowIndex: 0, colId: "a" }));
    expect(handleIn("0a")).not.toBeNull();
    expect(handleIn("0a")?.classList.contains(SG_CLASSES.fillHandle)).toBe(true);
    const before = renderSpy.mock.calls.length;
    act(() => store.setFocus({ rowIndex: 1, colId: "b" }));
    expect(handleIn("0a")).toBeNull();
    expect(handleIn("1b")).not.toBeNull();
    expect(renderSpy.mock.calls.length).toBe(before); // 2c's selection didn't change → no re-render
  });

  it("forwards pointerdown on the handle to context.onFillHandlePointerDown", () => {
    const { fake } = setup();
    const store = createRangeStore();
    store.setAnchor({ rowIndex: 1, colId: "b" });
    const onFillHandlePointerDown = vi.fn();
    const Shell = wrapWithCellShell<GridRow>(Inner);
    const view = render(<Shell {...shellProps(store, fake.api, 1, "b", { onFillHandlePointerDown })} />);
    const handle = view.container.querySelector("[data-sg-fill-handle]") as HTMLElement;
    fireEvent.pointerDown(handle);
    expect(onFillHandlePointerDown).toHaveBeenCalledWith(expect.anything(), { rowIndex: 1, colId: "b" });
  });
});

describe("useRangeSelection — review fixes", () => {
  function withTarget(ev: MouseEvent, target: HTMLElement): MouseEvent {
    target.addEventListener(ev.type, () => {}, { once: true });
    document.body.appendChild(target);
    target.dispatchEvent(ev);
    target.remove();
    return ev;
  }

  it("a cellMouseDown arriving after its own release sets the anchor without a drag (I3)", () => {
    const { fake, store, h } = setup();
    const e = mouseDown(fake.api, 1, "b");
    act(() => document.dispatchEvent(new MouseEvent("pointerup")));
    act(() => h().onCellMouseDown(e));
    expect(store.get()?.anchor).toEqual({ rowIndex: 1, colId: "b" });
    expect(store.getState().dragging).toBe(false);
  });

  it("interactive targets anchor without a drag; right-click keeps a range it lands in (M5)", () => {
    const { fake, store, h } = setup();
    const e = mouseDown(fake.api, 0, "a");
    withTarget(e.event as MouseEvent, document.createElement("button"));
    act(() => h().onCellMouseDown(e));
    expect(store.get()?.anchor).toEqual({ rowIndex: 0, colId: "a" });
    expect(store.getState().dragging).toBe(false);
    act(() => store.setFocus({ rowIndex: 2, colId: "c" }));
    act(() => h().onCellMouseDown(mouseDown(fake.api, 1, "b", { button: 2 })));
    expect(store.get()).toEqual({ anchor: { rowIndex: 0, colId: "a" }, focus: { rowIndex: 2, colId: "c" } });
    act(() => h().onCellMouseDown(mouseDown(fake.api, 3, "d", { button: 2 })));
    expect(store.get()).toEqual({ anchor: { rowIndex: 3, colId: "d" }, focus: { rowIndex: 3, colId: "d" } });
    expect(store.getState().dragging).toBe(false);
  });

  it("sets dragging before the range so a drag announces once, on release (M3)", () => {
    const { fake, store, announce, h } = setup();
    act(() => store.setAnchor({ rowIndex: 0, colId: "a" }));
    announce.mockClear();
    act(() => h().onCellMouseDown(mouseDown(fake.api, 2, "b", { shiftKey: true })));
    expect(announce).not.toHaveBeenCalled();
    act(() => document.dispatchEvent(new MouseEvent("mouseup")));
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it("Shift+Arrow steps over full-width rows and stops at the last rangeable row (I4)", () => {
    const group = { __sg: "group", id: "g1", level: 0, columnId: "a", key: "x", label: "x", count: 1, aggregates: {}, expanded: true, groupPath: [] };
    const rows = [ROWS[0], group, ROWS[1], group] as unknown as GridRow[];
    const { fake, store, keyboard } = setup(COLS, rows);
    act(() => store.setAnchor({ rowIndex: 0, colId: "a" }));
    act(() => {
      keyboard.suppressKeyboardEvent(key(fake.api, 0, "a", "ArrowDown"));
    });
    expect(store.get()?.focus).toEqual({ rowIndex: 2, colId: "a" });
    fake.spies.setFocusedCell?.mockClear();
    let handled = false;
    act(() => {
      handled = keyboard.suppressKeyboardEvent(key(fake.api, 2, "a", "ArrowDown"));
    });
    expect(handled).toBe(true);
    expect(store.get()?.focus).toEqual({ rowIndex: 2, colId: "a" });
    expect(fake.spies.setFocusedCell).not.toHaveBeenCalled();
  });

  it("Shift+Arrow at the grid edge stays put; on a pinned row it is not handled", () => {
    const { fake, store, keyboard } = setup();
    act(() => store.setAnchor({ rowIndex: 0, colId: "a" }));
    let handled = false;
    act(() => {
      handled = keyboard.suppressKeyboardEvent(key(fake.api, 0, "a", "ArrowUp"));
    });
    expect(handled).toBe(true);
    act(() => {
      keyboard.suppressKeyboardEvent(key(fake.api, 0, "a", "ArrowLeft"));
    });
    expect(store.get()).toEqual({ anchor: { rowIndex: 0, colId: "a" }, focus: { rowIndex: 0, colId: "a" } });
    const pinned = key(fake.api, 0, "a", "ArrowDown");
    (pinned as { node: unknown }).node = { ...node(fake.api, 0), rowPinned: "top" };
    expect(keyboard.suppressKeyboardEvent(pinned)).toBe(false);
  });

  it("late cellFocused events for cells we focused ourselves are consumed (I5)", () => {
    const { fake, store, keyboard, h } = setup();
    act(() => store.setAnchor({ rowIndex: 0, colId: "a" }));
    act(() => {
      keyboard.suppressKeyboardEvent(key(fake.api, 0, "a", "ArrowDown"));
      keyboard.suppressKeyboardEvent(key(fake.api, 1, "a", "ArrowDown"));
    });
    act(() => h().onCellFocused(focused(fake.api, 1, "a")));
    act(() => h().onCellFocused(focused(fake.api, 2, "a")));
    expect(store.get()).toEqual({ anchor: { rowIndex: 0, colId: "a" }, focus: { rowIndex: 2, colId: "a" } });
    act(() => h().onCellFocused(focused(fake.api, 3, "a")));
    expect(store.get()?.anchor).toEqual({ rowIndex: 3, colId: "a" });
  });

  it("onModelUpdated clears the range only when the rows under its corners changed (C1)", () => {
    const { fake, store, h } = setup();
    act(() => store.setAnchor({ rowIndex: 0, colId: "a" }));
    act(() => store.setFocus({ rowIndex: 1, colId: "b" }));
    act(() => h().onModelUpdated());
    expect(store.get()).not.toBeNull();
    const first = fake.rows()[0] as GridRow;
    fake.api.applyTransaction({ remove: [first], add: [first] }); // r1 moves to the end
    fake.spies.refreshCells?.mockClear();
    act(() => h().onModelUpdated());
    expect(store.get()).toBeNull();
    expect(fake.spies.refreshCells).toHaveBeenCalledWith({ columns: ["a", "b"] });
  });

  it("reset clears the range and drag state (sort/filter/destroy)", () => {
    const { fake, store, h } = setup();
    act(() => h().onCellMouseDown(mouseDown(fake.api, 0, "a")));
    act(() => h().reset());
    expect(store.get()).toBeNull();
    expect(store.getState().dragging).toBe(false);
  });

  it("onDisplayedColumnsChanged re-normalises, and clears when a corner column is gone (I2)", () => {
    const { fake, store, h } = setup();
    act(() => store.setAnchor({ rowIndex: 0, colId: "a" }));
    act(() => store.setFocus({ rowIndex: 0, colId: "c" }));
    fake.api.applyColumnState({ state: [{ colId: "b", hide: true }] });
    fake.spies.refreshCells?.mockClear();
    act(() => h().onDisplayedColumnsChanged());
    expect(normalizedRangeFor(fake.api, store.get())?.colIds).toEqual(["a", "c"]);
    expect(fake.spies.refreshCells).toHaveBeenCalledTimes(1);
    fake.api.applyColumnState({ state: [{ colId: "c", hide: true }] });
    act(() => h().onDisplayedColumnsChanged());
    expect(store.get()).toBeNull();
  });

  it("normalizedRangeFor returns null on a destroyed api (M1)", () => {
    const { fake } = setup();
    fake.spies.isDestroyed?.mockReturnValue(true);
    expect(normalizedRangeFor(fake.api, { anchor: { rowIndex: 0, colId: "a" }, focus: { rowIndex: 0, colId: "a" } })).toBeNull();
  });
});

describe("keyboard registry — root handlers (I6/I7/M6)", () => {
  it("skips root handlers while editing / in editable targets / on prevented events unless opted in", () => {
    let editing = true;
    const reg = createKeyboardRegistry<GridRow>({
      getApi: () => ({ getEditingCells: () => (editing ? [{} as never] : []) }),
    });
    const plain = vi.fn(() => "handled" as const);
    const opted = vi.fn(() => false);
    reg.registerRoot(opted, { whileEditing: true });
    reg.registerRoot(plain);
    reg.handleRootKeyDown(new KeyboardEvent("keydown", { key: "z", cancelable: true }));
    expect(opted).toHaveBeenCalledTimes(1);
    expect(plain).not.toHaveBeenCalled();
    editing = false;
    const input = document.createElement("input");
    document.body.appendChild(input);
    const inInput = new KeyboardEvent("keydown", { key: "z", cancelable: true, bubbles: true });
    input.addEventListener("keydown", (e) => reg.handleRootKeyDown(e), { once: true });
    input.dispatchEvent(inInput);
    input.remove();
    expect(plain).not.toHaveBeenCalled();
    const prevented = new KeyboardEvent("keydown", { key: "z", cancelable: true });
    prevented.preventDefault();
    reg.handleRootKeyDown(prevented);
    expect(plain).not.toHaveBeenCalled();
    const ok = new KeyboardEvent("keydown", { key: "z", cancelable: true });
    reg.handleRootKeyDown(ok);
    expect(plain).toHaveBeenCalledTimes(1);
    expect(ok.defaultPrevented).toBe(true);
  });

  it('"handled-no-prevent" claims the key without preventDefault; true is an alias of "handled"', () => {
    const reg = createKeyboardRegistry<GridRow>();
    const later = vi.fn(() => true);
    reg.registerRoot(() => "handled-no-prevent");
    reg.registerRoot(later);
    const ev = new KeyboardEvent("keydown", { key: "v", cancelable: true });
    reg.handleRootKeyDown(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(later).not.toHaveBeenCalled();
    const reg2 = createKeyboardRegistry<GridRow>();
    reg2.registerRoot(() => true);
    const ev2 = new KeyboardEvent("keydown", { key: "v", cancelable: true });
    reg2.handleRootKeyDown(ev2);
    expect(ev2.defaultPrevented).toBe(true);
  });

  it("matchesShortcut falls back to event.code for letter keys", () => {
    const ev = new KeyboardEvent("keydown", { key: "с", code: "KeyC", ctrlKey: true, metaKey: true });
    expect(matchesShortcut(ev, { key: "c", mod: true })).toBe(true);
    expect(matchesShortcut(new KeyboardEvent("keydown", { key: "x", code: "KeyX", ctrlKey: true, metaKey: true }), { key: "c", mod: true })).toBe(false);
  });
});

describe("<SchemaGrid> range selection (integration)", () => {
  // jsdom has no `onpointerdown`, so AG Grid would listen for touchstart; make
  // it use pointer events (dispatched as MouseEvents, jsdom has no PointerEvent).
  let addedPointerDown = false;
  beforeAll(() => {
    if (!("onpointerdown" in HTMLElement.prototype)) {
      Object.defineProperty(HTMLElement.prototype, "onpointerdown", { value: null, writable: true, configurable: true });
      addedPointerDown = true;
    }
  });
  afterAll(() => {
    if (addedPointerDown) delete (HTMLElement.prototype as { onpointerdown?: unknown }).onpointerdown;
  });
  /** Press, let AG Grid's queued callbacks run, then release. */
  const click = async (el: HTMLElement, init: MouseEventInit = {}) => {
    act(() => {
      el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, buttons: 1, ...init }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    act(() => {
      document.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
  };
  const cellEl = (container: HTMLElement, rowId: string, colId: string) =>
    container.querySelector(`.ag-row[row-id="${rowId}"] .ag-cell[col-id="${colId}"]`) as HTMLElement;

  it("click + Shift+click highlight the range with edge classes and show the handle at bottom-right", async () => {
    const { container, waitForRows, handle } = renderGrid();
    await waitForRows();
    await click(cellEl(container, "r1", "name"));
    await waitFor(() => expect(handle.current?.stores.range.get()?.anchor).toEqual({ rowIndex: 0, colId: "name" }));
    expect(handle.current?.stores.range.getState().dragging).toBe(false);
    await click(cellEl(container, "r2", "notes"), { shiftKey: true });
    await waitFor(() => expect(handle.current?.stores.range.get()?.focus).toEqual({ rowIndex: 1, colId: "notes" }));
    await waitFor(() => {
      const tl = cellEl(container, "r1", "name");
      expect(tl.classList.contains(SG_CLASSES.range)).toBe(true);
      expect(tl.classList.contains(SG_CLASSES.rangeTop)).toBe(true);
      expect(tl.classList.contains(SG_CLASSES.rangeLeft)).toBe(true);
      const br = cellEl(container, "r2", "notes");
      expect(br.classList.contains(SG_CLASSES.rangeBottom)).toBe(true);
      expect(br.classList.contains(SG_CLASSES.rangeRight)).toBe(true);
      expect(br.querySelector("[data-sg-fill-handle]")).not.toBeNull();
    });
    expect(cellEl(container, "r1", "name").querySelector("[data-sg-fill-handle]")).toBeNull();
    expect(cellEl(container, "r1", "score").classList.contains(SG_CLASSES.range)).toBe(false);
    await waitFor(() =>
      expect(container.querySelector('[role="status"]')?.textContent).toContain("2 rows by 2 columns selected"),
    );
  });

  it("Shift+ArrowDown in the grid extends the range and moves focus", async () => {
    const { container, waitForRows, handle } = renderGrid();
    await waitForRows();
    const api = handle.current?.api();
    act(() => api?.setFocusedCell(0, "score"));
    await waitFor(() => expect(handle.current?.stores.range.get()?.anchor).toEqual({ rowIndex: 0, colId: "score" }));
    fireEvent.keyDown(cellEl(container, "r1", "score"), { key: "ArrowDown", code: "ArrowDown", shiftKey: true });
    await waitFor(() =>
      expect(handle.current?.stores.range.get()).toEqual({
        anchor: { rowIndex: 0, colId: "score" },
        focus: { rowIndex: 1, colId: "score" },
      }),
    );
    await waitFor(() => expect(api?.getFocusedCell()?.rowIndex).toBe(1));
    await waitFor(() => expect(cellEl(container, "r2", "score").classList.contains(SG_CLASSES.range)).toBe(true));
    // Focus landing on the range focus doesn't collapse it.
    expect(handle.current?.stores.range.get()?.anchor).toEqual({ rowIndex: 0, colId: "score" });
  });

  it("sorting after selecting clears the range and leaves no stale range classes (C1)", async () => {
    const { container, waitForRows, handle } = renderGrid();
    await waitForRows();
    await click(cellEl(container, "r1", "name"));
    await click(cellEl(container, "r2", "score"), { shiftKey: true });
    await waitFor(() => expect(cellEl(container, "r2", "score").classList.contains(SG_CLASSES.range)).toBe(true));
    act(() => {
      handle.current?.api()?.applyColumnState({ state: [{ colId: "score", sort: "desc" }], defaultState: { sort: null } });
    });
    await waitFor(() => expect(handle.current?.stores.range.get()).toBeNull());
    await waitFor(() => expect(container.querySelectorAll(`.${SG_CLASSES.range}`).length).toBe(0));
    expect(container.querySelector("[data-sg-fill-handle]")).toBeNull();
  });

  it.todo("real mouse drag across cells and edge autoscroll (Playwright: see playwright-scenarios.md)");
});
