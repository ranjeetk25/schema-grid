/** Normalises an array or an async iterable to an async iterable (lazy for the latter). */
export function toAsyncIterable<T>(
  rows: T[] | AsyncIterable<T>,
): AsyncIterable<T> {
  if (!Array.isArray(rows)) return rows;
  return {
    async *[Symbol.asyncIterator]() {
      for (const row of rows) yield row;
    },
  };
}
