import { describe, expect, it } from "vitest";
import { SCHEMA_GRID_CORE_VERSION, ping } from "./index";

describe("@masai/schema-grid-core placeholder", () => {
  it("exposes a version", () => {
    expect(SCHEMA_GRID_CORE_VERSION).toBe("0.0.1");
  });

  it("pings", () => {
    expect(ping()).toBe("core");
  });
});
