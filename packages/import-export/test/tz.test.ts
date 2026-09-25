import { describe, expect, it } from "vitest";
import {
  fromZonedWallClock,
  isMidnightUtc,
  toIsoDate,
  toZonedWallClock,
} from "../src/internal/tz";

describe("tz helpers", () => {
  it("converts an instant to Kolkata wall clock", () => {
    const wall = toZonedWallClock("2026-09-24T18:30:00Z", "Asia/Kolkata");
    expect(wall.toISOString()).toBe("2026-09-25T00:00:00.000Z");
    expect(isMidnightUtc(wall)).toBe(true);
    expect(toIsoDate(wall)).toBe("2026-09-25");
  });

  it("keeps UTC wall clock identical", () => {
    const d = new Date("2026-09-25T10:30:00.000Z");
    expect(toZonedWallClock(d, "UTC").toISOString()).toBe(d.toISOString());
  });

  const instants = [
    "2026-09-25T05:00:00.000Z",
    "2026-03-08T06:59:00.000Z", // just before US spring-forward (02:00 EST)
    "2026-03-08T07:30:00.000Z", // just after
    "2026-11-01T05:30:00.000Z", // inside the repeated hour (first 01:30 EDT)
    "2026-11-01T06:30:00.000Z", // repeated hour (second 01:30 EST)
    "2026-11-02T12:00:00.000Z",
  ];
  for (const tz of ["Asia/Kolkata", "UTC", "America/New_York"]) {
    it(`fromZonedWallClock inverts toZonedWallClock in ${tz}`, () => {
      for (const iso of instants) {
        const back = fromZonedWallClock(toZonedWallClock(iso, tz), tz);
        if (tz === "America/New_York" && iso === "2026-11-01T06:30:00.000Z") {
          // Ambiguous wall time resolves to the earlier instant.
          expect(back).toBe("2026-11-01T05:30:00.000Z");
        } else {
          expect(back).toBe(iso);
        }
      }
    });
  }

  it("resolves a DST-gap wall time to the later instant", () => {
    // 02:30 does not exist on 2026-03-08 in New York.
    const back = fromZonedWallClock(
      new Date("2026-03-08T02:30:00.000Z"),
      "America/New_York",
    );
    expect(back).toBe("2026-03-08T07:30:00.000Z");
  });

  it("reads Kolkata wall clock back to UTC", () => {
    expect(
      fromZonedWallClock(new Date("2026-09-25T10:30:00.000Z"), "Asia/Kolkata"),
    ).toBe("2026-09-25T05:00:00.000Z");
  });

  it("isMidnightUtc is false with a time part", () => {
    expect(isMidnightUtc(new Date("2026-09-25T00:00:01.000Z"))).toBe(false);
  });

  it("surfaces an invalid tz as RangeError", () => {
    expect(() => toZonedWallClock(new Date(), "Not/AZone")).toThrow(RangeError);
    expect(() => fromZonedWallClock(new Date(), "Not/AZone")).toThrow(RangeError);
  });
});
