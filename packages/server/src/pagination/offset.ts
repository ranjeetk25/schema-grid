export const MAX_PAGE_LIMIT = 1000;

export interface OffsetPage {
  offset?: number;
  limit: number;
}

/** Clamps `limit` to `1..MAX_PAGE_LIMIT` and `offset` to a non-negative integer. */
export function offsetClause(page: OffsetPage): { limit: number; offset: number } {
  return { limit: clampLimit(page.limit), offset: clampOffset(page.offset) };
}

export const MAX_OFFSET = 1_000_000_000;

function clampLimit(limit: number): number {
  if (limit === Number.POSITIVE_INFINITY) return MAX_PAGE_LIMIT;
  const n = Math.trunc(limit);
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > MAX_PAGE_LIMIT) return MAX_PAGE_LIMIT;
  return n;
}

function clampOffset(offset: number | undefined): number {
  if (offset === undefined) return 0;
  const n = Math.trunc(offset);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, MAX_OFFSET);
}

/** True when more rows exist beyond `limit` (call with `limit + 1` rows fetched). */
export function hasNextPage<T>(rows: T[], limit: number): boolean {
  return rows.length > limit;
}

/** Trims a `limit + 1`-row fetch down to `limit` rows and reports whether more exist. */
export function trimPage<T>(rows: T[], limit: number): { rows: T[]; hasMore: boolean } {
  const hasMore = rows.length > limit;
  return { rows: hasMore ? rows.slice(0, limit) : rows, hasMore };
}
