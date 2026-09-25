import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "./relative-time";

describe("formatRelativeTime", () => {
  const now = new Date("2026-09-25T10:00:00Z");
  it("formats minutes", () => {
    expect(formatRelativeTime(new Date(now.getTime() - 5 * 60_000), now)).toBe("5 minutes ago");
  });
  it("formats a day as yesterday or 1 day ago", () => {
    expect(["yesterday", "1 day ago"]).toContain(formatRelativeTime(new Date(now.getTime() - 24 * 3600_000), now));
  });
  it("formats seconds and future", () => {
    expect(formatRelativeTime(now, now)).toBe("now");
    expect(formatRelativeTime(new Date(now.getTime() + 2 * 3600_000), now)).toBe("in 2 hours");
  });
});
