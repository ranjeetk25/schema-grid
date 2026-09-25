import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_IDS, fixtureColumn } from "../test/fixtures";
import { renderUi } from "../test/render";
import type { HeaderMenuActions, HeaderMenuProps } from "./contract";
import { ShadcnHeaderMenu } from "./ShadcnHeaderMenu";

function makeActions(overrides: Partial<HeaderMenuActions> = {}): HeaderMenuActions {
  return {
    sortAsc: vi.fn(),
    sortDesc: vi.fn(),
    clearSort: vi.fn(),
    pinLeft: vi.fn(),
    pinRight: vi.fn(),
    unpin: vi.fn(),
    autosize: vi.fn(),
    autosizeAll: vi.fn(),
    hide: vi.fn(),
    openFilter: vi.fn(),
    groupBy: vi.fn(),
    editColumn: vi.fn(),
    insertColumn: vi.fn(),
    sortState: null,
    pinnedState: null,
    canFilter: true,
    canGroup: true,
    ...overrides,
  };
}

function setup(overrides: Partial<HeaderMenuActions> = {}, props: Partial<HeaderMenuProps> = {}) {
  const anchor = document.createElement("button");
  anchor.setAttribute("data-test-anchor", "");
  document.body.appendChild(anchor);
  const onClose = vi.fn();
  const actions = makeActions(overrides);
  const utils = renderUi(
    <ShadcnHeaderMenu
      column={{ colId: FIXTURE_IDS.payment, label: "Payment status", schemaColumn: fixtureColumn(FIXTURE_IDS.payment) }}
      anchor={anchor}
      opened
      onClose={onClose}
      actions={actions}
      {...props}
    />,
  );
  return { ...utils, actions, onClose, anchor };
}

afterEach(() => {
  for (const el of document.querySelectorAll("[data-test-anchor]")) el.remove();
});

const item = (name: string) => screen.getByRole("menuitem", { name: new RegExp(`^${name}`) });

describe("ShadcnHeaderMenu", () => {
  it("renders nothing when closed", () => {
    setup({}, { opened: false });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("renders every item, named after the column", () => {
    setup();
    const menu = screen.getByRole("menu", { name: "Payment status column" });
    const names = within(menu)
      .getAllByRole("menuitem")
      .map((el) => el.querySelector('[data-slot="header-menu-label"]')?.textContent);
    expect(names).toEqual([
      "Sort ascending",
      "Sort descending",
      "Clear sort",
      "Pin left",
      "Pin right",
      "Unpin",
      "Autosize column",
      "Autosize all columns",
      "Filter…",
      "Group by",
      "Edit column…",
      "Insert column left",
      "Insert column right",
      "Hide column",
    ]);
  });

  it("is portalled with AG Grid's custom-popup marker", () => {
    setup();
    expect(screen.getByRole("menu").closest(".ag-custom-component-popup")).not.toBeNull();
  });

  it("marks the active sort with a check and disables Clear sort when unsorted", () => {
    const { unmount } = setup({ sortState: null });
    expect(item("Clear sort")).toHaveAttribute("aria-disabled", "true");
    expect(within(item("Sort ascending")).queryByTestId("header-menu-check")).toBeNull();
    unmount();
    setup({ sortState: "desc" });
    expect(item("Clear sort")).not.toHaveAttribute("aria-disabled");
    expect(within(item("Sort descending")).getByTestId("header-menu-check")).toBeInTheDocument();
    expect(within(item("Sort ascending")).queryByTestId("header-menu-check")).toBeNull();
  });

  it("marks the pinned side and disables Unpin when not pinned", () => {
    const { unmount } = setup({ pinnedState: null });
    expect(item("Unpin")).toHaveAttribute("aria-disabled", "true");
    unmount();
    setup({ pinnedState: "left" });
    expect(within(item("Pin left")).getByTestId("header-menu-check")).toBeInTheDocument();
    expect(item("Unpin")).not.toHaveAttribute("aria-disabled");
  });

  it("disables Filter… when the column cannot be filtered", () => {
    setup({ canFilter: false });
    expect(item("Filter…")).toHaveAttribute("aria-disabled", "true");
  });

  it.each([
    ["Sort ascending", "sortAsc"],
    ["Sort descending", "sortDesc"],
    ["Pin left", "pinLeft"],
    ["Pin right", "pinRight"],
    ["Autosize column", "autosize"],
    ["Autosize all columns", "autosizeAll"],
    ["Filter…", "openFilter"],
    ["Group by", "groupBy"],
    ["Edit column…", "editColumn"],
    ["Hide column", "hide"],
  ] as const)("%s calls its action and closes the menu", async (name, action) => {
    const { user, actions, onClose } = setup();
    await user.click(item(name));
    expect(actions[action]).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    const actionOrder = (actions[action] as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0] ?? 0;
    expect(actionOrder).toBeLessThan(onClose.mock.invocationCallOrder[0] ?? 0);
  });

  it("Clear sort and Unpin call their actions when enabled", async () => {
    const { user, actions, onClose } = setup({ sortState: "asc", pinnedState: "right" });
    await user.click(item("Clear sort"));
    expect(actions.clearSort).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("Unpin calls unpin", async () => {
    const { user, actions } = setup({ pinnedState: "right" });
    await user.click(item("Unpin"));
    expect(actions.unpin).toHaveBeenCalled();
  });

  it("Insert column left / right call insertColumn with the side", async () => {
    const { user, actions } = setup();
    await user.click(item("Insert column right"));
    expect(actions.insertColumn).toHaveBeenCalledWith("right");
  });

  it("Insert column left passes left", async () => {
    const { user, actions } = setup();
    await user.click(item("Insert column left"));
    expect(actions.insertColumn).toHaveBeenCalledWith("left");
  });

  it("omits optional items when their callbacks are missing, and Group by when grouping is off", () => {
    const { unmount } = setup({ groupBy: undefined, editColumn: undefined, insertColumn: undefined });
    expect(screen.queryByRole("menuitem", { name: /Group by/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /Edit column/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /Insert column/ })).toBeNull();
    unmount();
    setup({ canGroup: false });
    expect(screen.queryByRole("menuitem", { name: /Group by/ })).toBeNull();
  });

  it("Escape closes the menu", async () => {
    const { user, onClose } = setup();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("anchors to the anchor element's rect", () => {
    const anchor = document.createElement("div");
    anchor.setAttribute("data-test-anchor", "");
    anchor.getBoundingClientRect = () => ({ left: 100, top: 40, width: 160, height: 36, right: 260, bottom: 76, x: 100, y: 40, toJSON: () => ({}) });
    document.body.appendChild(anchor);
    renderUi(
      <ShadcnHeaderMenu
        column={{ colId: "c", label: "C", schemaColumn: undefined }}
        anchor={anchor}
        opened
        onClose={vi.fn()}
        actions={makeActions()}
      />,
    );
    const virtual = document.querySelector('[data-slot="header-menu-anchor"]') as HTMLElement;
    expect(virtual.style.left).toBe("100px");
    expect(virtual.style.top).toBe("40px");
    expect(virtual.style.width).toBe("160px");
    expect(virtual.style.height).toBe("36px");
  });
});
