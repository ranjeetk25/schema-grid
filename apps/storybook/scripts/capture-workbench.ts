/**
 * Workbench screenshots (docs/design/progress/W-*) against a running Storybook.
 *   STORYBOOK_URL=http://localhost:6017 bun apps/storybook/scripts/capture-workbench.ts [tag]
 * `ONLY=W-20,W-21` captures a subset (prefix match on the shot name).
 */
import { join } from "node:path";
import { type Page, chromium } from "@playwright/test";

const BASE = process.env.STORYBOOK_URL ?? "http://localhost:6006";
const tag = process.argv[2] ?? "";
const outDir = join(import.meta.dir, "../../../docs/design/progress");

const shots: { name: string; story: string; scheme?: "light" | "dark"; act?: (p: Page) => Promise<void> }[] = [
  { name: "W-01-workbench", story: "3-client-grid--full-toolbar" },
  { name: "W-02-workbench-dark", story: "3-client-grid--full-toolbar", scheme: "dark" },
  { name: "W-03-read-only", story: "8-workbench-states--read-only" },
  { name: "W-04-network", story: "8-workbench-states--network" },
  { name: "W-05-permission", story: "8-workbench-states--permission" },
  { name: "W-06-empty", story: "8-workbench-states--empty" },
  { name: "W-07-network-dark", story: "8-workbench-states--network", scheme: "dark" },
  {
    name: "W-08-filtered-search",
    story: "3-client-grid--fixture-only",
    act: async (p) => {
      await p.getByRole("searchbox", { name: "Search rows" }).fill("zzz");
      await p.waitForTimeout(600);
    },
  },
  // v0.3
  { name: "W-20-toolbar-columns-before", story: "3-client-grid--fixture-only" },
  ...(["light", "dark"] as const).map((scheme) => ({
    name: `W-21-columns-popover-${scheme}`,
    story: "3-client-grid--fixture-only",
    scheme,
    act: async (p: Page) => {
      await p.getByRole("button", { name: "Columns", exact: true }).click();
      await p.getByRole("dialog", { name: "Columns" }).getByRole("checkbox", { name: "Fee" }).click();
      await p.waitForTimeout(300);
    },
  })),
  ...(["light", "dark"] as const).map((scheme) => ({
    name: `W-22-option-who-can-set-${scheme}`,
    story: "3-client-grid--fixture-only",
    scheme,
    act: async (p: Page) => {
      await p.locator('.ag-header-cell[col-id="col_status"]').hover();
      await p.getByRole("button", { name: "Column menu: Payment status" }).click({ force: true });
      await p.getByRole("menuitem", { name: /Edit column/ }).click();
      await p.getByTestId("option-settable-by").first().waitFor();
      await p.getByTestId("option-settable-by").first().click();
      await p.waitForTimeout(400);
    },
  })),
  // v0.3.1: the "save" banner (per-cell server messages) after a failed edit.
  ...(["light", "dark"] as const).map((scheme) => ({
    name: `W-23-save-failed-${scheme}`,
    story: "8-workbench-states--save-errors",
    scheme,
    act: async (p: Page) => {
      const cell = p.locator('.ag-row[row-id="r1"] .ag-cell[col-id="col_name"]');
      await cell.dblclick();
      await p.keyboard.type("Zed");
      await p.keyboard.press("Enter");
      await p.getByTestId("workbench-banner-save").waitFor();
      await p.waitForTimeout(400);
    },
  })),
];
const only = (process.env.ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const selected = only.length > 0 ? shots.filter((s) => only.some((prefix) => s.name.startsWith(prefix))) : shots;

const browser = await chromium.launch();
for (const s of selected) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 720 } });
  await page.clock.setSystemTime(new Date("2026-09-24T21:00:00.000Z"));
  await page.goto(`${BASE}/iframe.html?id=${s.story}&viewMode=story&globals=theme:${s.scheme ?? "light"}`);
  await page.locator('[data-testid="workbench"]').waitFor();
  await page.waitForTimeout(900);
  await s.act?.(page);
  await page.screenshot({ path: join(outDir, `${s.name}${tag}.png`) });
  await page.close();
}
await browser.close();
