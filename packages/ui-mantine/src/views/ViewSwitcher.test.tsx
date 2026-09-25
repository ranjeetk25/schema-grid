import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ViewDef } from "../internal/core-contracts";
import { renderWithMantine } from "../test/render";
import { ViewSwitcher, type ViewSwitcherProps } from "./ViewSwitcher";

const view = (id: string, name: string): ViewDef => ({
  id,
  name,
  filter: null,
  sort: [],
  columnState: [],
  groupBy: [],
  pageSize: 50,
});

function setup(overrides: Partial<ViewSwitcherProps> = {}) {
  const props: ViewSwitcherProps = {
    views: [view("v1", "All leads"), view("v2", "Unpaid")],
    activeViewId: "v1",
    dirty: false,
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onSaveCurrent: vi.fn(),
    ...overrides,
  };
  const r = renderWithMantine(<ViewSwitcher {...props} />);
  return { ...r, props };
}

describe("ViewSwitcher", () => {
  it("shows the active view and selects another", async () => {
    const { user, props } = setup();
    await user.click(screen.getByRole("button", { name: /All leads/ }));
    expect(screen.getByRole("menuitem", { name: /All leads/ })).toHaveAttribute("data-active", "true");
    await user.click(screen.getByRole("menuitem", { name: /Unpaid/ }));
    expect(props.onSelect).toHaveBeenCalledWith("v2");
  });

  it("Save changes is disabled when clean and calls onSaveCurrent when dirty", async () => {
    const clean = setup();
    await clean.user.click(screen.getByRole("button", { name: /All leads/ }));
    expect(screen.getByRole("menuitem", { name: "Save changes" })).toBeDisabled();
    clean.unmount();

    const dirty = setup({ dirty: true });
    expect(screen.getByTestId("view-dirty-dot")).toBeInTheDocument();
    await dirty.user.click(screen.getByRole("button", { name: /All leads/ }));
    await dirty.user.click(screen.getByRole("menuitem", { name: "Save changes" }));
    expect(dirty.props.onSaveCurrent).toHaveBeenCalled();
  });

  it("creates a view with a name", async () => {
    const { user, props } = setup();
    await user.click(screen.getByRole("button", { name: /All leads/ }));
    await user.click(screen.getByRole("menuitem", { name: "Save as new view" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("View name"), "Yesterday calls");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(props.onCreate).toHaveBeenCalledWith("Yesterday calls");
  });

  it("rename prefills the current name", async () => {
    const { user, props } = setup();
    await user.click(screen.getByRole("button", { name: /All leads/ }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = within(screen.getByRole("dialog")).getByLabelText("View name");
    expect(input).toHaveValue("All leads");
    await user.clear(input);
    await user.type(input, "Everyone{Enter}");
    expect(props.onRename).toHaveBeenCalledWith("v1", "Everyone");
  });

  it("delete asks for confirmation, and is disabled for the last view", async () => {
    const { user, props, unmount } = setup();
    await user.click(screen.getByRole("button", { name: /All leads/ }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(props.onDelete).toHaveBeenCalledWith("v1");
    unmount();

    const single = setup({ views: [view("v1", "All leads")] });
    await single.user.click(screen.getByRole("button", { name: /All leads/ }));
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeDisabled();
  });
});
