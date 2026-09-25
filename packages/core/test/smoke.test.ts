import { describe, expect, it } from "vitest";
import * as core from "../src/index";

describe("@masai/schema-grid-core smoke", () => {
  it("imports the entry module without error", () => {
    expect(core).toBeTypeOf("object");
    expect(core.ping()).toBe("core");
  });
});
