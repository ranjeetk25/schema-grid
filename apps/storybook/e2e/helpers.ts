import { type Locator, type Page, expect } from "@playwright/test";

/** Instant the fixture is designed around (core FIXTURE_NOW): 2026-09-25 02:30 IST. */
export const FIXTURE_NOW = "2026-09-24T21:00:00.000Z";

export const STORIES = {
  fieldTypes: "1-field-types--mantine",
  permissionsMatrix: "2-permissions--matrix",
  client: "3-client-grid--full-toolbar",
  clientFixture: "3-client-grid--fixture-only",
  clientPersisted: "3-client-grid--persisted-views",
  server: "4-server-mode-demo-api--demo-api",
  leads: "4-server-mode-demo-api--leads",
  importExport: "5-import-and-export--import-and-export",
  conflict: "6-conflict-prompt--keep-theirs-or-overwrite",
  polling: "7-polling-sync--polling-highlight",
} as const;

export async function openStory(
  page: Page,
  id: string,
  opts: { pinClock?: boolean } = {},
): Promise<void> {
  // Client-mode relative dates use the browser clock: pin it to the fixture's "now".
  if (opts.pinClock !== false)
    await page.clock.setSystemTime(new Date(FIXTURE_NOW));
  await page.goto(`/iframe.html?id=${id}&viewMode=story`);
  await page.locator(".ag-row").first().waitFor();
}

/** A data cell (pinned or not). Pass a Locator instead of the page when a story renders several grids. */
export function cell(
  page: Page | Locator,
  rowId: string,
  colId: string,
): Locator {
  return page.locator(`.ag-row[row-id="${rowId}"] .ag-cell[col-id="${colId}"]`);
}

export async function cellText(
  page: Page | Locator,
  rowId: string,
  colId: string,
): Promise<string> {
  return ((await cell(page, rowId, colId).textContent()) ?? "").trim();
}

/** Row ids currently rendered, top to bottom. */
export async function renderedRowIds(page: Page | Locator): Promise<string[]> {
  const rows = page.locator(".ag-grid-scrolling-container > .ag-row");
  const entries = await rows.evaluateAll((els) =>
    els.map((e) => ({
      id: e.getAttribute("row-id") ?? "",
      index: Number(e.getAttribute("row-index") ?? "0"),
    })),
  );
  return entries.sort((a, b) => a.index - b.index).map((e) => e.id);
}

export interface CallRecord {
  op: string;
  arg: unknown;
}

/** DataSource calls recorded by the stories' `instrument()` wrapper. */
export async function calls(page: Page, op?: string): Promise<CallRecord[]> {
  const all = await page.evaluate(
    () =>
      (window as unknown as { __sg?: { calls: CallRecord[] } }).__sg?.calls.map(
        (c) => ({ op: c.op, arg: c.arg }),
      ) ?? [],
  );
  return op ? all.filter((c) => c.op === op) : all;
}

/** Stored (server-side) cell value from a story's exposed memory snapshot. */
export async function storedCell(
  page: Page,
  story: string,
  rowId: string,
  key: string,
): Promise<unknown> {
  return page.evaluate(
    ([s, r, k]) => {
      const api = (
        window as unknown as {
          __sg: {
            stories: Record<
              string,
              { snapshot(): { id: string; cells: Record<string, unknown> }[] }
            >;
          };
        }
      ).__sg.stories[s as string];
      return api?.snapshot().find((row) => row.id === r)?.cells[k as string];
    },
    [story, rowId, key],
  );
}

export async function politeText(page: Page): Promise<string> {
  return ((await page.locator(".sg-live-polite").first().textContent()) ?? "")
    .replace(/\u200b/g, "")
    .trim();
}

export async function assertiveText(page: Page): Promise<string> {
  return (
    (await page.locator(".sg-live-assertive").first().textContent()) ?? ""
  )
    .replace(/\u200b/g, "")
    .trim();
}

/** Picks an option from a Mantine Select identified by its accessible name inside `scope`. */
export async function pickOption(
  page: Page,
  scope: Locator,
  box: string,
  nth: number,
  option: string,
): Promise<void> {
  await scope.getByRole("textbox", { name: box }).nth(nth).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

/** Builds the spec §8 filter through the FilterButton popover. */
export async function buildSection8Filter(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /^Filter/ });
  await dialog.getByRole("button", { name: "Add condition" }).click();
  await pickOption(page, dialog, "Column", 0, "Payment status");
  await pickOption(page, dialog, "Operator", 0, "is not");
  await pickOption(page, dialog, "Value", 0, "Paid");
  await dialog.getByRole("button", { name: "Add condition" }).click();
  await pickOption(page, dialog, "Column", 1, "Call date");
  await pickOption(page, dialog, "Operator", 1, "is within");
  await pickOption(page, dialog, "Relative date", 0, "Yesterday");
  // Popover stays open through all nested dropdowns (withinPortal=false).
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
}

export const SECTION_8_AST = {
  op: "and",
  children: [
    { columnId: "col_status", operator: "isNot", value: "paid" },
    {
      columnId: "col_callDate",
      operator: "isWithin",
      value: { relative: "yesterday" },
    },
  ],
};

/** Puts `text` on the OS clipboard and presses Ctrl/Cmd+V at the focused grid cell. */
export async function pasteText(page: Page, text: string): Promise<void> {
  await page.evaluate(async (t) => navigator.clipboard.writeText(t), text);
  await page.keyboard.press("ControlOrMeta+v");
}
