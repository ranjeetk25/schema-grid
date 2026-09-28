/** v0.4 "Filter by color" submenu (`createShadcnHeaderMenu({ filterByColor })`). */
import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_IDS, fixtureColumn } from "../test/fixtures";
import { renderUi } from "../test/render";
import type { HeaderMenuActions, HeaderMenuComponent } from "./contract";
import { ShadcnHeaderMenu, createShadcnHeaderMenu } from "./ShadcnHeaderMenu";

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

function setup(Menu: HeaderMenuComponent) {
  const anchor = document.createElement("button");
  anchor.setAttribute("data-test-anchor", "");
  document.body.appendChild(anchor);
  const onClose = vi.fn();
  const utils = renderUi(
    <Menu
      column={{ colId: FIXTURE_IDS.payment, label: "Payment status", schemaColumn: fixtureColumn(FIXTURE_IDS.payment) }}
      anchor={anchor}
      opened
      onClose={onClose}
      actions={actions}
    />,
  );
  return { ...utils, onClose };
}

afterEach(() => {
  for (const el of document.querySelectorAll("[data-test-anchor]")) el.remove();
});

describe("header menu: Filter by color", () => {
  it("is absent from the plain ShadcnHeaderMenu", () => {
    setup(ShadcnHeaderMenu);
    expect(screen.queryByRole("menuitem", { name: /Filter by color/ })).toBeNull();
  });

  it("lists the palette plus No color, and sets a color condition on the column", async () => {
    const filterByColor = vi.fn();
    const { user, onClose } = setup(createShadcnHeaderMenu({ filterByColor }));
    const trigger = screen.getByRole("menuitem", { name: /Filter by color/ });
    await user.click(trigger);
    const sub = await screen.findByRole("menu", { name: /Filter by color/ });
    const names = within(sub)
      .getAllByRole("menuitem")
      .map((el) => el.textContent);
    expect(names).toEqual(["Red", "Orange", "Yellow", "Green", "Teal", "Blue", "Purple", "Pink", "Gray", "No color"]);
    expect(within(sub).getByRole("menuitem", { name: "Blue" }).querySelector('[data-color="blue"]')).not.toBeNull();
    // fireEvent: jsdom has no layout, so a pointer move into the submenu leaves the trigger and closes it.
    fireEvent.click(within(sub).getByRole("menuitem", { name: "Blue" }));
    expect(filterByColor).toHaveBeenCalledWith(FIXTURE_IDS.payment, "blue");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("No color filters on colorIsNone (null)", async () => {
    const filterByColor = vi.fn();
    const { user } = setup(createShadcnHeaderMenu({ filterByColor }));
    await user.click(screen.getByRole("menuitem", { name: /Filter by color/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "No color" }));
    expect(filterByColor).toHaveBeenCalledWith(FIXTURE_IDS.payment, null);
  });

  it("can be switched off per render (capability not loaded yet)", () => {
    setup(createShadcnHeaderMenu({ filterByColor: vi.fn(), canFilterByColor: () => false }));
    expect(screen.queryByRole("menuitem", { name: /Filter by color/ })).toBeNull();
  });
});
