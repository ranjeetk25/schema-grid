import { describe, expect, it } from "vitest";
import type { DataSource, GridQuery, GridRow, QueryResult } from "../../../src/internal/core";
import { iterateQuery } from "../../../src/jobs/query-iterator";

function makeRow(id: string): GridRow {
  return { id, version: 1, updatedAt: "2026-01-01T00:00:00.000Z", cells: {} };
}

function notImplemented(name: string): () => never {
  return () => {
    throw new Error(`${name} not implemented in fake`);
  };
}

function fakeDataSource(
  pagesByCursor: Record<string, QueryResult<GridRow>>,
  calls: GridQuery[],
): DataSource<GridRow> {
  return {
    fetch: async (query) => {
      calls.push(query);
      const cursor = "cursor" in query.page ? (query.page.cursor ?? "") : "";
      const page = pagesByCursor[cursor];
      if (!page) throw new Error(`fake: no page registered for cursor "${cursor}"`);
      return page;
    },
    applyChanges: notImplemented("applyChanges"),
    createRows: notImplemented("createRows"),
    deleteRows: notImplemented("deleteRows"),
  };
}

const baseQuery: GridQuery = { filter: null, sort: [], page: { offset: 0, limit: 10 } };

describe("iterateQuery", () => {
  it("forces cursor mode: the first request uses an empty cursor", async () => {
    const calls: GridQuery[] = [];
    const ds = fakeDataSource({ "": { rows: [makeRow("a")] } }, calls);

    const pages: QueryResult<GridRow>[] = [];
    for await (const page of iterateQuery(ds, baseQuery, { pageSize: 3 })) pages.push(page);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.page).toEqual({ cursor: "", limit: 3 });
    expect(pages).toHaveLength(1);
  });

  it("follows nextCursor across pages until it is absent", async () => {
    const calls: GridQuery[] = [];
    const ds = fakeDataSource(
      {
        "": { rows: [makeRow("a")], nextCursor: "c1" },
        c1: { rows: [makeRow("b")], nextCursor: "c2" },
        c2: { rows: [makeRow("c")] },
      },
      calls,
    );

    const ids: string[] = [];
    for await (const page of iterateQuery(ds, baseQuery, { pageSize: 2 })) {
      ids.push(...page.rows.map((r) => r.id));
    }

    expect(ids).toEqual(["a", "b", "c"]);
    expect(calls.map((c) => c.page)).toEqual([
      { cursor: "", limit: 2 },
      { cursor: "c1", limit: 2 },
      { cursor: "c2", limit: 2 },
    ]);
  });

  it("defaults pageSize to 500", async () => {
    const calls: GridQuery[] = [];
    const ds = fakeDataSource({ "": { rows: [] } }, calls);
    for await (const _page of iterateQuery(ds, baseQuery)) {
      // drain
    }
    expect(calls[0]!.page).toEqual({ cursor: "", limit: 500 });
  });

  it("stops iteration once the signal is aborted, without fetching further pages", async () => {
    const calls: GridQuery[] = [];
    const ds = fakeDataSource(
      {
        "": { rows: [makeRow("a")], nextCursor: "c1" },
        c1: { rows: [makeRow("b")], nextCursor: "c2" },
        c2: { rows: [makeRow("c")] },
      },
      calls,
    );
    const controller = new AbortController();

    const pages: QueryResult<GridRow>[] = [];
    for await (const page of iterateQuery(ds, baseQuery, { signal: controller.signal })) {
      pages.push(page);
      controller.abort();
    }

    expect(pages).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it("never fetches at all when the signal starts already aborted", async () => {
    const calls: GridQuery[] = [];
    const ds = fakeDataSource({ "": { rows: [makeRow("a")] } }, calls);
    const controller = new AbortController();
    controller.abort();

    const pages: QueryResult<GridRow>[] = [];
    for await (const page of iterateQuery(ds, baseQuery, { signal: controller.signal })) pages.push(page);

    expect(pages).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });
});
