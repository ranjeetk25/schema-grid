import { describe, expect, it } from "vitest";
import { booleanFieldType } from "../../src/field-types/builtins/boolean";

describe("booleanFieldType", () => {
  const config = booleanFieldType.defaultConfig;

  it("parses truthy and falsy strings case-insensitively", () => {
    const truthy = ["true", "yes", "Y", "1", "TRUE", "checked", "✓"];
    for (const s of truthy) {
      expect(booleanFieldType.parse(s, config)).toEqual({ ok: true, value: true });
    }
    const falsy = ["false", "no", "n", "0"];
    for (const s of falsy) {
      expect(booleanFieldType.parse(s, config)).toEqual({ ok: true, value: false });
    }
    expect(booleanFieldType.parse(true, config)).toEqual({ ok: true, value: true });
    expect(booleanFieldType.parse(false, config)).toEqual({ ok: true, value: false });
  });

  it("rejects empty and unrecognized strings", () => {
    expect(booleanFieldType.parse("", config).ok).toBe(false);
    expect(booleanFieldType.parse("maybe", config).ok).toBe(false);
  });

  it("formats as clipboard-safe true/false strings", () => {
    expect(booleanFieldType.format(true, config)).toBe("true");
    expect(booleanFieldType.format(false, config)).toBe("false");
    expect(booleanFieldType.format(null, config)).toBe("");
  });

  it("orders false before true", () => {
    expect(booleanFieldType.compare(false, true, config)).toBeLessThan(0);
    expect(booleanFieldType.compare(true, false, config)).toBeGreaterThan(0);
    expect(booleanFieldType.compare(true, true, config)).toBe(0);
  });

  it("deserializes non-boolean values to null", () => {
    expect(booleanFieldType.deserialize(true)).toBe(true);
    expect(booleanFieldType.deserialize("true")).toBe(null);
    expect(booleanFieldType.deserialize(1)).toBe(null);
  });

  it("has no aggregations", () => {
    expect(booleanFieldType.aggregations).toBeUndefined();
  });
});
