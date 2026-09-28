/** v0.4 "Filter by color" submenu (inside a `CellColorFilterProvider`). */
import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ColumnColorFilter } from "../filter-builder/model";
import { FIXTURE_IDS, fixtureColumn } from "../test/fixtures";
import { renderUi } from "../test/render";
import { CellColorFilterProvider } from "./cellColorFilter";
import type { HeaderMenuActions } from "./contract";
import { ShadcnHeaderMenu } from "./ShadcnHeaderMenu";

const actions: HeaderMenuActions = {
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
  canGroup: false,
};

function setup(current: ColumnColorFilter | undefined) {
  const anchor = document.createElement("button");
  anchor.setAttribute("data-test-anchor", "");
  document.body.appendChild(anchor);
  const onClose = vi.fn();
  const set = vi.fn();
  const menu = (
    <ShadcnHeaderMenu
      column={{ colId: FIXTURE_IDS.payment, label: "Payment status", schemaColumn: fixtureColumn(FIXTURE_IDS.payment) }}
      anchor={anchor}
      opened
      onClose={onClose}
      actions={actions}
    />
  );
  const utils = renderUi(
    current === undefined ? menu : <CellColorFilterProvider value={{ activeColors: () => current, filterByColor: set }}>{menu}</CellColorFilterProvider>,
  );
  return { ...utils, onClose, set };
}

async function openSubmenu(user: ReturnType<typeof setup>["user"]) {
  await user.click(screen.getByRole("menuitem", { name: /Filter by color/ }));
  return screen.findByRole("menu", { name: /Filter by color/ });
}

afterEach(() => {
  for (const el of document.querySelectorAll("[data-test-anchor]")) el.remove();
});

describe("header menu: Filter by color", () => {
  it("is absent without a CellColorFilterProvider", () => {
    setup(undefined);
    expect(screen.queryByRole("menuitem", { name: /Filter by color/ })).toBeNull();
  });

  it("lists the palette plus No color, and sets a color condition on the column", async () => {
    const { user, onClose, set } = setup(null);
    const sub = await openSubmenu(user);
    const names = within(sub)
      .getAllByRole("menuitemcheckbox")
      .map((el) => el.textContent);
    expect(names).toEqual(["Red", "Orange", "Yellow", "Green", "Teal", "Blue", "Purple", "Pink", "Gray", "No color"]);
    expect(within(sub).queryByRole("menuitem", { name: "Clear color filter" })).toBeNull();
    expect(within(sub).getByRole("menuitemcheckbox", { name: "Blue" }).querySelector('[data-color="blue"]')).not.toBeNull();
    // fireEvent: jsdom has no layout, so a pointer move into the submenu leaves the trigger and closes it.
    fireEvent.click(within(sub).getByRole("menuitemcheckbox", { name: "Blue" }));
    expect(set).toHaveBeenCalledWith(FIXTURE_IDS.payment, ["blue"]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("No color filters on colorIsNone", async () => {
    const { user, set } = setup(null);
    await openSubmenu(user);
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: "No color" }));
    expect(set).toHaveBeenCalledWith(FIXTURE_IDS.payment, "none");
  });

  it("checks the active color and offers to clear it", async () => {
    const { user, set } = setup(["green"]);
    const sub = await openSubmenu(user);
    expect(within(sub).getByRole("menuitemcheckbox", { name: "Green" })).toHaveAttribute("aria-checked", "true");
    expect(within(sub).getByRole("menuitemcheckbox", { name: "Red" })).toHaveAttribute("aria-checked", "false");
    fireEvent.click(within(sub).getByRole("menuitem", { name: "Clear color filter" }));
    expect(set).toHaveBeenCalledWith(FIXTURE_IDS.payment, null);
  });
});
