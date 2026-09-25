import { describe, expect, it } from "vitest";
import { currencyFieldType } from "../../src/field-types/builtins/currency";
import { dateFieldType } from "../../src/field-types/builtins/date";
import { numberFieldType } from "../../src/field-types/builtins/number";
import { textFieldType } from "../../src/field-types/builtins/text";
import type { AnyFieldType } from "../../src/field-types/types";
import {
  computeAggregate,
  isAggregationAllowed,
  UNIVERSAL_AGGREGATIONS,
} from "../../src/query/aggregate";

const num = numberFieldType as AnyFieldType;
const date = dateFieldType as AnyFieldType;
const values = [10, null, 5];

describe("computeAggregate", () => {
  it("sums and averages, skipping empties", () => {
    expect(computeAggregate("sum", values, num, num.defaultConfig)).toBe(15);
    expect(computeAggregate("avg", values, num, num.defaultConfig)).toBe(7.5);
  });

  it("counts rows, empties and filled", () => {
    expect(computeAggregate("count", values, num, num.defaultConfig)).toBe(3);
    expect(computeAggregate("countEmpty", values, num, num.defaultConfig)).toBe(1);
    expect(computeAggregate("countFilled", values, num, num.defaultConfig)).toBe(2);
  });

  it("min/max on dates return ISO strings", () => {
    const dates = ["2026-09-25", null, "2026-01-02", "2026-12-31"];
    expect(computeAggregate("min", dates, date, date.defaultConfig)).toBe("2026-01-02");
    expect(computeAggregate("max", dates, date, date.defaultConfig)).toBe("2026-12-31");
  });

  it("avg of nothing is null", () => {
    expect(computeAggregate("avg", [], num, num.defaultConfig)).toBeNull();
    expect(computeAggregate("avg", [null], num, num.defaultConfig)).toBeNull();
    expect(computeAggregate("min", [], num, num.defaultConfig)).toBeNull();
  });
});

describe("isAggregationAllowed", () => {
  it("honours the type's aggregations plus universal ones", () => {
    expect(UNIVERSAL_AGGREGATIONS).toEqual(["count", "countEmpty", "countFilled"]);
    expect(isAggregationAllowed(date, "sum")).toBe(false);
    expect(isAggregationAllowed(textFieldType as AnyFieldType, "count")).toBe(true);
    expect(isAggregationAllowed(currencyFieldType as AnyFieldType, "avg")).toBe(true);
  });
});
