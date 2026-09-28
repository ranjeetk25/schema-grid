import { expect, test } from "@playwright/test";
import {
  STORIES,
  calls,
  cell,
  openStory,
  renderedRowIds,
} from "./helpers";

/** Stored manual colors of a row (the story's in-memory snapshot). */
async function storedColors(
  page: import("@playwright/test").Page,
  rowId: string,
): Promise<Record<string, string> | null> {
  return page.evaluate((r) => {
    const api = (
      window as unknown as {
        __sg: {
          stories: Record<
            string,
            { snapshot(): { id: string; colors?: Record<string, string> }[] }
          >;
        };
      }
    ).__sg.stories.colors;
    return api?.snapshot().find((row) => row.id === r)?.colors ?? null;
  }, rowId);
}

test.beforeEach(async ({ page }) => {
  await openStory(page, STORIES.cellColors);
});

test("rules and seeded manual colors render", async ({ page }) => {
  // "Colored" view: paid rows green (whole row), a partial payment's Paid cell yellow.
  await expect(page.locator('.ag-row[row-id="r1"]').first()).toHaveClass(
    /sg-color-green/,
  );
  await expect(cell(page, "r4", "col_paid")).toHaveClass(/sg-color-yellow/);
  // Manual colors win over rules.
  await expect(cell(page, "x003", "col_name")).toHaveClass(/sg-color-purple/);
});

test("paint → filter by color → undo", async ({ page }) => {
  await cell(page, "r2", "col_name").click();
  await page.getByRole("button", { name: "Cell color" }).click();
  await page.getByRole("button", { name: "Red", exact: true }).click();
  await expect(cell(page, "r2", "col_name")).toHaveClass(/sg-color-red/);
  await expect.poll(() => storedColors(page, "r2")).toEqual({ col_name: "red" });

  // Header menu → Filter by color → Red: only the painted row stays.
  // The ⋯ button shows on header hover.
  await page.getByRole("columnheader", { name: "Name" }).hover();
  await page.getByRole("button", { name: "Column menu: Name" }).click();
  await page.getByRole("menuitem", { name: "Filter by color" }).hover();
  await page.getByRole("menuitem", { name: "Red", exact: true }).click();
  await expect.poll(() => renderedRowIds(page)).toEqual(["r2"]);
  await expect(page.getByTestId("filter-ast")).toHaveText(
    JSON.stringify({
      op: "and",
      children: [{ columnId: "col_name", operator: "colorIs", value: ["red"] }],
    }),
  );

  // Undo the paint: one setCellColors write clears it again.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => storedColors(page, "r2")).toBeNull();
  const writes = await calls(page, "setCellColors");
  expect(writes).toHaveLength(2);
  expect(
    (writes[1]?.arg as { changes: unknown[] }).changes,
  ).toEqual([{ rowId: "r2", columnId: "col_name", color: null }]);
  // The row no longer shows red (whether or not the filter has dropped it yet).
  await expect(
    page.locator('.ag-row[row-id="r2"] .ag-cell[col-id="col_name"].sg-color-red'),
  ).toHaveCount(0);
});

test("the Color rules dialog edits the view's rules", async ({ page }) => {
  await page.getByRole("button", { name: "Color rules" }).click();
  const dialog = page.getByRole("dialog", { name: "Color rules" });
  await expect(dialog.getByRole("group", { name: /^Rule \d$/ })).toHaveCount(2);
  // Drop the "paid rows" rule: r1 loses its green row.
  await dialog
    .getByRole("group", { name: "Rule 1" })
    .getByRole("button", { name: "Delete rule" })
    .click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.ag-row[row-id="r1"]').first()).not.toHaveClass(
    /sg-color-green/,
  );
  await expect(cell(page, "r4", "col_paid")).toHaveClass(/sg-color-yellow/);
});
