import { describe, expect, it } from "vitest";
import { SCHEMA_GRID_IO_VERSION, ping } from "./index";

describe("@masai/schema-grid-io placeholder", () => {
  it("exposes a version", () => {
    expect(SCHEMA_GRID_IO_VERSION).toBe("0.0.1");
  });

  it("pings through core", () => {
    expect(ping()).toBe("io:core");
  });
});
