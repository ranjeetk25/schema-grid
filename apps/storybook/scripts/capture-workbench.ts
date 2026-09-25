/**
 * Workbench screenshots (docs/design/progress/W-*) against a running Storybook.
 *   STORYBOOK_URL=http://localhost:6017 bun apps/storybook/scripts/capture-workbench.ts [tag]
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
];

const browser = await chromium.launch();
for (const s of shots) {
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
