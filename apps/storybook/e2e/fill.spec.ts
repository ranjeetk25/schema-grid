/**
 * playwright-scenarios.md §3 (fill handle down with a number series, right
 * into the next column) and §13 (undo of a fill is one step) — story
 * "3. Client grid".
 */
import { type Page, expect, test } from "@playwright/test";
import {
  STORIES,
  calls,
  cell,
  openStory,
  politeText,
  storedCell,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await openStory(page, STORIES.client);
});

async function dragFillHandle(
  page: Page,
  toRow: string,
  toCol: string,
  onHold?: () => Promise<void>,
) {
  const handle = page.locator(".sg-fill-handle");
  await expect(handle).toHaveCount(1);
  const h = await handle.boundingBox();
  const target = await cell(page, toRow, toCol).boundingBox();
  if (!h || !target) throw new Error("not laid out");
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 2, h.y + h.height / 2 + 6, {
    steps: 2,
  });
  await page.mouse.move(
    target.x + target.width / 2,
    target.y + target.height / 2,
    { steps: 10 },
  );
  await onHold?.();
  await page.mouse.up();
}

test("§3 fill handle down extrapolates 20,000 / 60,000 into r3..r5 as ONE fill batch", async ({
  page,
}) => {
  await cell(page, "r1", "col_paid").click();
  await cell(page, "r2", "col_paid").click({ modifiers: ["Shift"] });
  await dragFillHandle(page, "r5", "col_paid", async () => {
    await expect(cell(page, "r3", "col_paid")).toHaveClass(
      /sg-cell-fill-preview/,
    );
    await expect(cell(page, "r5", "col_paid")).toHaveClass(
      /sg-cell-fill-preview/,
    );
    await expect(cell(page, "r1", "col_paid")).not.toHaveClass(
      /sg-cell-fill-preview/,
    );
  });

  await expect
    .poll(() => storedCell(page, "client", "r3", "paid"))
    .toBe(100000);
  expect(await storedCell(page, "client", "r4", "paid")).toBe(140000);
  expect(await storedCell(page, "client", "r5", "paid")).toBe(180000);
  await expect(cell(page, "r5", "col_paid")).toHaveText("1,80,000");
  await expect(page.locator(".sg-cell-fill-preview")).toHaveCount(0);
  const fills = (await calls(page, "applyChanges")).filter(
    (c) => (c.arg as { source: string }).source === "fill",
  );
  expect(fills).toHaveLength(1);
  // One combined message: the save no longer overwrites the fill summary.
  await expect
    .poll(() => politeText(page))
    .toBe("Fill: 3 cells filled, saved");
  // The range becomes the filled range.
  await expect(page.locator(".sg-cell-range")).toHaveCount(5);

  // §13: one undo step reverts the whole fill.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => storedCell(page, "client", "r3", "paid")).toBeNull();
  expect(await storedCell(page, "client", "r4", "paid")).toBe(0);
  expect(await storedCell(page, "client", "r5", "paid")).toBe(10000);
  await page.keyboard.press("ControlOrMeta+y");
  await expect
    .poll(() => storedCell(page, "client", "r4", "paid"))
    .toBe(140000);
});

test("§3 fill handle right copies Fee into the adjacent Paid column", async ({
  page,
}) => {
  await cell(page, "r5", "col_fee").click();
  await dragFillHandle(page, "r5", "col_paid");
  await expect.poll(() => storedCell(page, "client", "r5", "paid")).toBe(70000);
  expect(await storedCell(page, "client", "r5", "fee")).toBe(70000);
});

test("§3 Esc while dragging the fill handle cancels without writing", async ({
  page,
}) => {
  await cell(page, "r1", "col_paid").click();
  await dragFillHandle(page, "r3", "col_paid", async () => {
    await page.keyboard.press("Escape");
  });
  await expect(page.locator(".sg-cell-fill-preview")).toHaveCount(0);
  expect((await calls(page, "applyChanges")).length).toBe(0);
  expect(await storedCell(page, "client", "r3", "paid")).toBeNull();
});
