import { describe, expect, it } from "vitest";
import { dateFieldType } from "../../src/field-types/builtins/date";

describe("dateFieldType", () => {
  it("parses iso, dmy, mdy and 'D-Mon-YYYY' formats to ISO", () => {
    expect(dateFieldType.parse("2026-09-25", dateFieldType.defaultConfig)).toEqual({
      ok: true,
      value: "2026-09-25",
    });
    expect(dateFieldType.parse("25/09/2026", { ...dateFieldType.defaultConfig, inputOrder: "DMY" })).toEqual({
      ok: true,
      value: "2026-09-25",
    });
    expect(dateFieldType.parse("09/25/2026", { ...dateFieldType.defaultConfig, inputOrder: "MDY" })).toEqual({
      ok: true,
      value: "2026-09-25",
    });
    expect(dateFieldType.parse("25-Sep-2026", dateFieldType.defaultConfig)).toEqual({
      ok: true,
      value: "2026-09-25",
    });
  });

  it("rejects an invalid calendar day and unparseable text", () => {
    expect(dateFieldType.parse("31/02/2026", dateFieldType.defaultConfig).ok).toBe(false);
    expect(dateFieldType.parse("hello", dateFieldType.defaultConfig).ok).toBe(false);
  });

  it("formats per displayFormat", () => {
    expect(dateFieldType.format("2026-09-25", { ...dateFieldType.defaultConfig, displayFormat: "dmy" })).toBe(
      "25/09/2026",
    );
    expect(dateFieldType.format("2026-09-25", { ...dateFieldType.defaultConfig, displayFormat: "iso" })).toBe(
      "2026-09-25",
    );
    const long = dateFieldType.format("2026-09-25", { ...dateFieldType.defaultConfig, displayFormat: "long" });
    expect(long).toContain("2026");
    expect(long).toContain("Sep");
  });

  it("compares chronologically", () => {
    expect(dateFieldType.compare("2026-01-01", "2026-02-01", dateFieldType.defaultConfig)).toBeLessThan(0);
    expect(dateFieldType.compare("2026-02-01", "2026-01-01", dateFieldType.defaultConfig)).toBeGreaterThan(0);
    expect(dateFieldType.compare(null, "2026-01-01", dateFieldType.defaultConfig)).toBeGreaterThan(0);
  });

  it("fills a single-seed series by whole days", () => {
    expect(dateFieldType.fillSeries?.(["2026-09-25"], 2, dateFieldType.defaultConfig)).toEqual([
      "2026-09-26",
      "2026-09-27",
    ]);
  });

  it("fills a monthly series with end-of-month clamping", () => {
    expect(
      dateFieldType.fillSeries?.(["2026-01-31", "2026-02-28"], 2, dateFieldType.defaultConfig),
    ).toEqual(["2026-03-31", "2026-04-30"]);
  });

  it("fills a day-difference series", () => {
    expect(dateFieldType.fillSeries?.(["2026-09-01", "2026-09-08"], 1, dateFieldType.defaultConfig)).toEqual([
      "2026-09-15",
    ]);
  });

  it("excludes sum and avg from aggregations", () => {
    expect(dateFieldType.aggregations).toEqual(["count", "min", "max", "countEmpty", "countFilled"]);
  });

  it("valueSchema rejects an invalid month", () => {
    const schema = dateFieldType.valueSchema(dateFieldType.defaultConfig);
    expect(schema.safeParse("2026-13-01").success).toBe(false);
  });
});
