/** v0.4: the header menu's "Filter by color" submenu (capability-gated through `CellColorFilterProvider`). */
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithMantine } from "../test/render";
import {
  CellColorFilterProvider,
  type CellColorFilterValue,
} from "./cellColorFilterContext";
import type { HeaderMenuActions } from "./contracts";
import { MantineHeaderMenu } from "./MantineHeaderMenu";

const actions = (): HeaderMenuActions => ({
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
});

function setup(filter?: Partial<CellColorFilterValue>) {
  const anchor = document.createElement("button");
  document.body.appendChild(anchor);
  const onClose = vi.fn();
  const value: CellColorFilterValue = {
    filterByColor: vi.fn(),
    activeColors: () => null,
    ...filter,
  };
  const menu = (
    <MantineHeaderMenu
      column={{ colId: "c1", label: "Payment status", schemaColumn: undefined }}
      anchor={anchor}
      opened
      onClose={onClose}
      actions={actions()}
    />
  );
  const r = renderWithMantine(
    filter === undefined ? (
      menu
    ) : (
      <CellColorFilterProvider value={value}>{menu}</CellColorFilterProvider>
    ),
  );
  return { ...r, value, onClose };
}

// Items are clicked with fireEvent: jsdom has no layout, so user-event's pointer move off the
// submenu target closes the submenu before the click lands (a real browser keeps it open).
describe("MantineHeaderMenu: Filter by color", () => {
  it("absent without a provider (no capability)", () => {
    setup();
    expect(
      screen.queryByRole("menuitem", { name: /Filter by color/ }),
    ).toBeNull();
  });

  it("lists the palette + No color and sets the column's color filter", async () => {
    const { user, value, onClose } = setup({});
    await user.hover(screen.getByRole("menuitem", { name: /Filter by color/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Red" }));
    expect(value.filterByColor).toHaveBeenCalledWith("c1", ["red"]);
    expect(onClose).toHaveBeenCalled();
  });

  it("No color filters colorIsNone; Clear color filter shows only when one is set", async () => {
    const { user, value } = setup({
      activeColors: (id) => (id === "c1" ? ["blue"] : null),
    });
    await user.hover(screen.getByRole("menuitem", { name: /Filter by color/ }));
    expect(
      await screen.findByRole("menuitem", { name: "Blue" }),
    ).toHaveAttribute("data-active", "true");
    fireEvent.click(screen.getByRole("menuitem", { name: "No color" }));
    expect(value.filterByColor).toHaveBeenCalledWith("c1", "none");
    await user.hover(screen.getByRole("menuitem", { name: /Filter by color/ }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Clear color filter" }),
    );
    expect(value.filterByColor).toHaveBeenLastCalledWith("c1", null);
  });
});

describe("MantineHeaderMenu: Filter by color blocked by a color rule (v0.4.1)", () => {
  const REASON = `a color rule on it uses "Verdict", which can't be filtered on the server`;

  it("shows a disabled item with the reason instead of the submenu", async () => {
    const { user, value } = setup({ blockedReason: (id) => (id === "c1" ? REASON : null) });
    const item = screen.getByRole("menuitem", { name: /Filter by color/ });
    expect(item).toHaveAttribute("data-disabled", "true");
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(item).toHaveAttribute("aria-description", `Can't filter by color: ${REASON}`);
    await user.hover(item);
    expect(await screen.findByText(`Can't filter by color: ${REASON}`)).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Red" })).toBeNull();
    fireEvent.click(item);
    expect(value.filterByColor).not.toHaveBeenCalled();
  });

  it("a column the rules don't block keeps the submenu", async () => {
    const { user } = setup({ blockedReason: () => null });
    await user.hover(screen.getByRole("menuitem", { name: /Filter by color/ }));
    expect(await screen.findByRole("menuitem", { name: "Red" })).toBeInTheDocument();
  });
});
