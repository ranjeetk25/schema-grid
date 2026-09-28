/**
 * v0.4.1 in a real browser:
 * - "1. Field types / Without lookup or options": the column builder hides
 *   Link / User, and the link picker explains instead of searching;
 * - "9. Cell colors / Rule on an unfilterable column": the header menu's
 *   "Filter by color" is disabled on the column the rule colors, the filter
 *   builder offers no "color is" there, and the rules dialog notes it.
 */
import { expect, test } from "@playwright/test";
import { STORIES, calls, cell, openStory } from "./helpers";

test("no lookup / options: Link and User are not offered for new columns", async ({ page }) => {
  await openStory(page, STORIES.noLookup);
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New column" });
  await dialog.getByRole("button", { name: /^Type:/ }).click();
  const types = page.getByRole("listbox", { name: "Field types" });
  await expect(types.getByRole("option", { name: "Select", exact: true })).toBeVisible();
  await expect(types.getByRole("option", { name: "Link", exact: true })).toHaveCount(0);
  await expect(types.getByRole("option", { name: "User", exact: true })).toHaveCount(0);
});

test("no lookup: the link picker says why and never calls lookup", async ({ page }) => {
  await openStory(page, STORIES.noLookup);
  await cell(page, "r1", "col_programs").dblclick();
  await expect(page.locator(".ag-popup-editor").getByText("Linking isn't set up for this grid")).toBeVisible();
  expect(await calls(page, "lookup")).toHaveLength(0);
});

test("a rule on an unfilterable column blocks filtering the column it colors by color", async ({ page }) => {
  await openStory(page, STORIES.unfilterableRule);
  // The rule still renders.
  await expect(cell(page, "r1", "col_name")).toHaveClass(/sg-color-orange/);

  // Header menu: disabled, with the reason on hover.
  await page.getByRole("columnheader", { name: "Name" }).hover();
  await page.getByRole("button", { name: "Column menu: Name" }).click();
  const item = page.getByRole("menuitem", { name: "Filter by color" });
  await expect(item).toHaveAttribute("aria-disabled", "true");
  await item.hover();
  await expect(page.getByText(`Can't filter by color: a color rule on it uses "Internal notes"`)).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Red", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Another column still filters by color.
  await page.getByRole("columnheader", { name: "Fee" }).hover();
  await page.getByRole("button", { name: "Column menu: Fee" }).click();
  await page.getByRole("menuitem", { name: "Filter by color" }).hover();
  await expect(page.getByRole("menuitem", { name: "Red", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  // The rules dialog notes the rule.
  await page.getByRole("button", { name: "Color rules" }).click();
  const rules = page.getByRole("dialog", { name: "Color rules" });
  await expect(rules.getByText("Can't be used to filter by color")).toBeVisible();
});
