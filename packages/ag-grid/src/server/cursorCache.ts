/**
 * Remembers, per infinite-row-model block, the `nextCursor` the server
 * returned for it, so block k can be fetched with block k-1's cursor.
 */
export interface CursorCache {
  /** The nextCursor recorded for `blockIndex`: string, `null` = end of data, `undefined` = not fetched yet. */
  get(blockIndex: number): string | null | undefined;
  /** Record the nextCursor returned when fetching `blockIndex` (`undefined`/`null` = no more rows). */
  set(blockIndex: number, nextCursor: string | null | undefined): void;
  /**
   * The cursor needed to fetch `blockIndex`: `null` for block 0 (start),
   * the previous block's nextCursor, or `undefined` when unknown (the previous
   * block has not been fetched, or it was the last one).
   */
  cursorFor(blockIndex: number): string | null | undefined;
  reset(): void;
}

export function createCursorCache(): CursorCache {
  const next = new Map<number, string | null>();
  return {
    get: (blockIndex) => next.get(blockIndex),
    set: (blockIndex, nextCursor) => {
      next.set(blockIndex, nextCursor ?? null);
    },
    cursorFor: (blockIndex) => {
      if (blockIndex <= 0) return null;
      const prev = next.get(blockIndex - 1);
      return prev === null ? undefined : prev;
    },
    reset: () => next.clear(),
  };
}
