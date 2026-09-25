/**
 * Story "1. Field types": all 16 built-in field types render through the
 * Mantine registry (and ag-grid's defaults) in a real browser, and the date
 * popup editor opens and commits (playwright-scenarios-ui.md §1, §12).
 */
import { expect, test } from "@playwright/test";
import { STORIES, cell, openStory, storedCell } from "./helpers";

const LABELS = [
  "Name",
  "Fee",
  "Paid",
  "Payment status",
  "Tags",
  "Owner",
  "Call date",
  "Called at",
  "Active",
  "Balance",
  "Internal notes",
  "Stage",
  "Website",
  "Email",
  "Phone",
  "Programs",
];

for (const [name, id] of [
  ["Mantine registry", STORIES.fieldTypes],
  ["ag-grid defaults", "1-field-types--ag-grid-defaults"],
] as const) {
  test(`${name}: every field type renders without console errors`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));
    await openStory(page, id);
    const headers = await page
      .locator(".ag-header-cell-text")
      .allTextContents();
    expect(headers).toEqual(LABELS);
    await expect(cell(page, "r1", "col_fee")).toHaveText("₹50,000.00");
    await expect(cell(page, "r1", "col_paid")).toHaveText("20,000");
    await expect(cell(page, "r1", "col_status")).toHaveText(/Paid/);
    await expect(cell(page, "r1", "col_tags")).toHaveText(/Scholarship/);
    await expect(cell(page, "r1", "col_owner")).toHaveText(/Anil Admin/);
    await expect(cell(page, "r1", "col_callDate")).toHaveText("24/09/2026");
    await expect(cell(page, "r1", "col_calledAt")).toHaveText(
      /24\/09\/2026 10:30 am/,
    );
    await expect(cell(page, "r1", "col_balance")).toHaveText("30,000");
    await expect(cell(page, "r1", "col_stage")).toHaveText(/Applied/);
    await expect(cell(page, "r1", "col_website")).toHaveText(/asha\.dev/);
    await expect(cell(page, "r1", "col_email")).toHaveText("asha@example.com");
    await expect(cell(page, "r1", "col_programs")).toHaveText(/Full Stack/);
    expect(errors).toEqual([]);
  });
}

test("ui§1/§12 date popup editor opens a calendar and commits a picked day", async ({
  page,
}) => {
  await openStory(page, STORIES.fieldTypes);
  await cell(page, "r4", "col_callDate").dblclick();
  const popup = page.locator(".ag-popup-editor");
  await expect(popup).toBeVisible();
  // Focus-then-open: the picker trigger is focused; open it and pick the 21st.
  const trigger = popup.locator("button").first();
  await trigger.click();
  await popup.getByRole("button", { name: /21 September 2026/ }).click();
  await expect
    .poll(() => storedCell(page, "fieldTypes", "r4", "callDate"))
    .toBe("2026-09-21");
  await expect(cell(page, "r4", "col_callDate")).toHaveText("21/09/2026");
});

test("ui§1 link picker popup editor searches targets and commits", async ({
  page,
}) => {
  await openStory(page, STORIES.fieldTypes);
  await cell(page, "r2", "col_programs").dblclick();
  const popup = page.locator(".ag-popup-editor");
  await expect(popup).toBeVisible();
  await page.keyboard.type("Product");
  await popup.getByRole("option", { name: "Product Management" }).click();
  await page.keyboard.press("Enter");
  await expect
    .poll(() => storedCell(page, "fieldTypes", "r2", "programs"))
    .toEqual([{ id: "p3", label: "Product Management" }]);
});
