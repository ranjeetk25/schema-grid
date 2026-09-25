import { describe, expect, it } from "vitest";
import { SCHEMA_GRID_SERVER_VERSION, ping } from "./index";

describe("@masai/schema-grid-server placeholder", () => {
  it("exposes a version", () => {
    expect(SCHEMA_GRID_SERVER_VERSION).toBe("0.0.1");
  });

  it("pings through core", () => {
    expect(ping()).toBe("server:core");
  });
});
