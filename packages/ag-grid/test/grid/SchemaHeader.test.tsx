import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SchemaHeader, schemaHeaderKeyboardEvent } from "../../src/grid/SchemaHeader";

type Listener = () => void;

function makeColumn(opts: { filterActive?: boolean; filterAllowed?: boolean; sort?: "asc" | "desc" } = {}) {
  const listeners = new Map<string, Set<Listener>>();
  const state = { filterActive: opts.filterActive ?? false, sort: opts.sort };
  const column = {
    getColId: () => "payment",
    isFilterActive: () => state.filterActive,
    isFilterAllowed: () => opts.filterAllowed ?? true,
    getSort: () => state.sort,
    getSortIndex: () => (state.sort ? 0 : null),
    addEventListener: (type: string, fn: Listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(fn);
    },
    removeEventListener: (type: string, fn: Listener) => listeners.get(type)?.delete(fn),
  };
  const emit = (type: string) => {
    for (const fn of listeners.get(type) ?? []) fn();
  };
  return { column, state, emit, listeners };
}

function renderHeader(col = makeColumn(), extra: Record<string, unknown> = {}) {
  const props = {
    column: col.column,
    displayName: "Payment status",
    enableSorting: true,
    enableFilterButton: false,
    progressSort: vi.fn(),
    showFilter: vi.fn(),
    api: { addEventListener: vi.fn(), removeEventListener: vi.fn(), isDestroyed: () => false, getColumnState: () => [] },
    ...extra,
  };
  const utils = render(<SchemaHeader {...(props as unknown as Parameters<typeof SchemaHeader>[0])} />);
  return { ...utils, props };
}

describe("SchemaHeader", () => {
  it("renders exactly the label inside .ag-header-cell-text", () => {
    const { container } = renderHeader();
    const texts = [...container.querySelectorAll(".ag-header-cell-text")].map((e) => e.textContent);
    expect(texts).toEqual(["Payment status"]);
  });

  it("clicking the label sorts (shift = multi-sort)", () => {
    const { props } = renderHeader();
    fireEvent.click(screen.getByText("Payment status"), { shiftKey: true });
    expect(props.progressSort).toHaveBeenCalledWith(true);
    expect(props.showFilter).not.toHaveBeenCalled();
  });

  it("does not sort when sorting is disabled", () => {
    const { props } = renderHeader(makeColumn(), { enableSorting: false });
    fireEvent.click(screen.getByText("Payment status"));
    expect(props.progressSort).not.toHaveBeenCalled();
  });

  it("the filter button opens the filter anchored at itself and does not sort", () => {
    const { props } = renderHeader();
    const button = screen.getByRole("button", { name: "Filter Payment status" });
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    fireEvent.click(button);
    expect(props.showFilter).toHaveBeenCalledWith(button);
    expect(props.progressSort).not.toHaveBeenCalled();
  });

  it("reflects the active filter in the accessible name and class, live", () => {
    const col = makeColumn();
    renderHeader(col);
    expect(screen.getByRole("button", { name: "Filter Payment status" })).not.toHaveClass("sg-header-filter-active");
    act(() => {
      col.state.filterActive = true;
      col.emit("filterActiveChanged");
    });
    const button = screen.getByRole("button", { name: "Filter Payment status (active)" });
    expect(button).toHaveClass("sg-header-filter-active");
    expect(button).toHaveAttribute("title", "Filter Payment status (active)");
  });

  it("keeps the SAME filter button element when the filter becomes active (it anchors the open popup)", () => {
    const col = makeColumn();
    renderHeader(col);
    const before = screen.getByRole("button", { name: "Filter Payment status" });
    act(() => {
      col.state.filterActive = true;
      col.emit("filterActiveChanged");
    });
    const after = screen.getByRole("button", { name: "Filter Payment status (active)" });
    expect(after).toBe(before);
    expect(after.isConnected).toBe(true);
  });

  it("shows the sort direction and cleans up its listeners on unmount", () => {
    const col = makeColumn({ sort: "asc" });
    const { container, unmount } = renderHeader(col);
    expect(container.querySelector('.sg-header-sort[data-sort="asc"]')).not.toBeNull();
    act(() => {
      col.state.sort = "desc";
      col.emit("sortChanged");
    });
    expect(container.querySelector('.sg-header-sort[data-sort="desc"]')).not.toBeNull();
    unmount();
    expect(col.listeners.get("sortChanged")?.size ?? 0).toBe(0);
    expect(col.listeners.get("filterActiveChanged")?.size ?? 0).toBe(0);
  });

  it("renders no filter button when the column has no filter", () => {
    renderHeader(makeColumn({ filterAllowed: false }));
    expect(screen.queryByRole("button", { name: /Filter/ })).toBeNull();
  });

  it("an unsortable column shows no sort indicator and is not marked sortable (C1)", () => {
    const { container, props } = renderHeader(makeColumn({ sort: "asc" }), { enableSorting: false });
    expect(container.querySelector(".sg-header-sort")).toBeNull();
    expect(container.querySelector("[data-sortable]")).toBeNull();
    fireEvent.click(screen.getByText("Payment status"));
    expect(props.progressSort).not.toHaveBeenCalled();
  });
});

describe("schemaHeaderKeyboardEvent", () => {
  const setup = () => {
    const cell = document.createElement("div");
    cell.className = "ag-header-cell";
    const button = document.createElement("button");
    button.className = "sg-header-filter";
    const onClick = vi.fn();
    button.addEventListener("click", onClick);
    cell.append(button);
    document.body.append(cell);
    const showColumnFilter = vi.fn();
    const params = (key: string, mods: Partial<KeyboardEvent> = {}) => {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods });
      Object.defineProperty(event, "target", { value: cell });
      return { event, column: makeColumn().column, colDef: null, headerRowIndex: 0, api: { showColumnFilter } } as never;
    };
    return { cell, onClick, showColumnFilter, params };
  };

  it("opens the filter on Ctrl/Cmd+Enter, Shift+Enter and Alt+ArrowDown", () => {
    const { onClick, params, cell } = setup();
    expect(schemaHeaderKeyboardEvent(params("Enter", { ctrlKey: true }))).toBe(true);
    expect(schemaHeaderKeyboardEvent(params("Enter", { metaKey: true }))).toBe(true);
    expect(schemaHeaderKeyboardEvent(params("Enter", { shiftKey: true }))).toBe(true);
    expect(schemaHeaderKeyboardEvent(params("ArrowDown", { altKey: true }))).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(4);
    cell.remove();
  });

  it("leaves plain Enter (sort) and other keys to AG Grid", () => {
    const { onClick, params, cell } = setup();
    expect(schemaHeaderKeyboardEvent(params("Enter"))).toBe(false);
    expect(schemaHeaderKeyboardEvent(params("ArrowDown"))).toBe(false);
    expect(onClick).not.toHaveBeenCalled();
    cell.remove();
  });
});
