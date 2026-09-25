import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIME_ZONE,
  addCalendarDays,
  getZonedParts,
  startOfZonedDay,
  zonedToInstant,
} from "../../src/time/zoned";

describe("zoned time helpers", () => {
  it("DEFAULT_TIME_ZONE is Asia/Kolkata", () => {
    expect(DEFAULT_TIME_ZONE).toBe("Asia/Kolkata");
  });

  it("getZonedParts returns wall-clock parts with h23 hours", () => {
    expect(getZonedParts(new Date("2026-09-24T18:30:05Z"), "Asia/Kolkata")).toEqual({
      year: 2026,
      month: 9,
      day: 25,
      hour: 0,
      minute: 0,
      second: 5,
      weekday: 5,
    });
    expect(getZonedParts(new Date("2026-09-27T00:00:00Z"), "UTC").weekday).toBe(7);
  });

  it("zonedToInstant round-trips a normal time", () => {
    expect(zonedToInstant({ year: 2026, month: 9, day: 25, hour: 2, minute: 30 }, "Asia/Kolkata").toISOString()).toBe(
      "2026-09-24T21:00:00.000Z",
    );
  });

  it("zonedToInstant in a DST gap picks the later valid instant", () => {
    // 2026-03-08 02:30 does not exist in New York (clocks jump 02:00 -> 03:00 EDT)
    expect(zonedToInstant({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, "America/New_York").toISOString()).toBe(
      "2026-03-08T07:30:00.000Z",
    );
  });

  it("zonedToInstant in a DST overlap picks the earlier occurrence", () => {
    // 2026-11-01 01:30 occurs twice in New York; first is EDT (-04:00)
    expect(zonedToInstant({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, "America/New_York").toISOString()).toBe(
      "2026-11-01T05:30:00.000Z",
    );
  });

  it("startOfZonedDay", () => {
    expect(startOfZonedDay(new Date("2026-09-25T02:30:00+05:30"), "Asia/Kolkata").toISOString()).toBe(
      "2026-09-24T18:30:00.000Z",
    );
  });

  it("addCalendarDays crosses month and year boundaries", () => {
    expect(addCalendarDays({ year: 2026, month: 12, day: 31 }, 1)).toEqual({ year: 2027, month: 1, day: 1 });
    expect(addCalendarDays({ year: 2026, month: 3, day: 1 }, -1)).toEqual({ year: 2026, month: 2, day: 28 });
    expect(addCalendarDays({ year: 2024, month: 3, day: 1 }, -1)).toEqual({ year: 2024, month: 2, day: 29 });
  });
});
