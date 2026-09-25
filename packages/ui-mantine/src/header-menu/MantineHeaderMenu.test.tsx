import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithMantine } from "../test/render";
import type { HeaderMenuActions } from "./contracts";
import { MantineHeaderMenu } from "./MantineHeaderMenu";

function actions(overrides: Partial<HeaderMenuActions> = {}): HeaderMenuActions {
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
    sortState: null,
    pinnedState: null,
    canSort: true,
    canFilter: true,
    canGroup: true,
    ...overrides,
  };
}

function setup(a: HeaderMenuActions = actions()) {
  const anchor = document.createElement("button");
  anchor.textContent = "⋯";
  document.body.appendChild(anchor);
  const onClose = vi.fn();
  const r = renderWithMantine(
    <MantineHeaderMenu column={{ colId: "c1", label: "Payment status", schemaColumn: undefined }} anchor={anchor} opened onClose={onClose} actions={a} />,
  );
  return { ...r, anchor, onClose, a };
}

describe("MantineHeaderMenu", () => {
  it("is labelled by the column and calls actions", async () => {
    const { user, a } = setup();
    expect(screen.getByRole("menu", { name: "Column menu: Payment status" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Sort descending" }));
    expect(a.sortDesc).toHaveBeenCalled();
    await user.click(screen.getByRole("menuitem", { name: /Filter…/ }));
    expect(a.openFilter).toHaveBeenCalled();
    await user.click(screen.getByRole("menuitem", { name: "Autosize all columns" }));
    expect(a.autosizeAll).toHaveBeenCalled();
    await user.click(screen.getByRole("menuitem", { name: "Hide column" }));
    expect(a.hide).toHaveBeenCalled();
  });

  it("hides optional host actions when absent and state-dependent items", () => {
    setup();
    for (const name of ["Group by this column", "Edit column…", "Insert column left", "Insert column right", "Clear sort", "Unpin"]) {
      expect(screen.queryByRole("menuitem", { name })).toBeNull();
    }
  });

  it("shows host actions, clear sort and unpin when applicable", async () => {
    const a = actions({ groupBy: vi.fn(), editColumn: vi.fn(), insertColumn: vi.fn(), sortState: "asc", pinnedState: "left" });
    const { user } = setup(a);
    await user.click(screen.getByRole("menuitem", { name: "Insert column right" }));
    expect(a.insertColumn).toHaveBeenCalledWith("right");
    await user.click(screen.getByRole("menuitem", { name: "Group by this column" }));
    expect(a.groupBy).toHaveBeenCalled();
    expect(screen.getByRole("menuitem", { name: "Clear sort" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Unpin" })).toBeInTheDocument();
  });

  it("closes on Escape and on an outside mousedown, but not on the anchor", () => {
    const { anchor, onClose } = setup();
    fireEvent.mouseDown(anchor);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("MantineHeaderMenu canSort (v0.2 C1)", () => {
  it("hides Sort ascending / descending / Clear sort when canSort is false", () => {
    setup(actions({ canSort: false, sortState: "asc" }));
    for (const name of ["Sort ascending", "Sort descending", "Clear sort"]) {
      expect(screen.queryByRole("menuitem", { name })).toBeNull();
    }
    expect(screen.getByRole("menuitem", { name: /Filter…/ })).toBeInTheDocument();
    // No leading divider when the sort section is gone.
    const first = document.querySelector("[data-sg-header-menu]")?.querySelector('[role="menuitem"], .mantine-Menu-divider');
    expect(first?.getAttribute("role")).toBe("menuitem");
  });

  it("no leading divider when neither sort nor filter/group items are shown", () => {
    setup(actions({ canSort: false, canFilter: false }));
    const first = document.querySelector("[data-sg-header-menu]")?.querySelector('[role="menuitem"], .mantine-Menu-divider');
    expect(first?.textContent).toContain("Pin left");
    expect(document.querySelectorAll("[data-sg-header-menu] .mantine-Menu-divider").length).toBeGreaterThan(0);
  });

  it("shows the sort items when canSort is true", () => {
    setup(actions({ canSort: true }));
    expect(screen.getByRole("menuitem", { name: "Sort ascending" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Sort descending" })).toBeInTheDocument();
  });
});
