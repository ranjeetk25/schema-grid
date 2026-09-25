import type { DataSource, GridQuery, GridRow, QueryResult } from "../internal/core";

const DEFAULT_PAGE_SIZE = 500;

export interface IterateQueryOptions {
  /** Rows requested per page. Default 500. */
  pageSize?: number;
  signal?: AbortSignal;
}

/**
 * Pages through a query with a `DataSource`, always in cursor mode (the
 * `page` on `query` is ignored / overwritten): the first request uses
 * `{ cursor: "", limit: pageSize }` (empty cursor = first keyset page, the
 * server convention), then each subsequent request uses the previous
 * result's `nextCursor`, until a page has no `nextCursor`.
 *
 * `signal`, when given, is checked before each fetch (including the first);
 * once aborted, iteration simply stops (no `nextCursor` fetch happens and no
 * error is thrown).
 */
export async function* iterateQuery<Row extends GridRow = GridRow>(
  dataSource: DataSource<Row>,
  query: GridQuery,
  options: IterateQueryOptions = {},
): AsyncIterable<QueryResult<Row>> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const { signal } = options;
  let cursor = "";
  for (;;) {
    if (signal?.aborted) return;
    const page: GridQuery = { ...query, page: { cursor, limit: pageSize } };
    const result = await dataSource.fetch(page);
    yield result;
    if (!result.nextCursor) return;
    cursor = result.nextCursor;
  }
}
