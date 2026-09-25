import { describe, expect, it } from "vitest";
import { FIXTURE_IDS, buildFixtureAccess, buildFixtureRegistry, buildFixtureSchema } from "../test/fixtures";
import { getSelectOptions, optionToneStyle, resolveOptionColor } from "./options";

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
    expect(getSelectOptions({ options: [{ id: "a", label: "A" }, { label: "B", value: "b" }, { bad: 1 }] })).toEqual([{ id: "a", label: "A" }]);
    expect(getSelectOptions(null)).toEqual([]);
  });

  it("resolveOptionColor returns a named tone, a CSS colour or gray", () => {
    expect(resolveOptionColor({ color: "green" })).toBe("green");
    expect(resolveOptionColor({ color: "#ff0000" })).toBe("#ff0000");
    expect(resolveOptionColor({ color: "notacolor" })).toBe("gray");
    expect(resolveOptionColor({})).toBe("gray");
  });

  it("optionToneStyle maps named tones to tokens and raw colours to color-mix", () => {
    expect(optionToneStyle({ color: "green" })).toMatchObject({ "--sg-tone-bg": "var(--sg-tone-green-bg)" });
    expect(String((optionToneStyle({ color: "#ff0000" }) as Record<string, string>)["--sg-tone-bg"])).toContain("color-mix");
  });
});
