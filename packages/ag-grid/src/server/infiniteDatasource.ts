/**
 * Server mode: adapts a core `DataSource` to AG Grid's infinite row model.
 *
 * - offset mode: block [startRow, endRow) → `{ offset: startRow, limit }`.
 * - cursor mode: block 0 → `{ offset: 0, limit }`; block k → `{ cursor, limit }`
 *   using block k-1's nextCursor from the cursor cache. A request for a block whose cursor is unknown walks
 *   forward from the nearest known block, fetching the missing blocks one by
 *   one (their rows go to `onRows` too), then serves the requested block.
 *
 * The grid's own sortModel/filterModel are ignored: filter, sort and search
 * come from `getQuery()` (the query store is the single source of truth).
 */
import type { GridOptions, IDatasource, IGetRowsParams } from "ag-grid-community";
import type { DataSource, GridQuery, GridRow, QueryResult } from "../internal/core";
import { createCursorCache } from "./cursorCache";

export type PageMode = "offset" | "cursor";

export interface InfiniteDatasourceOptions<Row extends GridRow> {
  dataSource: Pick<DataSource<Row>, "fetch">;
  /** Current filter/sort/search/groupBy. Read on every block request. */
  getQuery: () => Omit<GridQuery, "page">;
  pageMode: PageMode;
  blockSize: number;
  /** Every fetched block, including blocks fetched while walking forward (feeds the RowStore). */
  onRows?(rows: Row[], startRow: number): void;
  onError?(error: unknown): void;
}

/** An AG Grid `IDatasource` plus `reset()`, which clears the cursor cache. */
export interface SchemaGridInfiniteDatasource extends IDatasource {
  /**
   * Clear cached cursors / known end. Call alongside `api.purgeInfiniteCache()`
   * when the query changes. A query change is also detected automatically on
   * the next `getRows` (the query is compared by value).
   */
  reset(): void;
}

export function createInfiniteDatasource<Row extends GridRow>(
  opts: InfiniteDatasourceOptions<Row>,
): SchemaGridInfiniteDatasource {
  const { dataSource, getQuery, pageMode, blockSize, onRows, onError } = opts;
  const cursors = createCursorCache();
  /** Total row count once the end has been seen in cursor mode. */
  let knownLastRow: number | undefined;
  /** Bumped on reset so in-flight responses for an old query don't pollute the cache. */
  let generation = 0;
  let lastQueryKey: string | undefined;

  const reset = () => {
    cursors.reset();
    knownLastRow = undefined;
    generation += 1;
  };

  const syncQuery = (): Omit<GridQuery, "page"> => {
    const query = getQuery();
    const key = JSON.stringify(query);
    if (lastQueryKey !== undefined && key !== lastQueryKey) reset();
    lastQueryKey = key;
    return query;
  };

  const fetchPage = (query: Omit<GridQuery, "page">, page: GridQuery["page"]): Promise<QueryResult<Row>> =>
    dataSource.fetch({ ...query, page });

  async function getOffsetBlock(params: IGetRowsParams, query: Omit<GridQuery, "page">) {
    const limit = params.endRow - params.startRow;
    const result = await fetchPage(query, { offset: params.startRow, limit });
    let lastRow: number | undefined;
    if (typeof result.total === "number") lastRow = result.total;
    else if (result.rows.length < limit) lastRow = params.startRow + result.rows.length;
    onRows?.(result.rows, params.startRow);
    params.successCallback(result.rows, lastRow);
  }

  async function getCursorBlock(params: IGetRowsParams, query: Omit<GridQuery, "page">) {
    const gen = generation;
    const target = Math.floor(params.startRow / blockSize);

    // Nearest block at or before `target` whose cursor is known.
    let from = target;
    while (from > 0 && cursors.cursorFor(from) === undefined) {
      if (cursors.get(from - 1) === null) {
        // The data ended before the requested block.
        params.successCallback([], knownLastRow);
        return;
      }
      from -= 1;
    }

    for (let block = from; block <= target; block += 1) {
      const isTarget = block === target;
      const startRow = isTarget ? params.startRow : block * blockSize;
      const limit = isTarget ? params.endRow - params.startRow : blockSize;
      // core's PageRequest cursor is a string: the first page is requested by offset 0.
      const cursor = cursors.cursorFor(block);
      const result = await fetchPage(query, typeof cursor === "string" ? { cursor, limit } : { offset: 0, limit });
      const stale = gen !== generation;
      const ended = !result.nextCursor;
      if (!stale) {
        cursors.set(block, result.nextCursor);
        if (ended) knownLastRow = startRow + result.rows.length;
        onRows?.(result.rows, startRow);
      }
      if (isTarget) {
        const lastRow = ended
          ? startRow + result.rows.length
          : typeof result.total === "number"
            ? result.total
            : undefined;
        params.successCallback(result.rows, lastRow);
        return;
      }
      if (ended) {
        params.successCallback([], startRow + result.rows.length);
        return;
      }
    }
  }

  return {
    getRows(params: IGetRowsParams) {
      let query: Omit<GridQuery, "page">;
      try {
        query = syncQuery();
      } catch (error) {
        onError?.(error);
        params.failCallback();
        return;
      }
      const run = pageMode === "cursor" ? getCursorBlock(params, query) : getOffsetBlock(params, query);
      run.catch((error: unknown) => {
        onError?.(error);
        params.failCallback();
      });
    },
    reset,
  };
}

export type InfiniteGridDefaults = Pick<
  GridOptions,
  "rowModelType" | "cacheBlockSize" | "maxConcurrentDatasourceRequests" | "infiniteInitialRowCount" | "cacheOverflowSize"
>;

/**
 * Recommended infinite-row-model grid options. Cursor mode serialises block
 * requests (`maxConcurrentDatasourceRequests: 1`) so walks never race.
 */
export function INFINITE_DEFAULTS(pageMode: PageMode, blockSize: number): InfiniteGridDefaults {
  return {
    rowModelType: "infinite",
    cacheBlockSize: blockSize,
    maxConcurrentDatasourceRequests: pageMode === "cursor" ? 1 : 2,
    infiniteInitialRowCount: 1,
    cacheOverflowSize: 1,
  };
}
