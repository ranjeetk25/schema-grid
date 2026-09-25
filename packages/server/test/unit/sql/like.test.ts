import { describe, expect, it } from "vitest";
import { escapeLike } from "../../../src/sql/like";

describe("escapeLike", () => {
  it("escapes %, _ and the ! escape char", () => {
    expect(escapeLike("50%_a!")).toBe("50!%!_a!!");
    expect(escapeLike("plain")).toBe("plain");
  });
});
