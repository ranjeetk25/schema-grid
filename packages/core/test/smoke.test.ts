import { describe, expect, it } from "vitest";
import { resolveRelativeDate } from "../src/index";

describe("@masai/schema-grid-core smoke", () => {
  it("the root entry loads and a real export works", () => {
    expect(resolveRelativeDate({ relative: "today" }, new Date("2026-09-25T12:00:00.000Z"), "UTC")).toEqual({
      from: "2026-09-25T00:00:00.000Z",
      to: "2026-09-26T00:00:00.000Z",
    });
  });
});
