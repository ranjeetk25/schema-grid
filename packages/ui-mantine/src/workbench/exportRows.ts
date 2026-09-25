/**
 * Row collection for the export dialog. Framework-free (copied verbatim by ui-shadcn).
 */
import type { DataSource, FilterNode, GridRow, SortSpec } from "@ranjeetk25/schema-grid-core";

export interface CollectRowsOptions {
  filter: FilterNode | null;
  sort: SortSpec[];
  search?: string;
  /** Page size; clamped by the source's `maxPageSize`. */
  pageSize: number;
  /** Stop after this many rows. Default 100,000. */
  maxRows?: number;
}

/**
 * Pages the query through `dataSource.fetch` until the source runs dry. Keeps
 * going while a page has rows or a `nextCursor` (never stops on a short page:
 * a capped source may return fewer rows than asked).
 */
export async function collectRows(dataSource: DataSource, options: CollectRowsOptions): Promise<GridRow[]> {
  const limit = Math.max(1, options.pageSize);
  const maxRows = options.maxRows ?? 100_000;
  const rows: GridRow[] = [];
  let offset = 0;
  let cursor: string | undefined;
  for (let guard = 0; guard < 10_000 && rows.length < maxRows; guard++) {
    const page = cursor ? { cursor, limit } : { offset, limit };
    const result = await dataSource.fetch({
      filter: options.filter,
      sort: options.sort,
      ...(options.search ? { search: options.search } : {}),
      page,
    });
    rows.push(...result.rows);
    if (result.rows.length === 0 && !result.nextCursor) break;
    cursor = result.nextCursor;
    offset += result.rows.length;
    if (!cursor && result.total !== undefined && offset >= result.total) break;
  }
  return rows.slice(0, maxRows);
}
