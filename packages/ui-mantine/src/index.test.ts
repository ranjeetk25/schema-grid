import { describe, expect, it } from "vitest";
import { SCHEMA_GRID_UI_MANTINE_VERSION, ping } from "./index";

describe("@masai/schema-grid-ui-mantine placeholder", () => {
  it("exposes a version", () => {
    expect(SCHEMA_GRID_UI_MANTINE_VERSION).toBe("0.0.1");
  });

  it("pings through core, ag-grid, and io", () => {
    expect(ping()).toBe("ui-mantine:core:ag-grid:core:io:core");
  });
});
