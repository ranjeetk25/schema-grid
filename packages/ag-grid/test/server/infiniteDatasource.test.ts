import type { IGetRowsParams } from "ag-grid-community";
import { describe, expect, it, vi } from "vitest";
import type { DataSource, GridQuery, GridRow, QueryResult } from "../../src/internal/core";
import { createCursorCache } from "../../src/server/cursorCache";
import { INFINITE_DEFAULTS, createInfiniteDatasource } from "../../src/server/infiniteDatasource";
import { createInMemoryDataSource } from "../fixtures/dataSource";
import { fixtureSchema, row } from "../fixtures/schema";

const rows: GridRow[] = Array.from({ length: 25 }, (_, i) => row(`r${i}`, { name: `n${String(i).padStart(2, "0")}`, score: i }));

function call(ds: { getRows(p: IGetRowsParams): void }, startRow: number, endRow: number) {
  return new Promise<{ ok: true; rows: unknown[]; lastRow: number | undefined } | { ok: false }>((resolve) => {
    ds.getRows({
      startRow,
      endRow,
      sortModel: [],
      filterModel: {},
      successCallback: (r: unknown[], lastRow?: number) => resolve({ ok: true, rows: r, lastRow }),
      failCallback: () => resolve({ ok: false }),
    } as unknown as IGetRowsParams);
  });
}

// core's in-memory source encodes offset cursors as "sgm:<base36 offset>".
const C10 = "sgm:a";
const C20 = "sgm:k";

const baseQuery = (): Omit<GridQuery, "page"> => ({ filter: null, sort: [] });

describe("createCursorCache", () => {
  it("stores next cursors per block and resets", () => {
    const c = createCursorCache();
    expect(c.cursorFor(0)).toBeNull();
    expect(c.cursorFor(1)).toBeUndefined();
    c.set(0, "10");
    expect(c.get(0)).toBe("10");
    expect(c.cursorFor(1)).toBe("10");
    c.set(1, undefined);
    expect(c.get(1)).toBeNull();
    expect(c.cursorFor(2)).toBeUndefined();
    c.reset();
    expect(c.get(0)).toBeUndefined();
  });
});

describe("createInfiniteDatasource — offset mode", () => {
  it("maps startRow/endRow into an offset page and forwards the query", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, rows);
    const query: Omit<GridQuery, "page"> = {
      filter: { columnId: "score", operator: "gte", value: 0 },
      sort: [{ columnId: "score", dir: "desc" }],
      search: "n",
      includeTotal: true,
    };
    const onRows = vi.fn();
    const adapter = createInfiniteDatasource({ dataSource: ds, getQuery: () => query, pageMode: "offset", blockSize: 10, onRows });
    const res = await call(adapter, 10, 20);
    expect(ds.calls.fetch).toHaveBeenCalledTimes(1);
    expect(ds.calls.fetch.mock.calls[0]?.[0]).toEqual({ ...query, page: { offset: 10, limit: 10 } });
    expect(res).toMatchObject({ ok: true, lastRow: 25 });
    if (res.ok) expect((res.rows as GridRow[]).map((r) => r.id)[0]).toBe("r14");
    expect(onRows).toHaveBeenCalledWith(expect.any(Array), 10);
  });

  it("lastRow from a short page when total is absent, unknown otherwise", async () => {
    const fetch = vi.fn(async (q: GridQuery): Promise<QueryResult> => {
      const off = q.page.offset ?? 0;
      return { rows: rows.slice(off, off + q.page.limit) };
    });
    const adapter = createInfiniteDatasource({ dataSource: { fetch } as unknown as DataSource, getQuery: baseQuery, pageMode: "offset", blockSize: 10 });
    expect(await call(adapter, 0, 10)).toMatchObject({ ok: true, lastRow: undefined });
    expect(await call(adapter, 20, 30)).toMatchObject({ ok: true, lastRow: 25 });
  });
});

describe("createInfiniteDatasource — cursor mode", () => {
  it("block 0 is requested by offset 0 (core cursors are strings); block 1 uses block 0's nextCursor", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, rows);
    const adapter = createInfiniteDatasource({ dataSource: ds, getQuery: baseQuery, pageMode: "cursor", blockSize: 10 });
    const first = await call(adapter, 0, 10);
    expect(first).toMatchObject({ ok: true, lastRow: undefined });
    await call(adapter, 10, 20);
    expect(ds.calls.fetch.mock.calls.map((c) => (c[0] as GridQuery).page)).toEqual([
      { offset: 0, limit: 10 },
      { cursor: C10, limit: 10 },
    ]);
  });

  it("jumping to block 2 cold fetches blocks 0–1 first and feeds onRows for them", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, rows);
    const onRows = vi.fn();
    const adapter = createInfiniteDatasource({ dataSource: ds, getQuery: baseQuery, pageMode: "cursor", blockSize: 10, onRows });
    const res = await call(adapter, 20, 30);
    expect(ds.calls.fetch.mock.calls.map((c) => (c[0] as GridQuery).page)).toEqual([
      { offset: 0, limit: 10 },
      { cursor: C10, limit: 10 },
      { cursor: C20, limit: 10 },
    ]);
    expect(onRows.mock.calls.map((c) => [(c[0] as GridRow[]).length, c[1]])).toEqual([
      [10, 0],
      [10, 10],
      [5, 20],
    ]);
    // lastRow is known because block 2 has no nextCursor
    expect(res).toMatchObject({ ok: true, lastRow: 25 });
    // core orders unsorted rows by id in code-unit order (r0, r1, r10…r19, r2, r20…r24, r3…r9).
    if (res.ok) expect((res.rows as GridRow[]).map((r) => r.id)).toEqual(["r5", "r6", "r7", "r8", "r9"]);
  });

  it("reuses cached cursors on a later jump", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, rows);
    const adapter = createInfiniteDatasource({ dataSource: ds, getQuery: baseQuery, pageMode: "cursor", blockSize: 10 });
    await call(adapter, 0, 10);
    ds.calls.fetch.mockClear();
    await call(adapter, 20, 30);
    expect(ds.calls.fetch.mock.calls.map((c) => (c[0] as GridQuery).page)).toEqual([
      { cursor: C10, limit: 10 },
      { cursor: C20, limit: 10 },
    ]);
  });

  it("walking past the end serves an empty block with lastRow", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, rows);
    const adapter = createInfiniteDatasource({ dataSource: ds, getQuery: baseQuery, pageMode: "cursor", blockSize: 10 });
    expect(await call(adapter, 30, 40)).toEqual({ ok: true, rows: [], lastRow: 25 });
  });

  it("reset() and query changes clear the cursor cache", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, rows);
    let query = baseQuery();
    const adapter = createInfiniteDatasource({ dataSource: ds, getQuery: () => query, pageMode: "cursor", blockSize: 10 });
    await call(adapter, 0, 10);
    adapter.reset();
    ds.calls.fetch.mockClear();
    await call(adapter, 10, 20);
    expect(ds.calls.fetch.mock.calls.map((c) => (c[0] as GridQuery).page)).toEqual([
      { offset: 0, limit: 10 },
      { cursor: C10, limit: 10 },
    ]);

    // a query change is detected even without an explicit reset
    query = { filter: null, sort: [{ columnId: "score", dir: "desc" }] };
    ds.calls.fetch.mockClear();
    await call(adapter, 10, 20);
    expect(ds.calls.fetch.mock.calls.map((c) => (c[0] as GridQuery).page)).toEqual([
      { offset: 0, limit: 10 },
      { cursor: C10, limit: 10 },
    ]);
    expect((ds.calls.fetch.mock.calls[0]?.[0] as GridQuery).sort).toEqual(query.sort);
  });

  it("a failure calls failCallback and onError", async () => {
    const error = new Error("boom");
    const onError = vi.fn();
    const fetch = vi.fn(async () => {
      throw error;
    });
    const adapter = createInfiniteDatasource({ dataSource: { fetch } as unknown as DataSource, getQuery: baseQuery, pageMode: "cursor", blockSize: 10, onError });
    expect(await call(adapter, 0, 10)).toEqual({ ok: false });
    expect(onError).toHaveBeenCalledWith(error);
  });
});

describe("INFINITE_DEFAULTS", () => {
  it("serialises requests in cursor mode", () => {
    expect(INFINITE_DEFAULTS("cursor", 50)).toMatchObject({ cacheBlockSize: 50, maxConcurrentDatasourceRequests: 1 });
    expect(INFINITE_DEFAULTS("offset", 100).cacheBlockSize).toBe(100);
  });
});
