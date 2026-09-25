/**
 * playwright-scenarios.md §1 (range drag), §2 (Shift+Arrow across a pinned
 * column), §5 (clipboard round trip, in-browser), §6 (paste report with a
 * read-only cell), §13 (undo/redo of paste) — story "3. Client grid".
 */
import { expect, test } from "@playwright/test";
import {
  STORIES,
  calls,
  cell,
  cellText,
  openStory,
  pasteText,
  politeText,
  storedCell,
} from "./helpers";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test.beforeEach(async ({ page }) => {
  await openStory(page, STORIES.client);
});

test("§1 range drag selects a rectangle with edge classes, and Ctrl+C copies it as TSV", async ({
  page,
}) => {
  const from = cell(page, "r1", "col_fee");
  const to = cell(page, "r3", "col_status");
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error("cells not laid out");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 40, a.y + a.height, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect(page.locator(".sg-cell-range")).toHaveCount(9);
  await expect(cell(page, "r1", "col_fee")).toHaveClass(/sg-cell-range-top/);
  await expect(cell(page, "r1", "col_fee")).toHaveClass(/sg-cell-range-left/);
  await expect(cell(page, "r3", "col_status")).toHaveClass(
    /sg-cell-range-bottom/,
  );
  await expect(cell(page, "r3", "col_status")).toHaveClass(
    /sg-cell-range-right/,
  );
  await expect(cell(page, "r2", "col_paid")).not.toHaveClass(
    /sg-cell-range-(top|bottom|left|right)/,
  );
  await expect(cell(page, "r4", "col_fee")).not.toHaveClass(/sg-cell-range/);
  await expect
    .poll(() => politeText(page))
    .toBe("3 rows by 3 columns selected");

  await page.keyboard.press("ControlOrMeta+c");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(
    [
      "₹50,000.00\t20,000\tPaid",
      "₹60,000.00\t60,000\tPending",
      "₹45,000.00\t\t",
    ].join("\n"),
  );
});

async function dragToBottomEdge(
  page: import("@playwright/test").Page,
): Promise<number> {
  const s = await cell(page, "r2", "col_paid").boundingBox();
  const v = await page.locator(".ag-grid-viewport").first().boundingBox();
  if (!s || !v) throw new Error("not laid out");
  await page.mouse.move(s.x + 10, s.y + 10);
  await page.mouse.down();
  await page.mouse.move(s.x + 30, s.y + 30, { steps: 3 });
  await page.mouse.move(s.x + 30, v.y + v.height - 24, { steps: 8 });
  // Hold at the edge; a real autoscroll would keep revealing rows.
  await page.waitForTimeout(1200);
  const rows = await page.locator(".ag-row:has(.sg-cell-range)").count();
  await page.mouse.up();
  return rows;
}

test("§1 dragging toward the bottom edge grows the range through every visible row", async ({
  page,
}) => {
  const rows = await dragToBottomEdge(page);
  expect(rows).toBeGreaterThanOrEqual(8);
  await expect(cell(page, "r2", "col_paid")).toHaveClass(/sg-cell-range-top/);
  await expect(cell(page, "r1", "col_paid")).not.toHaveClass(/sg-cell-range/);
});

test("§1 holding at the bottom edge autoscrolls (known gap: not implemented)", async ({
  page,
}) => {
  test.fail(
    true,
    "useRangeSelection has no edge autoscroll (README: 'Not in jsdom scope: edge autoscroll')",
  );
  await dragToBottomEdge(page);
  expect(
    await page
      .locator(".ag-grid-viewport")
      .first()
      .evaluate((e) => e.scrollTop),
  ).toBeGreaterThan(0);
});

test("§2 Shift+ArrowRight extends the range across the pinned Name column", async ({
  page,
}) => {
  await cell(page, "r1", "col_name").click();
  const range = page.locator(".sg-cell-range");
  // Wait for AG Grid to move focus before the next key (it does so asynchronously).
  const press = async (
    key: string,
    focusRow: string,
    focusCol: string,
    count: number,
  ) => {
    await page.keyboard.press(key);
    await expect(cell(page, focusRow, focusCol)).toHaveClass(/ag-cell-focus/);
    await expect(range).toHaveCount(count);
  };
  await expect(cell(page, "r1", "col_name")).toHaveClass(/ag-cell-focus/);
  await press("Shift+ArrowRight", "r1", "col_fee", 2);
  await press("Shift+ArrowRight", "r1", "col_paid", 3);
  await press("Shift+ArrowDown", "r2", "col_paid", 6);
  for (const row of ["r1", "r2"]) {
    await expect(cell(page, row, "col_name")).toHaveClass(/sg-cell-range/);
    await expect(cell(page, row, "col_fee")).toHaveClass(/sg-cell-range/);
    await expect(cell(page, row, "col_paid")).toHaveClass(/sg-cell-range/);
  }
  // The pinned cell is the left edge, the unpinned Paid cell the right edge.
  await expect(cell(page, "r1", "col_name")).toHaveClass(/sg-cell-range-left/);
  await expect(cell(page, "r2", "col_paid")).toHaveClass(/sg-cell-range-right/);
  await expect(cell(page, "r2", "col_paid")).toHaveClass(
    /sg-cell-range-bottom/,
  );
});

test("§5 copy then paste a multiline + comma cell round-trips as one cell", async ({
  page,
}) => {
  // Sheets-style TSV: a quoted field with an embedded newline, and one with a comma.
  // Internal notes is a longText column (text columns flatten newlines by design).
  await cell(page, "r4", "col_notes").click();
  await pasteText(page, '"Line one\nLine two"\n"Patel, Dev"');
  await expect
    .poll(() => storedCell(page, "client", "r4", "notes"))
    .toBe("Line one\nLine two");
  await expect
    .poll(() => storedCell(page, "client", "r5", "notes"))
    .toBe("Patel, Dev");

  await cell(page, "r4", "col_notes").click();
  await cell(page, "r5", "col_notes").click({ modifiers: ["Shift"] });
  await expect(page.locator(".sg-cell-range")).toHaveCount(2);
  await page.keyboard.press("ControlOrMeta+c");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    '"Line one\nLine two"\nPatel, Dev',
  );
});

test("§6 paste over a read-only formula cell and an invalid date reports counts", async ({
  page,
}) => {
  // Columns from Call date: callDate | calledAt | isActive | balance (formula, read-only) | notes
  await cell(page, "r2", "col_callDate").click();
  await pasteText(page, "not a date\t\ttrue\t999\tPasted note");

  const report = page.getByTestId("clipboard-report");
  await expect(report).not.toHaveText("none");
  const parsed = JSON.parse((await report.textContent()) ?? "{}") as {
    pastedCells: number;
    skippedReadOnly: number;
    errors: unknown[];
  };
  expect(parsed.skippedReadOnly).toBe(1);
  expect(parsed.errors).toHaveLength(1);
  expect(parsed.pastedCells).toBe(3);
  await expect
    .poll(() => politeText(page))
    .toMatch(/^Paste: 3 pasted, 1 skipped, 1 errors?$/);
  // ui§11: the Mantine paste-report toast (<Notifications /> is mounted in preview.tsx).
  await expect(
    page
      .locator(".mantine-Notification-root")
      .filter({ hasText: /Pasted 3 cells/ }),
  ).toBeVisible();

  await expect
    .poll(() => storedCell(page, "client", "r2", "isActive"))
    .toBe(true);
  await expect
    .poll(() => storedCell(page, "client", "r2", "notes"))
    .toBe("Pasted note");
  expect(await storedCell(page, "client", "r2", "callDate")).toBe("2026-09-24");
  // Formula cell unchanged: 60000 - 60000.
  expect(await cellText(page, "r2", "col_balance")).toBe("0");
});

test("§13 undo reverts a whole paste in one step and redo re-applies it", async ({
  page,
}) => {
  await cell(page, "r1", "col_paid").click();
  await pasteText(page, "111\n222\n333");
  await expect.poll(() => storedCell(page, "client", "r3", "paid")).toBe(333);
  const pasteBatches = (await calls(page, "applyChanges")).filter(
    (c) => (c.arg as { source: string }).source === "paste",
  );
  expect(pasteBatches).toHaveLength(1);

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => storedCell(page, "client", "r1", "paid")).toBe(20000);
  expect(await storedCell(page, "client", "r2", "paid")).toBe(60000);
  expect(await storedCell(page, "client", "r3", "paid")).toBeNull();
  const undoBatches = (await calls(page, "applyChanges")).filter(
    (c) => (c.arg as { source: string }).source === "undo",
  );
  expect(undoBatches).toHaveLength(1);
  await expect.poll(() => politeText(page)).toBe("Undone");

  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(() => storedCell(page, "client", "r2", "paid")).toBe(222);
  await expect(cell(page, "r3", "col_paid")).toHaveText("333");
});
