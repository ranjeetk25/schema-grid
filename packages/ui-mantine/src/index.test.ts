import { describe, expect, it } from "vitest";
import { SCHEMA_GRID_UI_MANTINE_VERSION } from "./index";

describe("@masai/schema-grid-ui-mantine", () => {
  it("exposes a version", () => {
    expect(SCHEMA_GRID_UI_MANTINE_VERSION).toBe("0.0.1");
  });
});
