/**
 * v0.4 cell colors in a real AG Grid (static Storybook build, story 8):
 * rules render, paint → filter by color → undo, a partial paint's report,
 * and a rule built through the Color rules dialog.
 */
import { type Page, test } from "@playwright/test";
import { cell, expect, filterAst, openStory, renderedRowIds } from "./helpers";

const STORY = "8-cell-colors--rules-paint-and-filter";

/** Manual colors of a stored row (the story's memory source): `{}` when it has none, `null` when the row is missing. */
async function storedColors(page: Page, rowId: string): Promise<unknown> {
  return page.evaluate((r) => {
    const stories = (window as unknown as { __sg: { stories: Record<string, { snapshot(): { id: string; colors?: Record<string, string> }[] }> } })
      .__sg.stories;
    const row = stories.colors?.snapshot().find((x) => x.id === r);
    return row ? (row.colors ?? {}) : null;
  }, rowId);
}

async function paint(page: Page, color: string) {
  const trigger = page.getByRole("button", { name: "Cell color" });
  await expect(trigger).not.toHaveAttribute("aria-disabled", "true");
  await trigger.click();
  const palette = page.getByRole("dialog", { name: "Cell color" });
  await palette.getByRole("button", { name: color, exact: true }).click();
  await expect(palette).toBeHidden();
}

test("the view's rules color rows and cells", async ({ page }) => {
  await openStory(page, STORY);
  // Paid rows (r1, r5) are green; an empty Payment status cell (r3) is gray.
  await expect(page.locator('.ag-row[row-id="r1"]').first()).toHaveClass(/sg-color-green/);
  await expect(page.locator('.ag-row[row-id="r5"]').first()).toHaveClass(/sg-color-green/);
  await expect(page.locator('.ag-row[row-id="r2"]').first()).not.toHaveClass(/sg-color-/);
  await expect(cell(page, "r3", "col_status")).toHaveClass(/sg-color-gray/);
});

test("paint → filter by color → undo", async ({ page }) => {
  await openStory(page, STORY);
  await cell(page, "r2", "col_status").click();
  await paint(page, "Red");
  await expect(cell(page, "r2", "col_status")).toHaveClass(/sg-color-red/);
  await expect.poll(() => storedColors(page, "r2")).toEqual({ col_status: "red" });

  // Header menu (its button shows on hover) → Filter by color → Red.
  await page.locator('.ag-header-cell[col-id="col_status"]').hover();
  await page.getByRole("button", { name: "Column menu: Payment status" }).click();
  await page.getByRole("menuitem", { name: "Filter by color" }).hover();
  await page.getByRole("menu", { name: "Filter by color" }).getByRole("menuitemcheckbox", { name: "Red", exact: true }).click();
  await expect.poll(() => filterAst(page)).toEqual({ op: "and", children: [{ columnId: "col_status", operator: "colorIs", value: ["red"] }] });
  await expect.poll(() => renderedRowIds(page)).toEqual(["r2"]);
  await expect(page.getByRole("button", { name: /^Remove filter: Payment status color is Red/ })).toBeVisible();

  // One undo step removes the paint (stored too).
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => storedColors(page, "r2")).toEqual({});
  // Nothing is red any more, so the color filter now matches no rows.
  await expect.poll(() => renderedRowIds(page)).toEqual([]);
  await page.getByRole("button", { name: /^Remove filter: Payment status color is Red/ }).click();
  await expect.poll(() => renderedRowIds(page)).toContain("r2");
  await expect(cell(page, "r2", "col_status")).not.toHaveClass(/sg-color-red/);
});

test("painting a range skips the read-only formula cell and says so", async ({ page }) => {
  await openStory(page, STORY);
  await cell(page, "r2", "col_isActive").click();
  await cell(page, "r2", "col_balance").click({ modifiers: ["Shift"] });
  await paint(page, "Blue");
  await expect(cell(page, "r2", "col_isActive")).toHaveClass(/sg-color-blue/);
  await expect(cell(page, "r2", "col_balance")).not.toHaveClass(/sg-color-blue/);
  await expect(page.getByTestId("workbench-status")).toContainText("Colored 1 cell, 1 skipped (1 read-only)");
  await expect(page.getByText("Color partially applied")).toBeVisible();
});

test("a rule built in the Color rules dialog colors the matching cells", async ({ page }) => {
  await openStory(page, STORY);
  await page.getByRole("button", { name: /^Color rules/ }).click();
  const dialog = page.getByRole("dialog", { name: "Color rules" });
  await expect(dialog.getByRole("group", { name: /^Rule \d$/ })).toHaveCount(2);
  await dialog.getByRole("button", { name: "Add rule" }).click();
  const rule = dialog.getByRole("group", { name: "Rule 3" });
  await rule.getByRole("button", { name: /^Color:/ }).click();
  await page.getByRole("dialog", { name: "Rule color" }).getByRole("button", { name: "Blue", exact: true }).click();
  await rule.getByRole("radio", { name: "Columns" }).click();
  await rule.getByRole("combobox", { name: "Target columns" }).click();
  await page.getByRole("option", { name: "Name", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await rule.getByRole("button", { name: "Add condition" }).click();
  await rule.getByRole("combobox", { name: "Column", exact: true }).click();
  await page.getByRole("option", { name: "Payment status", exact: true }).click();
  await rule.getByRole("combobox", { name: "Value" }).click();
  await page.getByRole("option", { name: "Pending", exact: true }).click();
  await dialog.getByRole("button", { name: "Save rules" }).click();
  await expect(dialog).toBeHidden();
  await expect(cell(page, "r2", "col_name")).toHaveClass(/sg-color-blue/);
  await expect(cell(page, "r1", "col_name")).not.toHaveClass(/sg-color-blue/);
  await expect(page.getByTestId("view-dirty-dot")).toBeVisible();
});
