import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DefaultHeaderMenu } from "../../src/grid/DefaultHeaderMenu";
import { createHeaderMenuActions } from "../../src/grid/headerMenuActions";
import { SchemaHeader } from "../../src/grid/SchemaHeader";

function deps(overrides: { sort?: "asc" | "desc"; pinned?: "left" | "right" | null; host?: object } = {}) {
  const api = {
    applyColumnState: vi.fn(),
    autoSizeColumns: vi.fn(),
    autoSizeAllColumns: vi.fn(),
    showColumnFilter: vi.fn(),
  };
  const column = {
    getColId: () => "fee",
    getSort: () => overrides.sort,
    getPinned: () => overrides.pinned ?? null,
    isFilterAllowed: () => true,
    isSortable: () => true,
  };
  const after = vi.fn();
  return { api, column, after, host: overrides.host };
}

describe("createHeaderMenuActions", () => {
  it("drives sort / pin / hide / autosize through AG Grid column state APIs and then closes", () => {
    const d = deps();
    const a = createHeaderMenuActions(d as never);
    a.sortDesc();
    expect(d.api.applyColumnState).toHaveBeenLastCalledWith({ state: [{ colId: "fee", sort: "desc" }], defaultState: { sort: null } });
    a.clearSort();
    expect(d.api.applyColumnState).toHaveBeenLastCalledWith({ state: [{ colId: "fee", sort: null }], defaultState: { sort: null } });
    a.pinLeft();
    expect(d.api.applyColumnState).toHaveBeenLastCalledWith({ state: [{ colId: "fee", pinned: "left" }] });
    a.unpin();
    expect(d.api.applyColumnState).toHaveBeenLastCalledWith({ state: [{ colId: "fee", pinned: null }] });
    a.hide();
    expect(d.api.applyColumnState).toHaveBeenLastCalledWith({ state: [{ colId: "fee", hide: true }] });
    a.autosize();
    expect(d.api.autoSizeColumns).toHaveBeenCalledWith(["fee"]);
    a.autosizeAll();
    expect(d.api.autoSizeAllColumns).toHaveBeenCalled();
    expect(d.after).toHaveBeenCalledTimes(7);
  });

  it("reports sort/pinned state and only offers host callbacks that were provided", () => {
    const bare = createHeaderMenuActions(deps({ sort: "asc", pinned: "right" }) as never);
    expect(bare.sortState).toBe("asc");
    expect(bare.pinnedState).toBe("right");
    expect(bare.canGroup).toBe(false);
    expect(bare.groupBy).toBeUndefined();
    expect(bare.editColumn).toBeUndefined();
    expect(bare.insertColumn).toBeUndefined();

    const onGroupByColumn = vi.fn();
    const onEditColumn = vi.fn();
    const onInsertColumn = vi.fn();
    const full = createHeaderMenuActions(deps({ host: { onGroupByColumn, onEditColumn, onInsertColumn } }) as never);
    expect(full.canGroup).toBe(true);
    full.groupBy?.();
    full.editColumn?.();
    full.insertColumn?.("right");
    expect(onGroupByColumn).toHaveBeenCalledWith("fee");
    expect(onEditColumn).toHaveBeenCalledWith("fee");
    expect(onInsertColumn).toHaveBeenCalledWith("fee", "right");
  });

  it("openFilter prefers the anchored opener and falls back to api.showColumnFilter", () => {
    const d = deps();
    const openFilter = vi.fn();
    createHeaderMenuActions({ ...d, openFilter } as never).openFilter();
    expect(openFilter).toHaveBeenCalled();
    createHeaderMenuActions(d as never).openFilter();
    expect(d.api.showColumnFilter).toHaveBeenCalledWith("fee");
  });
});

describe("DefaultHeaderMenu", () => {
  it("renders a menu with checked sort state and runs actions", () => {
    const anchor = document.createElement("button");
    document.body.append(anchor);
    const d = deps({ sort: "asc" });
    const actions = createHeaderMenuActions(d as never);
    const onClose = vi.fn();
    render(<DefaultHeaderMenu column={{ colId: "fee", label: "Fee", schemaColumn: undefined }} anchor={anchor} opened onClose={onClose} actions={actions} />);
    expect(screen.getByRole("menu", { name: "Column menu: Fee" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: "Sort ascending" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("menuitem", { name: "Pin left" }));
    expect(d.api.applyColumnState).toHaveBeenLastCalledWith({ state: [{ colId: "fee", pinned: "left" }] });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    anchor.remove();
  });
});

describe("SchemaHeader column menu slot", () => {
  it("opens the context-supplied menu component from the ⋯ button and from right-click", () => {
    const Custom = vi.fn((p: { opened: boolean; column: { label: string } }) => (p.opened ? <div data-testid="custom-menu">{p.column.label}</div> : null));
    const eGridHeader = document.createElement("div");
    document.body.append(eGridHeader);
    const column = {
      getColId: () => "fee",
      getColDef: () => ({}),
      isFilterActive: () => false,
      isFilterAllowed: () => true,
      isSortable: () => true,
      getSort: () => undefined,
      getSortIndex: () => null,
      getPinned: () => null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const props = {
      column,
      displayName: "Fee",
      enableSorting: true,
      enableFilterButton: false,
      progressSort: vi.fn(),
      showFilter: vi.fn(),
      eGridHeader,
      context: { headerMenu: { component: Custom } },
      api: { addEventListener: vi.fn(), removeEventListener: vi.fn(), isDestroyed: () => false, getColumnState: () => [] },
    };
    render(<SchemaHeader {...(props as unknown as Parameters<typeof SchemaHeader>[0])} />);
    const button = screen.getByRole("button", { name: "Column menu: Fee" });
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(screen.getByTestId("custom-menu")).toHaveTextContent("Fee");
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(props.progressSort).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(screen.queryByTestId("custom-menu")).toBeNull();
    fireEvent.contextMenu(eGridHeader);
    expect(screen.getByTestId("custom-menu")).toBeInTheDocument();
    eGridHeader.remove();
  });
});
