/**
 * v0.4.1 in a real AG Grid (static Storybook build): a color rule on an
 * unfilterable column blocks filtering by color (story 8), and a source
 * without lookup / options trims the column builder's types (story 9).
 */
import { test } from "@playwright/test";
import { cell, expect, openStory } from "./helpers";

const UNFILTERABLE = "8-cell-colors--unfilterable-rule";
const GATED = "9-capability-gated-types--without-lookup-or-options";
const REASON = `Can't filter by color: a color rule on it uses "Internal notes", which can't be filtered on the server`;

test("a rule on an unfilterable column still colors, and blocks Filter by color on its column", async ({ page }) => {
  await openStory(page, UNFILTERABLE);
  // r1 has notes: its Payment status cell is orange.
  await expect(cell(page, "r1", "col_status")).toHaveClass(/sg-color-orange/);
  await expect(cell(page, "r2", "col_status")).not.toHaveClass(/sg-color-orange/);

  await page.locator('.ag-header-cell[col-id="col_status"]').hover();
  await page.getByRole("button", { name: "Column menu: Payment status" }).click();
  const item = page.getByRole("menuitem", { name: /Filter by color/ });
  await expect(item).toHaveAttribute("aria-disabled", "true");
  await expect(item).toContainText(REASON);
  await page.keyboard.press("Escape");

  // Other columns still filter by color.
  await page.locator('.ag-header-cell[col-id="col_fee"]').hover();
  await page.getByRole("button", { name: "Column menu: Fee" }).click();
  await expect(page.getByRole("menuitem", { name: "Filter by color" })).not.toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: /^Color rules/ }).click();
  const dialog = page.getByRole("dialog", { name: "Color rules" });
  await expect(dialog.getByRole("group", { name: "Rule 1" }).getByText("Can't be used to filter by color")).toBeVisible();
});

test("without lookup / options the column builder offers no Link or User type", async ({ page }) => {
  await openStory(page, GATED);
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "New column" });
  await panel.getByRole("textbox", { name: /Name/ }).fill("Programme");
  await panel.getByRole("button", { name: /^Type/ }).click();
  const types = page.getByRole("option");
  await expect(types.filter({ hasText: /^Text/ })).toHaveCount(1);
  await expect(types.filter({ hasText: /^Link/ })).toHaveCount(0);
  await expect(types.filter({ hasText: /^User/ })).toHaveCount(0);
});

test("without lookup the link cell editor says why instead of searching", async ({ page }) => {
  await openStory(page, GATED);
  await cell(page, "r1", "col_programs").dblclick();
  await expect(page.getByText("Linking isn't set up for this grid")).toBeVisible();
});
