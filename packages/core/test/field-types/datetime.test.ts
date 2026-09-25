import { describe, expect, it } from "vitest";
import { datetimeFieldType } from "../../src/field-types/builtins/datetime";

describe("datetimeFieldType", () => {
  it("parses an offset ISO string as-is, normalised to ms precision", () => {
    expect(datetimeFieldType.parse("2026-09-25T10:00:00Z", datetimeFieldType.defaultConfig)).toEqual({
      ok: true,
      value: "2026-09-25T10:00:00.000Z",
    });
  });

  it("parses wall time in the configured timezone", () => {
    const kolkata = { ...datetimeFieldType.defaultConfig, timeZone: "Asia/Kolkata", inputOrder: "DMY" as const };
    expect(datetimeFieldType.parse("25/09/2026 10:00", kolkata)).toEqual({
      ok: true,
      value: "2026-09-25T04:30:00.000Z",
    });

    const newYork = { ...datetimeFieldType.defaultConfig, timeZone: "America/New_York", inputOrder: "DMY" as const };
    expect(datetimeFieldType.parse("25/09/2026 10:00", newYork)).toEqual({
      ok: true,
      value: "2026-09-25T14:00:00.000Z",
    });
  });

  it("formats dmy in the configured timezone", () => {
    const kolkata = { ...datetimeFieldType.defaultConfig, timeZone: "Asia/Kolkata", displayFormat: "dmy" as const };
    const formatted = datetimeFieldType.format("2026-09-25T04:30:00.000Z", kolkata);
    expect(formatted).toContain("25/09/2026");
    expect(formatted).toContain("10:00");
  });

  it("compares chronologically", () => {
    expect(
      datetimeFieldType.compare(
        "2026-09-25T00:00:00.000Z",
        "2026-09-26T00:00:00.000Z",
        datetimeFieldType.defaultConfig,
      ),
    ).toBeLessThan(0);
    expect(
      datetimeFieldType.compare(null, "2026-09-25T00:00:00.000Z", datetimeFieldType.defaultConfig),
    ).toBeGreaterThan(0);
  });

  it("fills a series stepping hourly", () => {
    const result = datetimeFieldType.fillSeries?.(
      ["2026-09-25T10:00:00.000Z", "2026-09-25T11:00:00.000Z"],
      2,
      datetimeFieldType.defaultConfig,
    );
    expect(result).toEqual(["2026-09-25T12:00:00.000Z", "2026-09-25T13:00:00.000Z"]);
  });

  it("fails to parse an invalid string", () => {
    expect(datetimeFieldType.parse("not a date", datetimeFieldType.defaultConfig).ok).toBe(false);
  });
});
