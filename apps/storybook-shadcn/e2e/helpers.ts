import { type Locator, type Page, expect } from "@playwright/test";

/** Instant the fixture is designed around (core FIXTURE_NOW): 2026-09-25 02:30 IST. */
export const FIXTURE_NOW = "2026-09-24T21:00:00.000Z";

export const STORIES = {
  client: "3-client-grid--full-toolbar",
  clientFixture: "3-client-grid--fixture-only",
  clientPersisted: "3-client-grid--persisted-views",
  conflict: "6-conflict-prompt--keep-theirs-or-overwrite",
} as const;

export async function openStory(page: Page, id: string): Promise<void> {
  // Client-mode relative dates use the browser clock: pin it to the fixture's "now".
  await page.clock.setSystemTime(new Date(FIXTURE_NOW));
  await page.goto(`/iframe.html?id=${id}&viewMode=story`);
  await page.locator(".ag-row").first().waitFor();
}

export function cell(page: Page | Locator, rowId: string, colId: string): Locator {
  return page.locator(`.ag-row[row-id="${rowId}"] .ag-cell[col-id="${colId}"]`).first();
}

/** Row ids currently rendered, top to bottom. */
export async function renderedRowIds(page: Page): Promise<string[]> {
  const entries = await page
    .locator(".ag-center-cols-container > .ag-row, .ag-grid-scrolling-container > .ag-row")
    .evaluateAll((els) => els.map((e) => ({ id: e.getAttribute("row-id") ?? "", index: Number(e.getAttribute("row-index") ?? "0") })));
  return [...new Map(entries.map((e) => [e.id, e])).values()].sort((a, b) => a.index - b.index).map((e) => e.id);
}

/** Stored (data-source) cell value from a story's exposed memory snapshot. */
export async function storedCell(page: Page, story: string, rowId: string, key: string): Promise<unknown> {
  return page.evaluate(
    ([s, r, k]) =>
      (
        window as unknown as { __sg: { stories: Record<string, { snapshot(): { id: string; cells: Record<string, unknown> }[] }> } }
      ).__sg.stories[s as string]
        ?.snapshot()
        .find((row) => row.id === r)?.cells[k as string],
    [story, rowId, key],
  );
}

export const SECTION_8_AST = {
  op: "and",
  children: [
    { columnId: "col_status", operator: "isNot", value: "paid" },
    { columnId: "col_callDate", operator: "isWithin", value: { relative: "yesterday" } },
  ],
};

export async function filterAst(page: Page): Promise<unknown> {
  return JSON.parse((await page.getByTestId("filter-ast").textContent()) ?? "null");
}

export { expect };
