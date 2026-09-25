import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ViewDef } from "../internal/core-contracts";
import { renderUi } from "../test/render";
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
  const r = renderUi(<ViewSwitcher {...props} />);
  return { ...r, props };
}

describe("ViewSwitcher", () => {
  it("shows the active view and selects another", async () => {
    const { user, props } = setup();
    await user.click(screen.getByRole("button", { name: /All leads/ }));
    const active = screen.getByRole("menuitemradio", { name: /All leads/ });
    expect(active).toHaveAttribute("data-active", "true");
    expect(active).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: /Unpaid/ })).toHaveAttribute("aria-checked", "false");
    await user.click(screen.getByRole("menuitemradio", { name: /Unpaid/ }));
    expect(props.onSelect).toHaveBeenCalledWith("v2");
  });

  it("Save changes is disabled when clean and calls onSaveCurrent when dirty", async () => {
    const clean = setup();
    await clean.user.click(screen.getByRole("button", { name: /All leads/ }));
    expect(screen.getByRole("menuitem", { name: "Save changes" })).toHaveAttribute("aria-disabled", "true");
    clean.unmount();

    const dirty = setup({ dirty: true });
    expect(screen.getByTestId("view-dirty-dot")).toHaveAccessibleName("Unsaved changes");
    await dirty.user.click(screen.getByRole("button", { name: /All leads/ }));
    await dirty.user.click(screen.getByRole("menuitem", { name: "Save changes" }));
    expect(dirty.props.onSaveCurrent).toHaveBeenCalled();
  });

  it("creates a view with a name", async () => {
    const { user, props } = setup();
    await user.click(screen.getByRole("button", { name: /All leads/ }));
    await user.click(screen.getByRole("menuitem", { name: "Save as new view" }));
    const dialog = await screen.findByRole("dialog", { name: "Save as new view" });
    const save = within(dialog).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    await user.type(within(dialog).getByLabelText("View name"), "Yesterday calls");
    await user.click(save);
    expect(props.onCreate).toHaveBeenCalledWith("Yesterday calls");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("rename prefills the current name", async () => {
    const { user, props } = setup();
    await user.click(screen.getByRole("button", { name: /All leads/ }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = within(await screen.findByRole("dialog", { name: "Rename view" })).getByLabelText("View name");
    expect(input).toHaveValue("All leads");
    await user.clear(input);
    await user.type(input, "Everyone{Enter}");
    expect(props.onRename).toHaveBeenCalledWith("v1", "Everyone");
  });

  it("cancel closes the dialog without calling back", async () => {
    const { user, props } = setup();
    await user.click(screen.getByRole("button", { name: /All leads/ }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(props.onRename).not.toHaveBeenCalled();
  });

  it("delete asks for confirmation, and is disabled for the last view", async () => {
    const { user, props, unmount } = setup();
    await user.click(screen.getByRole("button", { name: /All leads/ }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete view" });
    expect(dialog).toHaveTextContent('Delete "All leads"? This cannot be undone.');
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(props.onDelete).toHaveBeenCalledWith("v1");
    unmount();

    const single = setup({ views: [view("v1", "All leads")] });
    await single.user.click(screen.getByRole("button", { name: /All leads/ }));
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveAttribute("aria-disabled", "true");
  });

  it("falls back to 'Views' with no active view and disables active-only actions", async () => {
    const { user } = setup({ activeViewId: null });
    await user.click(screen.getByRole("button", { name: /Views/ }));
    expect(screen.getByRole("menuitem", { name: "Rename" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("menuitem", { name: "Save as new view" })).not.toHaveAttribute("aria-disabled");
  });
});
