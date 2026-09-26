/**
 * v0.3.1 save feedback (story "8. Workbench states / Save errors"): a save the
 * server answers with per-cell errors shows the message in the "save" banner
 * (red, role alert, dismissible, auto-dismiss paused on hover), as the cell's
 * native `title`, and in the assertive live region.
 */
import { expect, test } from "@playwright/test";
import { STORIES, assertiveText, cell, openStory } from "./helpers";

const MESSAGE = "The student has not uploaded: Aadhaar card";

test.beforeEach(async ({ page }) => {
  await openStory(page, STORIES.saveErrors);
});

test("a rejected edit: banner text, cell title, live region, dismiss", async ({ page }) => {
  const target = cell(page, "r1", "col_name");
  const before = (await target.textContent())?.trim();
  await target.dblclick();
  await page.keyboard.type("Zed");
  await page.keyboard.press("Enter");

  const banner = page.getByTestId("workbench-banner-save");
  await expect(banner).toBeVisible();
  await expect(banner).toHaveAttribute("role", "alert");
  await expect(banner).toContainText("1 change failed");
  await expect(banner).toContainText(MESSAGE);

  // The cell reverted, is marked and carries the message as a native tooltip.
  await expect(target).toHaveText(before ?? "");
  await expect(target).toHaveClass(/sg-cell-error/);
  await expect(target).toHaveAttribute("title", MESSAGE);
  await expect(target).toHaveAttribute("data-sg-error", "");
  await expect.poll(() => assertiveText(page)).toContain(MESSAGE);

  // Hovering keeps it; leaving lets the 8s timer run; Dismiss closes it now.
  await banner.hover();
  await page.waitForTimeout(300);
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Dismiss" }).click();
  await expect(banner).toHaveCount(0);
});

test("several failed cells: one banner line with the count and the grouped message", async ({ page }) => {
  await cell(page, "r1", "col_name").dblclick();
  await page.keyboard.type("A");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("workbench-banner-save")).toContainText("1 change failed");
  await cell(page, "r2", "col_name").dblclick();
  await page.keyboard.type("B");
  await page.keyboard.press("Enter");
  // A later failing save replaces the banner content (still one banner).
  const banners = page.getByTestId("workbench-banner-save");
  await expect(banners).toHaveCount(1);
  await expect(banners).toContainText(MESSAGE);
  await expect(cell(page, "r2", "col_name")).toHaveAttribute("title", MESSAGE);
  await expect(page.getByTestId("saved-count")).toHaveText("0");
});
