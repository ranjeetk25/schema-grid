/**
 * Permission matrix (story "2. Permissions"), playwright-scenarios-ui.md §7
 * (import wizard through the native file picker) and §8 / playwright-
 * scenarios.md §14 (CSV download of the current view with only visible,
 * readable columns) — story "5. Import and export".
 */
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { STORIES, calls, cell, openStory, renderedRowIds } from "./helpers";

test.describe("permissions matrix", () => {
  test.beforeEach(async ({ page }) => {
    await openStory(page, STORIES.permissionsMatrix);
  });

  test("access table: counsellor can't see notes or edit fee, viewer is read-only", async ({
    page,
  }) => {
    const access = (who: string, key: string) =>
      page.getByTestId(`access-${who}-${key}`);
    await expect(access("admin", "notes")).toHaveText("edit");
    await expect(access("counsellor", "notes")).toHaveText("hidden");
    await expect(access("counsellor", "fee")).toHaveText("read");
    await expect(access("counsellor", "name")).toHaveText("edit");
    await expect(access("viewer", "name")).toHaveText("read");
    await expect(access("admin", "balance")).toHaveText("read");
  });

  test("hidden columns never render; read-only cells never enter edit mode", async ({
    page,
  }) => {
    const admin = page.getByTestId("grid-admin");
    const counsellor = page.getByTestId("grid-counsellor");
    const viewer = page.getByTestId("grid-viewer");
    await expect(
      admin.locator('.ag-header-cell[col-id="col_notes"]').first(),
    ).toBeAttached();
    await expect(
      counsellor.locator('.ag-header-cell[col-id="col_notes"]'),
    ).toHaveCount(0);
    await expect(
      viewer.locator('.ag-header-cell[col-id="col_notes"]'),
    ).toHaveCount(0);

    // Counsellor: fee is read-only, paid is editable.
    await cell(counsellor, "r1", "col_fee").dblclick();
    await expect(
      cell(counsellor, "r1", "col_fee").locator("input"),
    ).toHaveCount(0);
    await cell(counsellor, "r1", "col_paid").dblclick();
    await expect(
      cell(counsellor, "r1", "col_paid").locator("input"),
    ).toHaveCount(1);
    await page.keyboard.press("Escape");

    // Viewer: nothing is editable.
    await cell(viewer, "r1", "col_name").dblclick();
    await expect(cell(viewer, "r1", "col_name").locator("input")).toHaveCount(
      0,
    );
    await cell(viewer, "r1", "col_status").dblclick();
    await expect(page.locator(".ag-popup-editor")).toHaveCount(0);
    expect(await calls(page, "applyChanges")).toHaveLength(0);
  });
});

test.describe("import and export", () => {
  test.beforeEach(async ({ page }) => {
    await openStory(page, STORIES.importExport);
  });

  test("ui§7 import wizard: CSV via the file picker, auto-mapped, invalid row reported, valid row created", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Import…" }).click();
    const dialog = page.getByRole("dialog", { name: "Import data" });
    const chooser = page.waitForEvent("filechooser");
    await dialog.getByRole("button", { name: "Choose file" }).click();
    await (await chooser).setFiles({
      name: "students.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "Name,Paid,Payment status,Email\nZara Khan,1000,Pending,zara@example.com\nYusuf Ali,abc,Paid,yusuf@example.com\n",
      ),
    });
    await expect(dialog.getByText("2 rows found")).toBeVisible();
    await dialog.getByRole("button", { name: "Next" }).click();
    // Headers auto-mapped to the matching columns.
    await expect(
      dialog.getByRole("textbox", { name: "Map Payment status" }),
    ).toHaveValue("Payment status");
    await expect(dialog.getByRole("textbox", { name: "Map Paid" })).toHaveValue(
      "Paid",
    );
    await dialog.getByRole("button", { name: "Next" }).click();
    await expect(dialog.getByText("1 valid row")).toBeVisible();
    await expect(dialog.getByText("1 invalid row")).toBeVisible();
    await dialog.getByRole("button", { name: "Start import" }).click();

    await expect(page.getByTestId("import-job")).toContainText(
      '"state":"done"',
    );
    await expect(page.getByTestId("import-job")).toContainText(
      '"errorCount":1',
    );
    const created = (await calls(page, "createRows"))[0]?.arg as {
      cells: Record<string, unknown>;
    }[];
    expect(created).toHaveLength(1);
    expect(created[0]?.cells).toMatchObject({
      name: "Zara Khan",
      paid: 1000,
      status: "pending",
      email: "zara@example.com",
    });
    await expect.poll(async () => (await renderedRowIds(page)).length).toBe(6);
  });

  test("§14 / ui§8 CSV export of the current view downloads only visible, readable columns", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Export…" }).click();
    const dialog = page.getByRole("dialog", { name: "Export" });
    await expect(dialog.getByText("Includes 16 visible columns")).toBeVisible();
    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Export" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.csv$/);
    const text = (
      await readFile((await file.path()) as string, "utf8")
    ).replace(/^\uFEFF/, "");
    const [header, ...rows] = text.trim().split(/\r\n/);
    expect(header?.split(",").slice(0, 4)).toEqual([
      "Name",
      "Fee",
      "Paid",
      "Payment status",
    ]);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toContain("Asha Verma");
    // Values are formatted by field type, not raw (select label, not id).
    expect(rows[1]).toContain("Pending");
    await expect(page.getByTestId("last-export")).toContainText(
      "5 rows, 16 columns",
    );
  });

  test("§14 XLSX export downloads a workbook", async ({ page }) => {
    await page.getByRole("button", { name: "Export…" }).click();
    const dialog = page.getByRole("dialog", { name: "Export" });
    await dialog.getByText("XLSX", { exact: true }).click();
    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Export" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.xlsx$/);
    const bytes = await readFile((await file.path()) as string);
    expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK"); // zip container
  });
});
