/**
 * playwright-scenarios-ui.md §4 (FilterButton popover keeps nested dropdowns
 * open, §8 filter, chips, saved view reopened "the next day") and §6 (column
 * builder creates a select column that appears in the grid) — story
 * "3. Client grid". Client mode resolves relative dates with the browser
 * clock, which the tests pin to the fixture's FIXTURE_NOW.
 */
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  FIXTURE_NOW,
  SECTION_8_AST,
  STORIES,
  buildSection8Filter,
  cell,
  openStory,
  pickOption,
  renderedRowIds,
} from "./helpers";

test("ui§4 FilterButton builds the §8 filter: empty status rows included, chips shown, view survives a day", async ({
  page,
}) => {
  await openStory(page, STORIES.clientFixture);
  await buildSection8Filter(page);

  expect(
    JSON.parse((await page.getByTestId("filter-ast").textContent()) ?? "null"),
  ).toEqual(SECTION_8_AST);
  await expect.poll(() => renderedRowIds(page)).toEqual(["r2", "r3"]);
  // r3 has an EMPTY payment status and is included (negative operators match empty).
  await expect(cell(page, "r3", "col_status")).toHaveText("");
  await expect(page.getByTestId("filter-count")).toHaveText("2");

  const chips = page.getByRole("button", { name: /^Remove filter: / });
  await expect(chips).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: /^Remove filter: Payment status/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Remove filter: Call date/ }),
  ).toBeVisible();

  // Save as a view.
  await page.getByRole("button", { name: "All rows" }).click();
  await page.getByRole("menuitem", { name: "Save as new view" }).click();
  await page
    .getByRole("textbox", { name: "View name" })
    .fill("Unpaid, called yesterday");
  await page.getByRole("textbox", { name: "View name" }).press("Enter");
  await expect(
    page.getByRole("button", { name: "Unpaid, called yesterday" }),
  ).toBeVisible();

  // Reopen after switching away.
  await page.getByRole("button", { name: "Unpaid, called yesterday" }).click();
  await page.getByRole("menuitem", { name: "All rows" }).click();
  await expect.poll(() => renderedRowIds(page)).toHaveLength(5);
  await page.getByRole("button", { name: "All rows" }).click();
  await page
    .getByRole("menuitem", { name: "Unpaid, called yesterday" })
    .click();
  await expect.poll(() => renderedRowIds(page)).toEqual(["r2", "r3"]);

  // "The next day": the saved view still means *yesterday*, which is now 2026-09-25 IST —
  // no fixture row was called then, so r2/r3 (called 2026-09-24) drop out.
  await page.clock.setSystemTime(
    new Date(new Date(FIXTURE_NOW).getTime() + 86_400_000),
  );
  await page.getByRole("button", { name: "Unpaid, called yesterday" }).click();
  await page.getByRole("menuitem", { name: "All rows" }).click();
  await page.getByRole("button", { name: "All rows" }).click();
  await page
    .getByRole("menuitem", { name: "Unpaid, called yesterday" })
    .click();
  await expect.poll(() => renderedRowIds(page)).toEqual([]);
});

test("ui§4 removing a chip updates the grid", async ({ page }) => {
  await openStory(page, STORIES.clientFixture);
  await buildSection8Filter(page);
  await expect.poll(() => renderedRowIds(page)).toEqual(["r2", "r3"]);
  await page
    .getByRole("button", { name: /^Remove filter: Payment status/ })
    .click();
  await expect(
    page.getByRole("button", { name: /^Remove filter: / }),
  ).toHaveCount(1);
  await expect
    .poll(async () => (await renderedRowIds(page)).length)
    .toBeGreaterThan(2);
});

test("ui§6 column builder creates a select column that appears in the grid and is editable", async ({
  page,
}) => {
  await openStory(page, STORIES.clientFixture);
  await page.getByRole("button", { name: "Add column" }).click();
  const dialog = page.getByRole("dialog", { name: "Add column" });
  await dialog.getByRole("button", { name: "Select", exact: true }).click();
  await dialog.getByRole("button", { name: "Next" }).click();
  await dialog.getByRole("textbox", { name: "Label" }).fill("Priority");
  await expect(dialog.getByRole("textbox", { name: "Key" })).toHaveValue(
    "priority",
  );
  for (const [i, label] of ["High", "Low"].entries()) {
    await dialog.getByRole("button", { name: "Add option" }).click();
    await dialog
      .getByRole("textbox", { name: "Option label" })
      .nth(i)
      .fill(label);
  }
  await dialog.getByRole("button", { name: "Next" }).click(); // permissions
  await dialog.getByRole("button", { name: "Next" }).click(); // preview
  await dialog.getByRole("button", { name: "Save column" }).click();
  await expect(dialog).toHaveCount(0);

  const header = page
    .locator(".ag-header-cell")
    .filter({ hasText: "Priority" });
  await expect(header).toHaveCount(1);
  const colId = await header.getAttribute("col-id");
  expect(colId).toBeTruthy();

  // The new column is live: edit it through the Mantine select popup.
  await cell(page, "r1", colId as string).dblclick();
  await page
    .locator(".ag-popup-editor")
    .getByRole("option", { name: "High" })
    .click();
  await expect(cell(page, "r1", colId as string)).toHaveText("High");
});

test("ui§4 nested selects in the FilterButton popover don't close it (group + OR)", async ({
  page,
}) => {
  await openStory(page, STORIES.clientFixture);
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /^Filter/ });
  await dialog.getByText("OR", { exact: true }).click();
  await expect(dialog.getByRole("radio", { name: "OR" })).toBeChecked();
  await dialog.getByRole("button", { name: "Add condition" }).click();
  await pickOption(page, dialog, "Column", 0, "Tags");
  await pickOption(page, dialog, "Operator", 0, "has any of");
  await dialog.getByRole("textbox", { name: "Value" }).first().click();
  await page.getByRole("option", { name: "VIP" }).click();
  await page.getByRole("option", { name: "Referral" }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect.poll(() => renderedRowIds(page)).toEqual(["r3", "r4", "r5"]);
});

test("§14 client-mode 'Export CSV' downloads the filtered view with formatted values", async ({
  page,
}) => {
  await openStory(page, STORIES.clientFixture);
  await buildSection8Filter(page);
  await expect.poll(() => renderedRowIds(page)).toEqual(["r2", "r3"]);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const file = await download;
  const text = (await readFile((await file.path()) as string, "utf8")).replace(
    /^�/,
    "",
  );
  const lines = text.trim().split(/\r?\n/);
  expect(lines[0]).toContain('"Name"');
  expect(lines[0]).toContain('"Payment status"');
  expect(lines).toHaveLength(3);
  expect(lines[1]).toContain("Bhavesh Rao");
  expect(lines[1]).toContain("Pending");
  expect(lines[2]).toContain("Chitra Nair");
});
