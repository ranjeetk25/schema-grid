/**
 * Captures ui-shadcn design screenshots (1440×900, light + dark) against a
 * running Storybook (default http://localhost:6107, the static build served
 * by `bun e2e/serve-static.ts 6107`, or `bun run storybook:shadcn` on 6007).
 *
 *   bun apps/storybook-shadcn/scripts/capture-design.ts            → docs/design/shadcn/
 *   bun apps/storybook-shadcn/scripts/capture-design.ts progress/03-filter
 *   ONLY=filter-popover,column-panel bun …/capture-design.ts
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Page, chromium } from "@playwright/test";

const BASE = process.env.STORYBOOK_URL ?? "http://localhost:6107";
const sub = process.argv[2] ?? "";
const outDir = join(import.meta.dir, "../../../docs/design/shadcn", sub);
mkdirSync(outDir, { recursive: true });
const FIXTURE_NOW = "2026-09-24T21:00:00.000Z";

type Scenario = { name: string; story: string; act?: (page: Page) => Promise<void> };

const cell = (page: Page, row: string, col: string) => page.locator(`.ag-row[row-id="${row}"] .ag-cell[col-id="${col}"]`).first();

async function editCell(page: Page, row: string, col: string) {
  await cell(page, row, col).dblclick();
  await page.locator(".ag-popup-editor, .ag-cell-inline-editing").first().waitFor();
}

async function openColumnFilter(page: Page, colId: string) {
  const header = page.locator(`.ag-header-cell[col-id="${colId}"]`).first();
  await header.hover();
  const inHeader = header.locator(".sg-header-filter, .ag-header-cell-filter-button, .ag-header-icon");
  if ((await inHeader.count()) > 0) await inHeader.first().click();
  else {
    const idx = await header.getAttribute("aria-colindex");
    await page.locator(`.ag-floating-filter[aria-colindex="${idx}"] button`).first().click();
  }
  await page.locator(".ag-filter").first().waitFor();
}

async function openPanel(page: Page) {
  await page.getByRole("button", { name: "Add column" }).click();
  await page.getByRole("dialog", { name: "New column" }).waitFor();
}

const all: Scenario[] = [
  { name: "client-grid", story: "3-client-grid--full-toolbar" },
  { name: "field-types", story: "1-field-types--shadcn" },
  { name: "field-types-ag-grid-defaults", story: "1-field-types--ag-grid-defaults" },
  { name: "permissions-matrix", story: "2-permissions--matrix" },
  { name: "polling", story: "7-polling-sync--polling-highlight" },
  {
    name: "filter-empty",
    story: "3-client-grid--full-toolbar",
    act: async (page) => {
      await page.getByRole("button", { name: "Filter", exact: true }).click();
    },
  },
  {
    name: "filter-popover",
    story: "3-client-grid--fixture-only",
    act: async (page) => {
      await page.getByRole("button", { name: "Filter", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: /^Filter/ });
      await dialog.getByRole("button", { name: "Add condition" }).click();
      await dialog.getByRole("button", { name: "Add condition" }).click();
    },
  },
  {
    name: "group-popover",
    story: "3-client-grid--full-toolbar",
    act: async (page) => {
      await page.getByRole("button", { name: /^Group/ }).first().click();
    },
  },
  {
    name: "view-menu",
    story: "3-client-grid--full-toolbar",
    act: async (page) => {
      await page.getByRole("button", { name: "All rows" }).click();
    },
  },
  { name: "column-panel-empty", story: "3-client-grid--full-toolbar", act: openPanel },
  {
    name: "column-panel-types",
    story: "3-client-grid--full-toolbar",
    act: async (page) => {
      await openPanel(page);
      await page.getByRole("dialog", { name: "New column" }).getByRole("button", { name: /Type|Choose a type/ }).first().click();
    },
  },
  {
    name: "column-panel-select",
    story: "3-client-grid--full-toolbar",
    act: async (page) => {
      await openPanel(page);
      const panel = page.getByRole("dialog", { name: "New column" });
      await panel.getByRole("textbox", { name: /Name/ }).fill("Interview stage");
      await panel.getByRole("button", { name: /Type|Choose a type/ }).first().click();
      await page.getByRole("option", { name: /^Single select|^Select/ }).first().click();
    },
  },
  {
    name: "column-panel-formula",
    story: "3-client-grid--full-toolbar",
    act: async (page) => {
      await openPanel(page);
      const panel = page.getByRole("dialog", { name: "New column" });
      await panel.getByRole("textbox", { name: /Name/ }).fill("Balance due");
      await panel.getByRole("button", { name: /Type|Choose a type/ }).first().click();
      await page.getByRole("option", { name: /^Formula/ }).first().click();
      await panel.getByRole("textbox", { name: /Formula/ }).fill("{fee} - {paid}");
    },
  },
  {
    name: "column-panel-access",
    story: "3-client-grid--full-toolbar",
    act: async (page) => {
      await openPanel(page);
      const panel = page.getByRole("dialog", { name: "New column" });
      await panel.getByRole("textbox", { name: /Name/ }).fill("Scholarship");
      await panel.getByRole("button", { name: /Type|Choose a type/ }).first().click();
      await page.getByRole("option", { name: /^Currency/ }).first().click();
      await panel.getByRole("button", { name: /Who can access/ }).click();
    },
  },
  { name: "editor-select", story: "3-client-grid--fixture-only", act: (p) => editCell(p, "r1", "col_status") },
  { name: "editor-multiselect", story: "3-client-grid--fixture-only", act: (p) => editCell(p, "r1", "col_tags") },
  { name: "editor-date", story: "3-client-grid--fixture-only", act: (p) => editCell(p, "r1", "col_callDate") },
  { name: "editor-user", story: "3-client-grid--fixture-only", act: (p) => editCell(p, "r1", "col_owner") },
  {
    name: "editor-email-invalid",
    story: "3-client-grid--fixture-only",
    act: async (page) => {
      await editCell(page, "r1", "col_email");
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type("not-an-email");
      await page.keyboard.press("Enter");
    },
  },
  { name: "column-filter-set", story: "3-client-grid--fixture-only", act: (p) => openColumnFilter(p, "col_status") },
  { name: "column-filter-condition", story: "3-client-grid--fixture-only", act: (p) => openColumnFilter(p, "col_fee") },
  {
    name: "conflict-popover",
    story: "6-conflict-prompt--keep-theirs-or-overwrite",
    act: async (page) => {
      await page.getByRole("button", { name: "Remote edit r1 Name" }).click();
      await page.waitForTimeout(150);
      await cell(page, "r1", "col_name").click();
      await page.keyboard.press("Enter");
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type("Mine");
      await page.keyboard.press("Enter");
      await page.getByRole("dialog", { name: "Edit conflict" }).waitFor();
    },
  },
  {
    name: "import-upload",
    story: "5-import-and-export--import-and-export",
    act: async (page) => {
      await page.getByRole("button", { name: "Import…" }).click();
    },
  },
  {
    name: "import-map",
    story: "5-import-and-export--import-and-export",
    act: async (page) => {
      await page.getByRole("button", { name: "Import…" }).click();
      const dialog = page.getByRole("dialog").first();
      await dialog.locator('input[type="file"]').setInputFiles({
        name: "leads.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("Name,Payment status,Fee,Email\nRavi,Paid,50000,ravi@example.com\nMeera,Pending,42000,meera@\nKabir,Waived,38000,kabir@example.com\n"),
      });
      await dialog.getByRole("button", { name: "Continue" }).click();
    },
  },
  {
    name: "import-preview",
    story: "5-import-and-export--import-and-export",
    act: async (page) => {
      await page.getByRole("button", { name: "Import…" }).click();
      const dialog = page.getByRole("dialog").first();
      await dialog.locator('input[type="file"]').setInputFiles({
        name: "leads.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("Name,Payment status,Fee,Email\nRavi,Paid,50000,ravi@example.com\nMeera,Pending,42000,meera@\nKabir,Waived,38000,kabir@example.com\n"),
      });
      await dialog.getByRole("button", { name: "Continue" }).click();
      await dialog.getByRole("button", { name: "Continue" }).click();
    },
  },
  {
    name: "export-dialog",
    story: "5-import-and-export--import-and-export",
    act: async (page) => {
      await page.getByRole("button", { name: "Export…" }).click();
    },
  },
];

const ONLY = process.env.ONLY?.split(",");
const scenarios = ONLY ? all.filter((s) => ONLY.includes(s.name)) : all;
const schemes = (process.env.SCHEMES?.split(",") as ("light" | "dark")[] | undefined) ?? ["light", "dark"];

const browser = await chromium.launch();
let failed = 0;
for (const scheme of schemes) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  for (const s of scenarios) {
    const page = await context.newPage();
    try {
      await page.clock.setSystemTime(new Date(FIXTURE_NOW));
      await page.goto(`${BASE}/iframe.html?id=${s.story}&viewMode=story&globals=scheme:${scheme}`);
      await page.locator(".ag-row").first().waitFor();
      await s.act?.(page);
      await page.waitForTimeout(450);
      await page.screenshot({ path: join(outDir, `${s.name}-${scheme}.png`) });
      console.log(`ok ${s.name}-${scheme}`);
    } catch (e) {
      failed++;
      console.error(`FAIL ${s.name}-${scheme}: ${(e as Error).message.split("\n")[0]}`);
    }
    await page.close();
  }
  await context.close();
}
await browser.close();
if (failed) process.exitCode = 1;
