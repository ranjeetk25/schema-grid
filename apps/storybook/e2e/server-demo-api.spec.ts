/**
 * Spec §8 end to end against apps/demo-api + MySQL (story "4. Server mode"):
 * FilterButton builds the AST → it goes over HTTP → the server translates it
 * to SQL (Asia/Kolkata, clock pinned to FIXTURE_NOW by the API) → rows with
 * an EMPTY payment status are included → saved as a view → reopened "the
 * next day" it still means yesterday. Plus playwright-scenarios.md §9 with
 * two real browser contexts (two users) against the same database.
 *
 * Skipped unless the API answers at http://localhost:3001/health
 * (`bun run db:up && bun run dev:api`).
 */
import { readFile } from "node:fs/promises";
import { type Page, expect, test } from "@playwright/test";
import {
  FIXTURE_NOW,
  SECTION_8_AST,
  STORIES,
  buildSection8Filter,
  calls,
  cell,
  renderedRowIds,
} from "./helpers";

const API = process.env.DEMO_API_URL ?? "http://localhost:3001";
const NEXT_DAY = new Date(
  new Date(FIXTURE_NOW).getTime() + 86_400_000,
).toISOString();

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  const health = await request.get(`${API}/health`).catch(() => null);
  test.skip(
    !health?.ok(),
    `demo-api not reachable at ${API} (bun run db:up && bun run dev:api)`,
  );
  expect((await request.post(`${API}/__reset`)).ok()).toBe(true);
});

async function openServerStory(page: Page, extra = ""): Promise<void> {
  await page.goto(`/iframe.html?id=${STORIES.server}&viewMode=story${extra}`);
  await page.locator(".ag-row[row-id]").first().waitFor();
}

test("§8 over HTTP + MySQL: empty status included, saved view still means 'yesterday' the next day", async ({
  page,
}) => {
  await openServerStory(page);
  await buildSection8Filter(page);
  await expect.poll(() => renderedRowIds(page)).toEqual(["r2", "r3"]);
  await expect(cell(page, "r3", "col_status")).toHaveText("");

  // The exact AST went over the wire.
  const fetches = await calls(page, "fetch");
  const last = fetches.at(-1)?.arg as { filter: unknown };
  expect(last.filter).toEqual(SECTION_8_AST);

  await page.getByRole("button", { name: "All rows" }).click();
  await page.getByRole("menuitem", { name: "Save as new view" }).click();
  await page
    .getByRole("textbox", { name: "View name" })
    .fill("Unpaid, called yesterday");
  await page.getByRole("textbox", { name: "View name" }).press("Enter");
  await expect(
    page.getByRole("button", { name: "Unpaid, called yesterday" }),
  ).toBeVisible();

  // Reopen the saved view (persisted in localStorage) with the API clock one day later.
  await openServerStory(page, `&sgNow=${encodeURIComponent(NEXT_DAY)}`);
  await page.getByRole("button", { name: "All rows" }).click();
  await page
    .getByRole("menuitem", { name: "Unpaid, called yesterday" })
    .click();
  await expect
    .poll(async () => (await calls(page, "fetch")).at(-1)?.arg)
    .toMatchObject({ filter: SECTION_8_AST });
  // Yesterday is now 2026-09-25 IST: nobody in the fixture was called then.
  await expect.poll(() => renderedRowIds(page)).toEqual([]);
});

test("§8 at the API level: same filter, both clocks", async ({ request }) => {
  const fetchIds = async (now?: string) => {
    const res = await request.post(`${API}/grid/fetch`, {
      headers: {
        "content-type": "application/json",
        ...(now ? { "x-now": now } : {}),
      },
      data: {
        query: {
          filter: SECTION_8_AST,
          sort: [],
          page: { offset: 0, limit: 100 },
        },
      },
    });
    expect(res.ok()).toBe(true);
    return ((await res.json()) as { rows: { id: string }[] }).rows.map(
      (r) => r.id,
    );
  };
  expect(await fetchIds()).toEqual(["r2", "r3"]);
  expect(await fetchIds(NEXT_DAY)).toEqual([]);
});

test("counsellor role: hidden column absent, read-only fee", async ({
  page,
}) => {
  await openServerStory(page);
  await page.getByText("counsellor", { exact: true }).click();
  await page.locator('.ag-header-cell[col-id="col_name"]').first().waitFor();
  await expect(page.locator('.ag-header-cell[col-id="col_notes"]')).toHaveCount(
    0,
  );
  await expect(cell(page, "r1", "col_name")).toBeVisible();
  await cell(page, "r1", "col_fee").dblclick();
  await expect(cell(page, "r1", "col_fee").locator("input")).toHaveCount(0);
});

test("§9 two browser contexts: B saves first, A's stale edit conflicts; keepTheirs then overwrite", async ({
  browser,
  request,
}) => {
  expect((await request.post(`${API}/__reset`)).ok()).toBe(true);
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await openServerStory(a, "&sgPoll=off");
  await openServerStory(b, "&sgPoll=off");

  const editName = async (page: Page, value: string) => {
    await cell(page, "r1", "col_name").click();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(value);
    await page.keyboard.press("Enter");
  };
  const popover = (page: Page) =>
    page.locator('[role="dialog"][aria-label="Edit conflict"]');

  await editName(b, "Asha (B)");
  await expect
    .poll(async () => (await calls(b, "applyChanges")).length)
    .toBe(1);
  await expect(b.getByTestId("saved-count")).toHaveText("1");

  // A still shows the original value and version.
  await expect(cell(a, "r1", "col_name")).toHaveText("Asha Verma");
  await editName(a, "Asha (A)");
  await expect(popover(a)).toBeVisible();
  await expect(popover(a)).toContainText("Asha (B)");
  await popover(a).getByRole("button", { name: "Keep theirs" }).click();
  await expect(cell(a, "r1", "col_name")).toHaveText("Asha (B)");

  // B changes it again; A edits (stale again) and this time overwrites.
  await editName(b, "Asha (B2)");
  await expect(b.getByTestId("saved-count")).toHaveText("2");
  await editName(a, "Asha (A wins)");
  await expect(popover(a)).toBeVisible();
  await popover(a).getByRole("button", { name: "Overwrite" }).click();
  await expect(cell(a, "r1", "col_name")).toHaveText("Asha (A wins)");

  const res = await request.post(`${API}/grid/fetch`, {
    headers: { "content-type": "application/json" },
    data: {
      query: {
        filter: { columnId: "col_name", operator: "startsWith", value: "Asha" },
        sort: [],
        page: { offset: 0, limit: 5 },
      },
    },
  });
  const rows = (
    (await res.json()) as { rows: { id: string; cells: { name: string } }[] }
  ).rows;
  expect(rows.find((r) => r.id === "r1")?.cells.name).toBe("Asha (A wins)");
  await a.context().close();
  await b.context().close();
});

test("§12 server-mode grouping: collapsed group rows, expanding fetches that group's rows", async ({
  page,
}) => {
  await openServerStory(page, "&sgPoll=off");
  await page.getByRole("textbox", { name: "Add group" }).click();
  await page.getByRole("option", { name: "Payment status" }).click();
  const groups = page.locator(".sg-group-row");
  await expect(groups).toHaveCount(4);
  await expect(
    page.locator(".sg-group-toggle[aria-expanded='true']"),
  ).toHaveCount(0);
  await expect(
    groups.filter({ hasText: "Paid" }).locator(".sg-group-count"),
  ).toHaveText(" (2)");

  const before = (await calls(page, "fetch")).length;
  await groups
    .filter({ hasText: "Pending" })
    .locator(".sg-group-toggle")
    .click();
  await expect(cell(page, "r2", "col_name")).toHaveText("Bhavesh Rao");
  const groupFetches = (await calls(page, "fetch")).slice(before);
  expect(groupFetches).toHaveLength(1);
  expect(JSON.stringify(groupFetches[0]?.arg)).toContain('"pending"');
  // Only that group's rows were loaded.
  await expect(cell(page, "r1", "col_name")).toHaveCount(0);
});

test("§14 server-mode 'Export CSV' pages the current view through the data source", async ({
  page,
}) => {
  await openServerStory(page, "&sgPoll=off");
  const before = (await calls(page, "fetch")).length;
  const download = page.waitForEvent("download", { timeout: 10_000 });
  await page.getByRole("button", { name: "Export CSV" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("schema-grid.csv");
  const path = await file.path();
  const csv = (await readFile(path, "utf8")).replace(/^\uFEFF/, "");
  const lines = csv.split("\r\n");
  expect(lines[0]).toContain("Name");
  // Every fixture row, not just the loaded block: the export re-queried the view.
  expect(lines.slice(1).filter(Boolean)).toHaveLength(5);
  expect(csv).toContain("Asha Verma");
  const exportFetches = (await calls(page, "fetch")).slice(before);
  expect(exportFetches.length).toBeGreaterThan(0);
});
