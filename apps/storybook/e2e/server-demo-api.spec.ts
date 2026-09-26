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
  pasteText,
  politeText,
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
      // Wire contract: the body is the GridQuery; the answer is `{ data }`.
      data: {
        filter: SECTION_8_AST,
        sort: [],
        page: { offset: 0, limit: 100 },
      },
    });
    expect(res.ok()).toBe(true);
    return (
      (await res.json()) as { data: { rows: { id: string }[] } }
    ).data.rows.map((r) => r.id);
  };
  expect(await fetchIds()).toEqual(["r2", "r3"]);
  expect(await fetchIds(NEXT_DAY)).toEqual([]);
});

test("counsellor role: hidden column absent, read-only fee", async ({
  page,
}) => {
  await openServerStory(page);
  await page.getByText("Counsellor", { exact: true }).click();
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
    page.getByRole("dialog", { name: "Edit conflict" });

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

  // The cell shows the overwrite optimistically; poll until the write has landed.
  const storedName = async () => {
    const res = await request.post(`${API}/grid/fetch`, {
      headers: { "content-type": "application/json" },
      data: {
        filter: { columnId: "col_name", operator: "startsWith", value: "Asha" },
        sort: [],
        page: { offset: 0, limit: 5 },
      },
    });
    const rows = (
      (await res.json()) as {
        data: { rows: { id: string; cells: { name: string } }[] };
      }
    ).data.rows;
    return rows.find((r) => r.id === "r1")?.cells.name;
  };
  await expect.poll(storedName).toBe("Asha (A wins)");
  await a.context().close();
  await b.context().close();
});

test("§12 server-mode grouping: collapsed group rows, expanding fetches that group's rows", async ({
  page,
}) => {
  await openServerStory(page, "&sgPoll=off");
  // Grouping lives in the "Group" popover (ui-mantine GroupByBar).
  await page.getByRole("button", { name: "Group", exact: true }).click();
  await page.getByRole("textbox", { name: "Add group" }).click();
  await page.getByRole("option", { name: "Payment status" }).click();
  await page.keyboard.press("Escape");
  const groups = page.locator(".sg-group-row");
  await expect(groups).toHaveCount(4);
  await expect(
    page.locator(".sg-group-toggle[aria-expanded='true']"),
  ).toHaveCount(0);
  await expect(
    groups.filter({ hasText: "Paid" }).locator(".sg-group-count"),
  ).toHaveText("2");

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
  // v0.3 default name: `${gridId}-${view}-${YYYY-MM-DD}.csv`, slugified.
  expect(file.suggestedFilename()).toMatch(/^admissions-all-rows-\d{4}-\d{2}-\d{2}\.csv$/);
  const path = await file.path();
  const csv = (await readFile(path, "utf8")).replace(/^\uFEFF/, "");
  const lines = csv.split("\r\n");
  expect(lines[0]).toContain("Name");
  // Every fixture row, not just the loaded block: the export re-queried the view.
  expect(lines.slice(1).filter(Boolean)).toHaveLength(5);
  expect(csv).toContain("Bhavesh Rao"); // r1's name is edited by the §9 test above
  const exportFetches = (await calls(page, "fetch")).slice(before);
  expect(exportFetches.length).toBeGreaterThan(0);
});

/**
 * Spec v0.2 acceptance 1–3 on the `leads` grid (story "leads (existing
 * table)"): a plain MySQL table exposed with `defineGrid` +
 * `createSqlViewDataSource`, page = `<SchemaGridWorkbench client>`.
 */
test("v0.2 leads over an existing table: §8 filter, unsortable header, paste skips aiVerified, '+' column survives reload", async ({
  page,
  context,
  request,
}) => {
  expect((await request.post(`${API}/__reset`)).ok()).toBe(true);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const fetchBodies: { filter?: unknown; sort?: unknown }[] = [];
  const writes: { changes: { columnId: string }[] }[] = [];
  page.on("request", (req) => {
    if (req.method() !== "POST") return;
    if (req.url().endsWith("/grid/leads/fetch")) fetchBodies.push(req.postDataJSON());
    if (req.url().endsWith("/grid/leads/applyChanges")) writes.push(req.postDataJSON());
  });
  const openLeads = async () => {
    await page.goto(`/iframe.html?id=${STORIES.leads}&viewMode=story`);
    await page.locator(".ag-row[row-id]").first().waitFor();
  };
  await openLeads();

  // 1. §8 over the plain table: ids with call_date = yesterday (IST) and status not Paid (NULL included).
  // Seed rule (apps/demo-api leads/table.ts): status = [null, paid, pending, failed][i % 4], call date = now - (i % 7) days.
  const expected = Array.from({ length: 1200 }, (_, k) => k + 1)
    .filter((i) => i % 7 === 1 && i % 4 !== 1)
    .map(String);
  await buildSection8Filter(page);
  await expect
    .poll(() => fetchBodies.at(-1)?.filter)
    .toEqual({
      op: "and",
      children: [
        { columnId: "paymentStatus", operator: "isNot", value: "paid" },
        { columnId: "callDate", operator: "isWithin", value: { relative: "yesterday" } },
      ],
    });
  await expect
    .poll(async () => {
      const ids = await renderedRowIds(page);
      return ids.length > 0 && ids.every((id, i) => id === expected[i]);
    })
    .toBe(true);
  await expect(cell(page, "8", "paymentStatus")).toHaveText(""); // NULL status is in
  await page.getByRole("button", { name: /^Remove filter: / }).first().click();
  await page.getByRole("button", { name: /^Remove filter: / }).first().click();
  await expect(page.getByRole("button", { name: /^Remove filter: / })).toHaveCount(0);

  // 2a. aiVerified (sortable:false) has no sort affordance; name has one. Clicking it sends no sort.
  const aiHeader = page.locator('.ag-header-cell[col-id="aiVerified"]');
  await expect(page.locator('.ag-header-cell[col-id="name"]')).toHaveClass(/ag-header-cell-sortable/);
  await expect(aiHeader).not.toHaveClass(/ag-header-cell-sortable/);
  await expect(aiHeader).not.toHaveAttribute("aria-sort", /.+/);
  const fetchesBefore = fetchBodies.length;
  await aiHeader.locator(".ag-header-cell-label, .sg-header").first().click();
  await page.waitForTimeout(300);
  expect(
    fetchBodies.slice(fetchesBefore).some((b) => JSON.stringify(b.sort ?? []).includes("aiVerified")),
  ).toBe(false);

  // 2b. Paste over aiVerified (settable:false): reported as skipped, never sent.
  await cell(page, "1", "aiVerified").click();
  await pasteText(page, "true");
  await expect.poll(() => politeText(page)).toBe("Paste: 0 pasted, 1 skipped, 0 errors");
  await page.waitForTimeout(300);
  expect(writes.flatMap((w) => w.changes.map((c) => c.columnId))).not.toContain("aiVerified");

  // 3. "+" adds a column → persisted in the API's schema store (MySQL) → still there after a reload, with its value.
  await page.getByRole("button", { name: "Add column at end" }).click();
  const dialog = page.getByRole("dialog", { name: "New column" });
  await dialog.getByRole("textbox", { name: "Name" }).fill("Follow up");
  await dialog.getByRole("button", { name: "Create column" }).click();
  await expect(dialog).toHaveCount(0);
  const header = page.locator(".ag-header-cell").filter({ hasText: "Follow up" });
  await expect(header).toHaveCount(1);
  const colId = (await header.getAttribute("col-id")) as string;
  expect(colId).toBeTruthy();
  await cell(page, "2", colId).dblclick();
  await page.keyboard.type("call again");
  await page.keyboard.press("Enter");
  await expect
    .poll(() => writes.flatMap((w) => w.changes.map((c) => c.columnId)))
    .toContain(colId);

  await openLeads();
  await expect(page.locator(".ag-header-cell").filter({ hasText: "Follow up" })).toHaveCount(1);
  await expect(cell(page, "2", colId)).toHaveText("call again");
});

/**
 * v0.3.1 refresh after save: editing `name` updates the server-computed
 * `contact` column right away from the rows the save result carries — no
 * change-feed poll needed. Lives in this serial file because every spec that
 * talks to the demo-api resets the same database (`POST /__reset`).
 */
test("editing name refreshes the computed contact cell from the save result (no getChanges poll)", async ({ page }) => {
  let applyRows: unknown[] | undefined;
  let feedRowsBeforeRefresh = 0;
  let refreshed = false;
  page.on("response", async (res) => {
    const url = res.url();
    if (!url.includes("/grid/leads/")) return;
    if (url.endsWith("/applyChanges")) {
      const body = (await res.json().catch(() => null)) as { data?: { rows?: unknown[] } } | null;
      applyRows = body?.data?.rows;
    } else if (url.endsWith("/getChanges") && !refreshed) {
      const body = (await res.json().catch(() => null)) as { data?: { rows?: unknown[] } } | null;
      if ((body?.data?.rows?.length ?? 0) > 0) feedRowsBeforeRefresh += 1;
    }
  });
  await page.goto(`/iframe.html?id=${STORIES.leads}&viewMode=story`);
  await page.locator(".ag-row[row-id]").first().waitFor();

  const contact = cell(page, "1", "contact");
  await expect(contact).toHaveText("Lead 0001 <lead1@example.com>");
  // Computed: read-only — no editor opens on a double click.
  await contact.dblclick();
  await expect(page.locator(".ag-cell-inline-editing")).toHaveCount(0);

  await cell(page, "1", "name").dblclick();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Zed");
  await page.keyboard.press("Enter");
  await expect(contact).toHaveText("Zed <lead1@example.com>", { timeout: 3_000 });
  refreshed = true;

  // The save result carried the refreshed row (`rows`), and no poll delivered it first.
  expect(Array.isArray(applyRows)).toBe(true);
  expect(JSON.stringify(applyRows)).toContain("Zed <lead1@example.com>");
  expect(feedRowsBeforeRefresh).toBe(0);
});
