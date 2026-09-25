import { describe, expect, it } from "vitest";
import { SCHEMA_GRID_AG_GRID_VERSION, ping } from "./index";

describe("@masai/schema-grid-ag-grid placeholder", () => {
  it("exposes a version", () => {
    expect(SCHEMA_GRID_AG_GRID_VERSION).toBe("0.0.1");
  });

  it("pings through core", () => {
    expect(ping()).toBe("ag-grid:core");
  });
});
