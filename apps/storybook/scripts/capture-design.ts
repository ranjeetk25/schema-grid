/**
 * Captures the design-review screenshots under docs/design/<prefix>/ against a
 * running Storybook (default http://localhost:6006), light + dark.
 *
 *   bun apps/storybook/scripts/capture-design.ts after
 *   STORYBOOK_URL=http://localhost:6007 bun apps/storybook/scripts/capture-design.ts before
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Page, chromium } from "@playwright/test";

const BASE = process.env.STORYBOOK_URL ?? "http://localhost:6006";
const prefix = process.argv[2] ?? "after";
const outDir = join(import.meta.dir, "../../../docs/design", prefix);
mkdirSync(outDir, { recursive: true });

type Scenario = {
  name: string;
  story: string;
  act?: (page: Page) => Promise<void>;
};

const ONLY = process.env.ONLY?.split(",");
const allScenarios: Scenario[] = [
  { name: "client-grid", story: "3-client-grid--full-toolbar" },
  { name: "field-types-mantine", story: "1-field-types--mantine" },
  { name: "field-types-ag-grid", story: "1-field-types--ag-grid-defaults" },
  {
    name: "column-builder",
    story: "3-client-grid--full-toolbar",
    act: async (page) => {
      await page.getByRole("button", { name: "Add column" }).click();
      await page.getByRole("dialog", { name: "Add column" }).waitFor();
    },
  },
  {
    name: "column-builder-config",
    story: "3-client-grid--full-toolbar",
    act: async (page) => {
      await page.getByRole("button", { name: "Add column" }).click();
      const dialog = page.getByRole("dialog", { name: "Add column" });
      await dialog.getByRole("button", { name: "Select", exact: true }).click();
      await dialog.getByRole("button", { name: "Next" }).click();
    },
  },
  {
    name: "filter-popover",
    story: "3-client-grid--full-toolbar",
    act: async (page) => {
      await page.getByRole("button", { name: "Filter", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: /^Filter/ });
      await dialog.getByRole("button", { name: "Add condition" }).click();
      await dialog.getByRole("button", { name: "Add condition" }).click();
    },
  },
  {
    name: "column-filter-ag-grid",
    story: "1-field-types--ag-grid-defaults",
    act: async (page) => openColumnFilter(page, "col_name"),
  },
  {
    name: "column-filter-mantine",
    story: "3-client-grid--full-toolbar",
    act: async (page) => openColumnFilter(page, "col_status"),
  },
  {
    name: "conflict-popover",
    story: "6-conflict-prompt--keep-theirs-or-overwrite",
    act: async (page) => {
      await page.getByRole("button", { name: "Remote edit r1 Name" }).click();
      await page.waitForTimeout(150);
      await page
        .locator('.ag-row[row-id="r1"] .ag-cell[col-id="col_name"]')
        .click();
      await page.keyboard.press("Enter");
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type("Mine");
      await page.keyboard.press("Enter");
      await page.getByRole("dialog", { name: "Edit conflict" }).waitFor();
    },
  },
];

const scenarios = ONLY ? allScenarios.filter((s) => ONLY.includes(s.name)) : allScenarios;

async function openColumnFilter(page: Page, colId: string) {
  const header = page.locator(`.ag-header-cell[col-id="${colId}"]`).first();
  await header.hover();
  const inHeader = header.locator(".sg-header-filter");
  if ((await inHeader.count()) > 0) {
    await inHeader.first().click();
  } else {
    // Legacy / opt-in floating filter row.
    const idx = await header.getAttribute("aria-colindex");
    await page
      .locator(`.ag-floating-filter[aria-colindex="${idx}"] button`)
      .first()
      .click();
  }
  await page.locator(".ag-filter, .ag-menu").first().waitFor();
}

const browser = await chromium.launch();
for (const scheme of ["light", "dark"] as const) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 860 },
    deviceScaleFactor: 2,
  });
  await context.addInitScript((s) => {
    localStorage.setItem("mantine-color-scheme-value", s);
  }, scheme);
  for (const s of scenarios) {
    const page = await context.newPage();
    try {
      await page.goto(
        `${BASE}/iframe.html?id=${s.story}&viewMode=story&globals=theme:${scheme}`,
      );
      await page.locator(".ag-row").first().waitFor();
      await s.act?.(page);
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(outDir, `${s.name}-${scheme}.png`) });
      console.log(`ok ${s.name}-${scheme}`);
    } catch (e) {
      console.error(`FAIL ${s.name}-${scheme}: ${(e as Error).message}`);
    }
    await page.close();
  }
  await context.close();
}
await browser.close();
