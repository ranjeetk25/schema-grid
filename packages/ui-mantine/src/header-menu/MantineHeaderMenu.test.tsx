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
