/**
 * True for null, undefined, empty/whitespace-only strings, and empty arrays.
 * `0`, `false` and non-blank strings are NOT empty.
 */
export function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim().length === 0;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/**
 * Compares `a` and `b` treating empty values as sorting after non-empty
 * values, regardless of `cmp`'s own ordering. Falls back to `cmp(a, b)` when
 * neither (or both) are empty.
 *
 * Direction (asc/desc) is the caller's responsibility: to get "nulls last in
 * both directions", callers must negate/flip `cmp` itself for descending
 * sort and pass that flipped comparator here unchanged — never flip the
 * result of `compareWithEmptyLast`, or empties would sort first on desc.
 */
export function compareWithEmptyLast<T>(a: T, b: T, cmp: (a: T, b: T) => number): number {
  const aEmpty = isEmptyValue(a);
  const bEmpty = isEmptyValue(b);
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  return cmp(a, b);
}
