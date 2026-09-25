import { describe, expect, it } from "vitest";
import { RELATIVE_DATE_PRESETS, resolveRelativeDate } from "../../src/filter/relative-date";
import { validateFilter } from "../../src/filter/validate";
import { createDefaultRegistry } from "../../src/field-types/default-registry";
import { FIXTURE_COLUMN_IDS, createFixtureSchema } from "../../src/testing/schema";
import type { DateRange, RelativeDate } from "../../src/filter/types";
import { getZonedParts } from "../../src/time/zoned";

const KOLKATA = "Asia/Kolkata";
// 2026-09-25T02:30+05:30 (Friday in Kolkata, still Thursday 24th in UTC)
const NOW = new Date("2026-09-25T02:30:00+05:30");

function range(rd: RelativeDate, now: Date = NOW, tz: string = KOLKATA): DateRange {
  const r = resolveRelativeDate(rd, now, tz);
  if ("error" in r) throw new Error(`unexpected error: ${r.error}`);
  return r;
}

/** Kolkata midnight of a given calendar date as UTC ISO. */
function ist(date: string): string {
  return new Date(`${date}T00:00:00+05:30`).toISOString();
}

describe("resolveRelativeDate", () => {
  it("yesterday in Asia/Kolkata", () => {
    expect(range({ relative: "yesterday" })).toEqual({
      from: "2026-09-23T18:30:00.000Z",
      to: "2026-09-24T18:30:00.000Z",
    });
  });

  it("defaults to Asia/Kolkata", () => {
    expect(resolveRelativeDate({ relative: "yesterday" }, NOW)).toEqual({
      from: "2026-09-23T18:30:00.000Z",
      to: "2026-09-24T18:30:00.000Z",
    });
  });

  it("today in UTC for the same instant — tz decides the calendar day", () => {
    expect(range({ relative: "today" }, NOW, "UTC")).toEqual({
      from: "2026-09-24T00:00:00.000Z",
      to: "2026-09-25T00:00:00.000Z",
    });
  });

  it("tomorrow", () => {
    expect(range({ relative: "tomorrow" })).toEqual({ from: ist("2026-09-26"), to: ist("2026-09-27") });
  });

  it("thisWeek on Friday starts Monday", () => {
    expect(range({ relative: "thisWeek" })).toEqual({ from: ist("2026-09-21"), to: ist("2026-09-28") });
  });

  it("lastWeek", () => {
    expect(range({ relative: "lastWeek" })).toEqual({ from: ist("2026-09-14"), to: ist("2026-09-21") });
  });

  it("thisWeek on a Sunday still starts on the previous Monday", () => {
    const sunday = new Date("2026-09-27T15:00:00+05:30");
    expect(range({ relative: "thisWeek" }, sunday)).toEqual({ from: ist("2026-09-21"), to: ist("2026-09-28") });
  });

  it("thisMonth and lastMonth", () => {
    expect(range({ relative: "thisMonth" })).toEqual({ from: ist("2026-09-01"), to: ist("2026-10-01") });
    expect(range({ relative: "lastMonth" })).toEqual({ from: ist("2026-08-01"), to: ist("2026-09-01") });
  });

  it("lastMonth in January rolls back to December of the previous year", () => {
    const jan = new Date("2026-01-15T10:00:00+05:30");
    expect(range({ relative: "lastMonth" }, jan)).toEqual({ from: ist("2025-12-01"), to: ist("2026-01-01") });
  });

  it("lastNDays n=7 includes today", () => {
    expect(range({ relative: "lastNDays", n: 7 })).toEqual({ from: ist("2026-09-19"), to: ist("2026-09-26") });
  });

  it("nextNDays n=3 starts today", () => {
    expect(range({ relative: "nextNDays", n: 3 })).toEqual({ from: ist("2026-09-25"), to: ist("2026-09-28") });
  });

  it("DST: today in America/New_York on fall-back day is 25 hours", () => {
    const now = new Date("2026-11-01T12:00:00-05:00");
    expect(range({ relative: "today" }, now, "America/New_York")).toEqual({
      from: "2026-11-01T04:00:00.000Z",
      to: "2026-11-02T05:00:00.000Z",
    });
  });

  it("lastNDays with missing, 0 or 1.5 n returns an error object", () => {
    for (const n of [undefined, 0, 1.5]) {
      const r = resolveRelativeDate(n === undefined ? { relative: "lastNDays" } : { relative: "lastNDays", n }, NOW, KOLKATA);
      expect(r).toHaveProperty("error");
      expect(typeof (r as { error: unknown }).error).toBe("string");
    }
  });

  it("nextNDays with invalid n returns an error object", () => {
    for (const n of [undefined, -1, 2.5, Number.NaN]) {
      const r = resolveRelativeDate(n === undefined ? { relative: "nextNDays" } : { relative: "nextNDays", n }, NOW, KOLKATA);
      expect(r).toHaveProperty("error");
    }
  });

  it("invalid time zone returns an error object instead of throwing", () => {
    const r = resolveRelativeDate({ relative: "today" }, NOW, "Not/AZone");
    expect(r).toHaveProperty("error");
  });

  it("ranges are contiguous: today.from equals yesterday.to", () => {
    expect(range({ relative: "today" }).from).toBe(range({ relative: "yesterday" }).to);
    expect(range({ relative: "tomorrow" }).from).toBe(range({ relative: "today" }).to);
    expect(range({ relative: "thisWeek" }).from).toBe(range({ relative: "lastWeek" }).to);
    expect(range({ relative: "thisMonth" }).from).toBe(range({ relative: "lastMonth" }).to);
  });

  it("outputs UTC ISO strings ending in Z", () => {
    const r = range({ relative: "today" });
    expect(r.from.endsWith("Z")).toBe(true);
    expect(r.to.endsWith("Z")).toBe(true);
  });

  it("getZonedParts reports weekday 5 for 2026-09-25 in Kolkata", () => {
    expect(getZonedParts(NOW, KOLKATA).weekday).toBe(5);
  });
});

describe("RELATIVE_DATE_PRESETS", () => {
  it("lists every kind in display order with a human label and needsN", () => {
    expect(RELATIVE_DATE_PRESETS).toEqual([
      { kind: "today", label: "Today", needsN: false },
      { kind: "yesterday", label: "Yesterday", needsN: false },
      { kind: "tomorrow", label: "Tomorrow", needsN: false },
      { kind: "thisWeek", label: "This week", needsN: false },
      { kind: "lastWeek", label: "Last week", needsN: false },
      { kind: "thisMonth", label: "This month", needsN: false },
      { kind: "lastMonth", label: "Last month", needsN: false },
      { kind: "lastNDays", label: "Last N days", needsN: true },
      { kind: "nextNDays", label: "Next N days", needsN: true },
    ]);
    expect(Object.isFrozen(RELATIVE_DATE_PRESETS)).toBe(true);
    for (const p of RELATIVE_DATE_PRESETS) expect(Object.isFrozen(p)).toBe(true);
  });

  it("is exactly what validateFilter and resolveRelativeDate accept", () => {
    const schema = createFixtureSchema();
    const registry = createDefaultRegistry();
    const col = FIXTURE_COLUMN_IDS.callDate;
    for (const p of RELATIVE_DATE_PRESETS) {
      const value = p.needsN ? { relative: p.kind, n: 3 } : { relative: p.kind };
      expect(validateFilter({ columnId: col, operator: "isWithin", value }, schema, registry, new Set([col]))).toEqual([]);
      expect("error" in resolveRelativeDate(value, NOW, KOLKATA)).toBe(false);
      if (p.needsN) {
        const missing = validateFilter({ columnId: col, operator: "isWithin", value: { relative: p.kind } }, schema, registry, new Set([col]));
        expect(missing.map((e) => e.code)).toEqual(["valueKindMismatch"]);
      }
    }
  });
});
