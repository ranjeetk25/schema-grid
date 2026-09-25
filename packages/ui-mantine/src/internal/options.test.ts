import { DEFAULT_THEME } from "@mantine/core";
import { describe, expect, it } from "vitest";
import { buildFixtureAccess, buildFixtureSchema, buildFixtureRegistry, FIXTURE_IDS } from "../test/fixtures";
import { getSelectOptions, resolveOptionColor } from "./options";

describe("fixtures", () => {
  it("every fixture column type exists in the default registry", () => {
    const registry = buildFixtureRegistry();
    for (const c of buildFixtureSchema().columns) {
      expect(registry.has(c.type)).toBe(true);
      const t = registry.get(c.type);
      expect(t?.configSchema.safeParse(c.config).success).toBe(true);
    }
  });

  it("access hides secret and makes formula read-only", () => {
    const access = buildFixtureAccess();
    expect(access.get(FIXTURE_IDS.secret)).toBe("hidden");
    expect(access.get(FIXTURE_IDS.total)).toBe("read");
    expect(access.get(FIXTURE_IDS.payment)).toBe("edit");
  });
});

describe("options helpers", () => {
  it("reads select options from config", () => {
    expect(getSelectOptions({ options: [{ label: "A", value: "a" }, { bad: 1 }] })).toEqual([{ label: "A", value: "a" }]);
    expect(getSelectOptions(null)).toEqual([]);
  });

  it("resolveOptionColor returns configured colour or gray", () => {
    expect(resolveOptionColor({ color: "green" }, DEFAULT_THEME)).toBe("green");
    expect(resolveOptionColor({ color: "#ff0000" }, DEFAULT_THEME)).toBe("#ff0000");
    expect(resolveOptionColor({ color: "notacolor" }, DEFAULT_THEME)).toBe("gray");
    expect(resolveOptionColor({}, DEFAULT_THEME)).toBe("gray");
  });
});
