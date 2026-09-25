/**
 * playwright-scenarios.md §9 (conflict keepTheirs / overwrite), §10 (polling
 * highlight + remoteChanged marker while editing), §16 (live-region output
 * for Saved / Conflict), §11 (notInView row) and playwright-scenarios-ui.md §9 (conflict popover
 * anchored to its cell, resolution reaches ag-grid) — stories
 * "6. Conflict prompt" and "7. Polling sync". The "other user" is scripted
 * inside the page (a remote write behind the grid's back) rather than a second
 * browser context: both stories share one in-memory store per page.
 */
import { type Page, expect, test } from "@playwright/test";
import {
  STORIES,
  assertiveText,
  calls,
  cell,
  openStory,
  pickOption,
  politeText,
  renderedRowIds,
  storedCell,
} from "./helpers";

/** Records every class list a cell goes through (flash classes are transient). */
async function watchClasses(
  page: Page,
  rowId: string,
  colId: string,
): Promise<() => Promise<string[]>> {
  await page.evaluate(
    ([r, c]) => {
      const el = document.querySelector(
        `.ag-row[row-id="${r}"] .ag-cell[col-id="${c}"]`,
      );
      const w = window as unknown as { __classes?: Record<string, string[]> };
      w.__classes ??= {};
      const log: string[] = [];
      w.__classes[`${r}/${c}`] = log;
      if (el)
        new MutationObserver(() => log.push(el.className)).observe(el, {
          attributes: true,
          attributeFilter: ["class"],
        });
    },
    [rowId, colId],
  );
  return () =>
    page.evaluate(
      (k) =>
        (window as unknown as { __classes: Record<string, string[]> })
          .__classes[k] ?? [],
      `${rowId}/${colId}`,
    );
}

/** Another user's write, straight into the polling story's store (no focus change). */
async function remoteEdit(
  page: Page,
  rowId: string,
  cells: Record<string, unknown>,
): Promise<void> {
  await page.evaluate(
    ([r, c]) =>
      (
        window as unknown as {
          __sg: {
            stories: {
              polling: { remoteEdit(r: string, c: object): Promise<unknown> };
            };
          };
        }
      ).__sg.stories.polling.remoteEdit(r as string, c as object),
    [rowId, cells] as const,
  );
}

async function editName(page: Page, rowId: string, value: string) {
  await cell(page, rowId, "col_name").click();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(value);
  await page.keyboard.press("Enter");
}

test.describe("§9 conflict prompt", () => {
  test.beforeEach(async ({ page }) => {
    // No clock pin: Mantine's popover transition timers must run.
    await openStory(page, STORIES.conflict, { pinClock: false });
    await page.getByRole("button", { name: "Remote edit r1 Name" }).click();
    await expect(page.getByTestId("remote-count")).toHaveText("1");
    // The grid still shows the stale value (no polling in this story).
    await expect(cell(page, "r1", "col_name")).toHaveText("Asha Verma");
  });

  test("keepTheirs adopts the other user's value", async ({ page }) => {
    await editName(page, "r1", "Mine");
    const popover = conflictPopover(page);
    await expect(popover).toBeVisible();
    await expect(popover).toContainText("Changed by Priya (remote)");
    await expect(popover).toContainText("Asha (remote 1)");
    await expect
      .poll(() => assertiveText(page))
      .toBe("Conflict on Name, row r1");

    // Anchored to the conflicting cell: the popover sits just below it.
    const cellBox = await cell(page, "r1", "col_name").boundingBox();
    const popBox = await popover.boundingBox();
    expect(
      cellBox &&
        popBox &&
        Math.abs(popBox.y - (cellBox.y + cellBox.height)) < 40,
    ).toBe(true);

    await popover.getByRole("button", { name: "Keep theirs" }).click();
    await expect(popover).toHaveCount(0);
    await expect(cell(page, "r1", "col_name")).toHaveText("Asha (remote 1)");
    expect(await storedCell(page, "conflict", "r1", "name")).toBe(
      "Asha (remote 1)",
    );
  });

  test("overwrite re-submits mine on top of theirs", async ({ page }) => {
    await editName(page, "r1", "Mine");
    const popover = conflictPopover(page);
    await expect(popover).toBeVisible();
    await popover.getByRole("button", { name: "Overwrite" }).click();
    await expect(popover).toHaveCount(0);
    await expect
      .poll(() => storedCell(page, "conflict", "r1", "name"))
      .toBe("Mine");
    await expect(cell(page, "r1", "col_name")).toHaveText("Mine");
    // First submit conflicted, the overwrite went through the normal pipeline again.
    const batches = await calls(page, "applyChanges");
    expect(batches.length).toBeGreaterThanOrEqual(2);
    await expect.poll(() => politeText(page)).toBe("Saved");
  });
});

test.describe("§10 polling", () => {
  test.beforeEach(async ({ page }) => {
    await openStory(page, STORIES.polling, { pinClock: false });
  });

  test("a remote change is applied on the next poll and flashed", async ({
    page,
  }) => {
    await expect(cell(page, "r2", "col_paid")).toHaveText("60,000");
    const history = await watchClasses(page, "r2", "col_paid");
    await page.getByRole("button", { name: "Remote edit r2 Paid" }).click();
    await expect(cell(page, "r2", "col_paid")).toHaveText("61,000", {
      timeout: 5000,
    });
    // AG Grid's change flash on exactly the changed cell.
    await expect
      .poll(async () =>
        (await history()).some((c) => c.includes("ag-cell-data-changed")),
      )
      .toBe(true);
    expect(
      await cell(page, "r2", "col_name").getAttribute("class"),
    ).not.toMatch(/ag-cell-data-changed/);
    await expect(
      page.getByRole("img", { name: /^Updated by Priya \(remote\)/ }),
    ).toBeVisible();
    expect(
      Number(await page.getByTestId("feed-count").textContent()),
    ).toBeGreaterThanOrEqual(1);
  });

  test("a remote change to the cell being edited is deferred and marked sg-cell-remote-changed", async ({
    page,
  }) => {
    await cell(page, "r2", "col_paid").click();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("70000");
    // Scripted remote write (clicking a toolbar button would blur the editor and commit it).
    await remoteEdit(page, "r2", { paid: 61000 });
    await expect(cell(page, "r2", "col_paid")).toHaveClass(
      /sg-cell-remote-changed/,
      { timeout: 5000 },
    );
    // Not clobbered mid-edit.
    await expect(cell(page, "r2", "col_paid").locator("input")).toHaveValue(
      "70000",
    );
    await cell(page, "r2", "col_paid").locator("input").press("Enter");
    // Committing on top of the remote change is a conflict (§9).
    await expect(conflictPopover(page)).toBeVisible();
    await expect
      .poll(() => assertiveText(page))
      .toBe("Conflict on Paid, row r2");
  });

  test("an in-progress edit is not clobbered and commits after an unrelated remote change", async ({
    page,
  }) => {
    await cell(page, "r2", "col_name").click();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Bhavesh R.");
    // Remote edit of a DIFFERENT cell in the same row while the editor is open.
    await remoteEdit(page, "r2", { paid: 65000 });
    await page.waitForTimeout(1200); // > 2 poll intervals
    // Still editing, value intact.
    await expect(cell(page, "r2", "col_name").locator("input")).toHaveValue(
      "Bhavesh R.",
    );
    await page.keyboard.press("Enter");

    await expect
      .poll(() => storedCell(page, "polling", "r2", "name"))
      .toBe("Bhavesh R.");
    await expect(cell(page, "r2", "col_paid")).toHaveText("65,000", {
      timeout: 5000,
    });
    expect(await storedCell(page, "polling", "r2", "paid")).toBe(65000);
    await expect(conflictPopover(page)).toHaveCount(0);
  });
});

/** The popover dialog, found by its accessible name (its own "Edit conflict" heading). */
function conflictPopover(page: Page) {
  return page.getByRole("dialog", { name: "Edit conflict" });
}

test.describe("§11 notInView", () => {
  test("a remote patch that takes a row out of the filter keeps it in place, faded", async ({
    page,
  }) => {
    await openStory(page, STORIES.polling, { pinClock: false });
    await page.getByRole("button", { name: "Filter", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: /^Filter/ });
    await dialog.getByRole("button", { name: "Add condition" }).click();
    await pickOption(page, dialog, "Column", 0, "Payment status");
    await pickOption(page, dialog, "Operator", 0, "is not");
    await pickOption(page, dialog, "Value", 0, "Paid");
    await page.keyboard.press("Escape");
    await expect.poll(() => renderedRowIds(page)).toEqual(["r2", "r3", "r4"]);

    await remoteEdit(page, "r2", { status: "paid" });
    const row = page.locator('.ag-row[row-id="r2"]');
    await expect(row).toHaveClass(/sg-row-not-in-view/, { timeout: 5000 });
    // Still at its previous position, rendered faded (SG CSS applies inside the theme scope).
    expect(await renderedRowIds(page)).toEqual(["r2", "r3", "r4"]);
    expect(
      Number(await row.evaluate((e) => getComputedStyle(e).opacity)),
    ).toBeLessThan(1);
  });
});
