/**
 * ui-shadcn smoke in a real AG Grid (static Storybook build): popup select
 * commit, the spec §8 filter built through the FilterButton UI, the
 * ColumnPanel creating a select column, and the conflict popover.
 */
import { type Locator, type Page, test } from "@playwright/test";
import { SECTION_8_AST, STORIES, cell, expect, filterAst, openStory, renderedRowIds, storedCell } from "./helpers";

async function pick(page: Page, scope: Locator, control: string, nth: number, option: string) {
  await scope.getByRole("combobox", { name: control }).nth(nth).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("popup select editor commits the clicked option", async ({ page }) => {
  await openStory(page, STORIES.client);
  await cell(page, "r1", "col_status").dblclick();
  const card = page.locator(".sg-popup-card").first();
  await expect(card).toBeVisible();
  // The card is never narrower than the cell.
  const cellBox = await cell(page, "r1", "col_status").boundingBox();
  const cardBox = await card.boundingBox();
  expect(cardBox?.width ?? 0).toBeGreaterThanOrEqual(Math.min(240, cellBox?.width ?? 0));
  await page.getByRole("option", { name: "Pending" }).click();
  await expect(card).toBeHidden();
  await expect(cell(page, "r1", "col_status")).toHaveText("Pending");
  await expect.poll(() => storedCell(page, "client", "r1", "status")).toBe("pending");
});

test("§8 filter through the FilterButton: empty status rows included", async ({ page }) => {
  await openStory(page, STORIES.clientFixture);
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /^Filter/ });
  await dialog.getByRole("button", { name: "Add condition" }).click();
  await pick(page, dialog, "Column", 0, "Payment status");
  await pick(page, dialog, "Operator", 0, "is not");
  await pick(page, dialog, "Value", 0, "Paid");
  await dialog.getByRole("button", { name: "Add condition" }).click();
  await pick(page, dialog, "Column", 1, "Call date");
  await pick(page, dialog, "Operator", 1, "is within");
  await pick(page, dialog, "Relative date", 0, "Yesterday");
  // Nested dropdowns never closed the builder.
  await expect(dialog).toBeVisible();
  // Live, debounced apply (no Apply button under the threshold).
  await expect.poll(() => filterAst(page)).toEqual(SECTION_8_AST);
  await expect.poll(() => renderedRowIds(page)).toEqual(["r2", "r3"]);
  await expect(cell(page, "r3", "col_status")).toHaveText("");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /^Remove filter: / })).toHaveCount(2);
});

test("ColumnPanel creates a select column that appears in the grid", async ({ page }) => {
  await openStory(page, STORIES.clientFixture);
  await page.getByRole("button", { name: "Add column" }).first().click();
  const panel = page.getByRole("dialog", { name: "New column" });
  await panel.getByRole("textbox", { name: /Name/ }).fill("Interview stage");
  await panel.getByRole("button", { name: /Type|Choose a type/ }).first().click();
  await page.getByRole("option", { name: /^Single select|^Select/ }).first().click();
  await panel.getByRole("button", { name: "Add option" }).click();
  await panel.getByRole("textbox", { name: "Option label" }).last().fill("Scheduled");
  await panel.getByRole("button", { name: "Add option" }).click();
  await panel.getByRole("textbox", { name: "Option label" }).last().fill("Done");
  await panel.getByRole("button", { name: "Create column" }).click();
  await expect(panel).toBeHidden();
  const header = page.locator(".ag-header-cell", { hasText: "Interview stage" });
  await expect(header).toBeVisible();
  const colId = await header.first().getAttribute("col-id");
  await cell(page, "r1", colId ?? "").dblclick();
  await page.getByRole("option", { name: "Scheduled" }).click();
  await expect(cell(page, "r1", colId ?? "")).toHaveText("Scheduled");
});

test("conflict popover: Keep theirs adopts the remote value", async ({ page }) => {
  await openStory(page, STORIES.conflict);
  await page.getByRole("button", { name: "Remote edit r1 Name" }).click();
  await expect.poll(() => storedCell(page, "conflict", "r1", "name")).toBe("Asha (remote 1)");
  await cell(page, "r1", "col_name").click();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Mine");
  await page.keyboard.press("Enter");
  const popover = page.getByRole("dialog", { name: "Edit conflict" });
  await expect(popover).toBeVisible();
  await expect(popover).toContainText("Asha (remote 1)");
  await popover.getByRole("button", { name: "Keep theirs" }).click();
  await expect(popover).toBeHidden();
  await expect(cell(page, "r1", "col_name")).toHaveText("Asha (remote 1)");
  await expect.poll(() => storedCell(page, "conflict", "r1", "name")).toBe("Asha (remote 1)");
});
