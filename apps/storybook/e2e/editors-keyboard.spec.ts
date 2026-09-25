/**
 * playwright-scenarios.md §7 (Mantine popup editors keep focus with
 * withinPortal=false), §8 (creatable select creates an option), §15
 * (keyboard Enter / Esc / Tab, incl. Tab out of a popup editor) and
 * playwright-scenarios-ui.md §1/§2 (popup editors commit on option click,
 * keyboard in popup editors) — story "3. Client grid (fixture only)".
 */
import { expect, test } from "@playwright/test";
import {
  STORIES,
  calls,
  cell,
  openStory,
  politeText,
  storedCell,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await openStory(page, STORIES.clientFixture);
});

const popup = (page: import("@playwright/test").Page) =>
  page.locator(".ag-popup-editor");

test("§7 / ui§1 select popup editor commits on option click (dropdown inside the popup)", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await cell(page, "r3", "col_status").dblclick();
  await expect(popup(page)).toBeVisible();
  // The dropdown renders inside the AG popup (withinPortal=false), not in a body portal.
  const option = popup(page).getByRole("option", { name: "Pending" });
  await expect(option).toBeVisible();
  await option.click();
  await expect(popup(page)).toHaveCount(0);
  await expect(cell(page, "r3", "col_status")).toHaveText("Pending");
  await expect
    .poll(() => storedCell(page, "client", "r3", "status"))
    .toBe("pending");
  expect(errors).toEqual([]);
});

test("ui§1 multiSelect popup editor toggles options without closing, Enter commits", async ({
  page,
}) => {
  await cell(page, "r2", "col_tags").dblclick();
  await expect(popup(page)).toBeVisible();
  await popup(page).getByRole("textbox").first().click();
  await page.getByRole("option", { name: "VIP" }).click();
  await expect(popup(page)).toBeVisible();
  await page.getByRole("option", { name: "Referral" }).click();
  await page.keyboard.press("Enter");
  await expect
    .poll(() => storedCell(page, "client", "r2", "tags"))
    .toEqual(["vip", "referral"]);
});

test("§8 creatable select creates an option that later edits can pick", async ({
  page,
}) => {
  await cell(page, "r3", "col_stage").dblclick();
  await expect(popup(page)).toBeVisible();
  await page.keyboard.type("Interview");
  await popup(page).getByRole("option", { name: "Create 'Interview'" }).click();
  await expect(cell(page, "r3", "col_stage")).toHaveText("Interview");
  const created = await calls(page, "createOption");
  expect(created.map((c) => c.arg)).toEqual(["col_stage"]);
  const stored = (await storedCell(page, "client", "r3", "stage")) as string;
  expect(stored).toMatch(/^opt_/);

  await cell(page, "r5", "col_stage").dblclick();
  await expect(
    popup(page).getByRole("option", { name: "Interview" }),
  ).toBeVisible();
  await popup(page).getByRole("option", { name: "Interview" }).click();
  await expect
    .poll(() => storedCell(page, "client", "r5", "stage"))
    .toBe(stored);
  expect((await calls(page, "createOption")).length).toBe(1);
});

test("§15.1 Enter edits, Enter commits and moves down one row", async ({
  page,
}) => {
  await cell(page, "r1", "col_name").click();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Asha V.");
  await page.keyboard.press("Enter");
  await expect
    .poll(() => storedCell(page, "client", "r1", "name"))
    .toBe("Asha V.");
  await expect(cell(page, "r2", "col_name")).toHaveClass(/ag-cell-focus/);
  await expect.poll(() => politeText(page)).toBe("Saved");
});

test("§15.2 Esc cancels: value restored, no applyChanges", async ({ page }) => {
  await cell(page, "r2", "col_name").click();
  await page.keyboard.press("Enter");
  await page.keyboard.type(" nope");
  await page.keyboard.press("Escape");
  await expect(cell(page, "r2", "col_name")).toHaveText("Bhavesh Rao");
  expect(await calls(page, "applyChanges")).toHaveLength(0);
});

test("§15.3 Tab commits and starts editing the next editable cell", async ({
  page,
}) => {
  await cell(page, "r1", "col_name").click();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Tabbed");
  await page.keyboard.press("Tab");
  await expect
    .poll(() => storedCell(page, "client", "r1", "name"))
    .toBe("Tabbed");
  // Fee (currency) is editable for admin: it is now in edit mode.
  await expect(cell(page, "r1", "col_fee")).toHaveClass(
    /ag-cell-inline-editing/,
  );
  await page.keyboard.press("Escape");
});

test("§15.4 / ui§2 Tab out of a popup editor commits and moves right without getting stuck", async ({
  page,
}) => {
  // multiSelect keeps its popup open while toggling, so Tab is what commits it.
  await cell(page, "r2", "col_tags").dblclick();
  await expect(popup(page)).toBeVisible();
  await popup(page).getByRole("textbox").first().click();
  await page.getByRole("option", { name: "VIP" }).click();
  await page.keyboard.press("Tab");
  await expect
    .poll(() => storedCell(page, "client", "r2", "tags"))
    .toEqual(["vip"]);
  // Focus is back in the grid, on (and editing) the next editable column: Owner.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.activeElement?.closest(".sg-root, .ag-popup-editor") !==
          null,
      ),
    )
    .toBe(true);
  await expect
    .poll(() => cell(page, "r2", "col_owner").getAttribute("class"))
    .toMatch(/ag-cell-(focus|inline-editing)/);
  await expect(popup(page).getByRole("option", { name: "VIP" })).toHaveCount(0);
});

test("ui§2 arrow keys in a popup editor move through options, not the grid focus", async ({
  page,
}) => {
  await cell(page, "r1", "col_status").dblclick();
  await expect(popup(page)).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(popup(page)).toBeVisible();
  await expect(cell(page, "r1", "col_status")).toHaveClass(
    /ag-cell-focus|ag-cell-popup-editing/,
  );
  await expect(cell(page, "r2", "col_status")).not.toHaveClass(/ag-cell-focus/);
  await page.keyboard.press("Enter");
  await expect(popup(page)).toHaveCount(0);
  await expect
    .poll(() => storedCell(page, "client", "r1", "status"))
    .not.toBe("paid");
});

test("ui§2 Escape in a popup editor cancels", async ({ page }) => {
  await cell(page, "r3", "col_status").dblclick();
  await expect(popup(page)).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(popup(page)).toHaveCount(0);
  expect(await storedCell(page, "client", "r3", "status")).toBeNull();
  expect(await calls(page, "applyChanges")).toHaveLength(0);
});
