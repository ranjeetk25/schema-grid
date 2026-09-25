import { describe, expect, it } from "vitest";
import { numberFieldType } from "../../src/field-types/builtins/number";
import { currencyFieldType } from "../../src/field-types/builtins/currency";

describe("numberFieldType", () => {
  it("parses grouped, parenthesised and whitespace-padded numbers", () => {
    expect(numberFieldType.parse("1,23,456.5", numberFieldType.defaultConfig)).toEqual({
      ok: true,
      value: 123456.5,
    });
    expect(numberFieldType.parse("(12)", numberFieldType.defaultConfig)).toEqual({
      ok: true,
      value: -12,
    });
    expect(numberFieldType.parse(" 42 ", numberFieldType.defaultConfig)).toEqual({
      ok: true,
      value: 42,
    });
  });

  it("rejects non-numeric text and accepts empty as null", () => {
    const bad = numberFieldType.parse("abc", numberFieldType.defaultConfig);
    expect(bad.ok).toBe(false);
    expect(numberFieldType.parse("", numberFieldType.defaultConfig)).toEqual({
      ok: true,
      value: null,
    });
  });

  it("formats using configured precision and grouping", () => {
    const config = { ...numberFieldType.defaultConfig, precision: 2, locale: "en-IN" };
    expect(numberFieldType.format(1234.5, config)).toBe("1,234.50");
  });

  it("compares numerically", () => {
    expect(numberFieldType.compare(1, 2, numberFieldType.defaultConfig)).toBeLessThan(0);
    expect(numberFieldType.compare(2, 1, numberFieldType.defaultConfig)).toBeGreaterThan(0);
    expect(numberFieldType.compare(1, 1, numberFieldType.defaultConfig)).toBe(0);
    expect(numberFieldType.compare(null, 1, numberFieldType.defaultConfig)).toBeGreaterThan(0);
  });

  it("fills a linear series", () => {
    expect(numberFieldType.fillSeries?.([1, 3], 3, numberFieldType.defaultConfig)).toEqual([5, 7, 9]);
    expect(numberFieldType.fillSeries?.([5], 2, numberFieldType.defaultConfig)).toEqual([5, 5]);
    expect(numberFieldType.fillSeries?.([10, 7], 2, numberFieldType.defaultConfig)).toEqual([4, 1]);
    expect(numberFieldType.fillSeries?.([], 2, numberFieldType.defaultConfig)).toEqual([]);
  });

  it("exposes the full aggregation list", () => {
    expect(numberFieldType.aggregations).toEqual([
      "count",
      "sum",
      "avg",
      "min",
      "max",
      "countEmpty",
      "countFilled",
    ]);
  });

  it("round-trips serialize/deserialize", () => {
    expect(numberFieldType.serialize(42)).toBe(42);
    expect(numberFieldType.deserialize(42)).toBe(42);
    expect(numberFieldType.deserialize("12")).toBe(12);
    expect(numberFieldType.deserialize("x")).toBe(null);
  });
});

describe("currencyFieldType", () => {
  it("parses a leading currency symbol", () => {
    expect(currencyFieldType.parse("₹1,000", currencyFieldType.defaultConfig)).toEqual({
      ok: true,
      value: 1000,
    });
  });

  it("rejects non-numeric text and accepts empty as null", () => {
    expect(currencyFieldType.parse("abc", currencyFieldType.defaultConfig).ok).toBe(false);
    expect(currencyFieldType.parse("", currencyFieldType.defaultConfig)).toEqual({
      ok: true,
      value: null,
    });
  });

  it("format includes the INR symbol and the digits", () => {
    const formatted = currencyFieldType.format(1000, currencyFieldType.defaultConfig);
    expect(formatted).toContain("1,000");
    expect(formatted).toContain("₹");
  });

  it("compares numerically", () => {
    expect(currencyFieldType.compare(1, 2, currencyFieldType.defaultConfig)).toBeLessThan(0);
  });

  it("fills a linear series", () => {
    expect(currencyFieldType.fillSeries?.([1, 3], 3, currencyFieldType.defaultConfig)).toEqual([5, 7, 9]);
    expect(currencyFieldType.fillSeries?.([5], 2, currencyFieldType.defaultConfig)).toEqual([5, 5]);
    expect(currencyFieldType.fillSeries?.([10, 7], 2, currencyFieldType.defaultConfig)).toEqual([4, 1]);
  });

  it("exposes the full aggregation list", () => {
    expect(currencyFieldType.aggregations).toEqual([
      "count",
      "sum",
      "avg",
      "min",
      "max",
      "countEmpty",
      "countFilled",
    ]);
  });

  it("round-trips serialize/deserialize", () => {
    expect(currencyFieldType.serialize(42)).toBe(42);
    expect(currencyFieldType.deserialize("12")).toBe(12);
    expect(currencyFieldType.deserialize("x")).toBe(null);
  });
});
