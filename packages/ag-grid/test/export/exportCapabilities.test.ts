import { describe, expect, it, vi } from "vitest";
import { exportCurrentView } from "../../src/export/exportCurrentView";
import {
  createDefaultRegistry,
  type DataSource,
  type GridQuery,
  type GridRow,
  type IoExportOptions,
  type QueryResult,
} from "../../src/internal/core";
import { createInMemoryDataSource } from "../fixtures/dataSource";
import { ADMIN, fixtureSchema, row } from "../fixtures/schema";

const registry = createDefaultRegistry();
const columns = fixtureSchema.columns.filter((c) => c.id === "name");

function fakeIo() {
  const captured: GridRow[][] = [];
  const buildExportBlob = vi.fn(async (opts: IoExportOptions) => {
    captured.push(opts.rows as GridRow[]);
    return new Blob(["ok"]);
  });
  return { io: { buildExportBlob }, captured };
}

const manyRows = (n: number) => Array.from({ length: n }, (_, i) => row(`r${String(i).padStart(5, "0")}`, { name: `Row ${i}` }));

describe("exportCurrentView — capabilities (C2)", () => {
  it("regression: a source clamping pages to maxPageSize 200 still exports all 1,200 rows", async () => {
    const dataSource = createInMemoryDataSource(fixtureSchema, manyRows(1200), {
      user: ADMIN,
      capabilities: { maxPageSize: 200 },
    });
    const { io, captured } = fakeIo();
    // Asks for 500 per page; the source silently returns 200 (a "short" page).
    await exportCurrentView({ format: "csv", dataSource, query: { filter: null, sort: [] }, columns, registry, io });
    expect(captured[0]).toHaveLength(1200);
    expect(new Set(captured[0]?.map((r) => r.id)).size).toBe(1200);
  });

  it("never stops on a short page without a total: continues until an empty page", async () => {
    const all = manyRows(7);
    // Returns at most 3 per page, never a total.
    const fetch = vi.fn(async (q: GridQuery): Promise<QueryResult<GridRow>> => {
      const offset = q.page.offset ?? 0;
      return { rows: all.slice(offset, offset + Math.min(3, q.page.limit)) };
    });
    const { io, captured } = fakeIo();
    await exportCurrentView({ format: "csv", dataSource: { fetch }, query: { filter: null, sort: [] }, columns, registry, pageSize: 5, io });
    expect(captured[0]).toHaveLength(7);
    expect(fetch).toHaveBeenCalledTimes(4); // 3 + 3 + 1 + empty
  });

  it("cursor paging follows nextCursor until it is absent", async () => {
    const all = manyRows(5);
    const fetch = vi.fn(async (q: GridQuery): Promise<QueryResult<GridRow>> => {
      const start = q.page.cursor !== undefined ? Number(q.page.cursor) : 0;
      const end = Math.min(start + 2, all.length);
      return { rows: all.slice(start, end), ...(end < all.length ? { nextCursor: String(end) } : {}) };
    });
    const { io, captured } = fakeIo();
    await exportCurrentView({
      format: "csv",
      dataSource: { fetch } as Pick<DataSource<GridRow>, "fetch">,
      query: { filter: null, sort: [] },
      columns,
      registry,
      pageSize: 2,
      pageMode: "cursor",
      io,
    });
    expect(captured[0]?.map((r) => r.id)).toEqual(all.map((r) => r.id));
    expect(fetch.mock.calls.map((c) => (c[0] as GridQuery).page)).toEqual([
      { offset: 0, limit: 2 },
      { cursor: "2", limit: 2 },
      { cursor: "4", limit: 2 },
    ]);
  });

  it("honours maxRows: stops fetching and truncates at it", async () => {
    const dataSource = createInMemoryDataSource(fixtureSchema, manyRows(50), { user: ADMIN });
    const { io, captured } = fakeIo();
    await exportCurrentView({
      format: "csv",
      dataSource,
      query: { filter: null, sort: [] },
      columns,
      registry,
      pageSize: 20,
      maxRows: 30,
      io,
    });
    expect(captured[0]).toHaveLength(30);
    expect(dataSource.calls.fetch).toHaveBeenCalledTimes(2);
    // The second page only asks for what is still needed.
    expect((dataSource.calls.fetch.mock.calls[1]?.[0] as GridQuery).page).toEqual({ offset: 20, limit: 10 });
  });
});
