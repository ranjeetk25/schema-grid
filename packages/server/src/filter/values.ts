import { isEmptyValue } from "../internal/core";

/**
 * Filter-value coercion shared by the operator translators. Mirrors the value
 * rules of core's reference matcher (`packages/core/src/filter/match.ts`):
 * a value that core would treat as unusable makes the comparison a constant
 * `FALSE` (see `translate-filter.ts`), so positive operators match nothing and
 * negative ones match only empty cells — never throw for a bad VALUE.
 */

/**
 * Thrown by value helpers when the filter value can never match a non-empty
 * cell. Internal: `translateFilter` catches it and substitutes `FALSE`.
 */
export class UnusableFilterValue extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "UnusableFilterValue";
  }
}

/** core `isTextValue`: text operators accept strings, numbers and booleans (stringified). */
export function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  throw new UnusableFilterValue("expected a single text value");
}

/** core `NUMERIC_TEXT`: strict decimal (no hex, no Infinity, no blank). */
const NUMERIC_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** core `toNumber`, but throwing `UnusableFilterValue` instead of returning NaN. */
export function numberValue(value: unknown): number {
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
  } else if (typeof value === "string" && NUMERIC_TEXT.test(value.trim())) {
    const n = Number(value.trim());
    if (Number.isFinite(n)) return n;
  }
  throw new UnusableFilterValue("expected a finite number");
}

/** core `idOf`: a string, a number (stringified) or an object with a string `id`. */
export function idOf(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const id = (value as { id?: unknown }).id;
    if (typeof id === "string") return id;
  }
  return undefined;
}

/** A single id (`is` / `isNot` on select, user, link). Always bound as a string. */
export function idValue(value: unknown): string {
  const id = idOf(value);
  if (id === undefined) throw new UnusableFilterValue("expected an id");
  return id;
}

/**
 * core `asIdList`: a non-array is the empty list; null/undefined items are
 * dropped and every other item is `String(item)` (so objects never match a
 * real id). Used verbatim for the POSITIVE list operators.
 */
export function idListValue(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => v !== null && v !== undefined).map((v) => String(v));
}

/**
 * core `isUsableValue` for `isAnyOf` / `hasAnyOf` (and so for the negatives
 * `isNoneOf` / `hasNoneOf`): an array with at least one `idOf`-able item.
 */
export function assertUsableIdList(value: unknown): void {
  if (!Array.isArray(value) || !value.some((v) => idOf(v) !== undefined)) {
    throw new UnusableFilterValue("expected at least one id");
  }
}

/** core `isRange`: a plain object with a `from` and/or `to` key. */
export function rangeValue(value: unknown): { from: unknown; to: unknown } {
  if (typeof value === "object" && value !== null && !Array.isArray(value) && ("from" in value || "to" in value)) {
    const v = value as { from?: unknown; to?: unknown };
    return { from: v.from, to: v.to };
  }
  throw new UnusableFilterValue("expected a {from, to} range");
}

/** A range bound that is null / undefined / blank / [] is open (core `isEmptyValue`). */
export function isOpenBound(bound: unknown): boolean {
  return isEmptyValue(bound);
}
