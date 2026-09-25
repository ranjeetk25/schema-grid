import { isEmptyValue } from "../field-types/empty";
import type { AnyFieldType } from "../field-types/types";
import type { AggregationId } from "./types";

/** Aggregations allowed on every field type. */
export const UNIVERSAL_AGGREGATIONS: readonly AggregationId[] = Object.freeze([
  "count",
  "countEmpty",
  "countFilled",
]);

/** True when the type declares the aggregation or it is universal. */
export function isAggregationAllowed(fieldType: AnyFieldType, agg: AggregationId): boolean {
  return UNIVERSAL_AGGREGATIONS.includes(agg) || (fieldType.aggregations ?? []).includes(agg);
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Computes one aggregate over the values of a column in a set of rows.
 * - count: number of values (rows), empties included.
 * - countEmpty / countFilled: by `isEmptyValue`.
 * - sum / avg: skip empties and non-numbers; avg of nothing is null, sum of nothing is 0.
 * - min / max: by `fieldType.compare`; returns the raw value (dates stay ISO strings).
 * Never throws.
 */
export function computeAggregate(
  agg: AggregationId,
  values: readonly unknown[],
  fieldType: AnyFieldType,
  config: unknown,
): number | string | null {
  switch (agg) {
    case "count":
      return values.length;
    case "countEmpty":
      return values.filter((v) => isEmptyValue(v)).length;
    case "countFilled":
      return values.filter((v) => !isEmptyValue(v)).length;
    case "sum":
    case "avg": {
      let sum = 0;
      let n = 0;
      for (const v of values) {
        const num = toFiniteNumber(v);
        if (num === null) continue;
        sum += num;
        n++;
      }
      if (agg === "sum") return sum;
      return n === 0 ? null : sum / n;
    }
    case "min":
    case "max": {
      let best: unknown = null;
      for (const v of values) {
        if (isEmptyValue(v)) continue;
        if (best === null) {
          best = v;
          continue;
        }
        let c: number;
        try {
          c = fieldType.compare(v, best, config);
        } catch {
          continue;
        }
        if ((agg === "min" && c < 0) || (agg === "max" && c > 0)) best = v;
      }
      if (best === null) return null;
      if (typeof best === "number" || typeof best === "string") return best;
      return fieldType.format(best, config);
    }
    default:
      return null;
  }
}
