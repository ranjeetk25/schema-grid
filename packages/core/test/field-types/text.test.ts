import { describe, expect, it } from "vitest";
import { longTextFieldType } from "../../src/field-types/builtins/long-text";
import { textFieldType } from "../../src/field-types/builtins/text";

const cfg = textFieldType.defaultConfig;

describe("text field type", () => {
  it("parse trims, maps empty to null and stringifies numbers/booleans", () => {
    expect(textFieldType.parse("  hi  ", cfg)).toEqual({ ok: true, value: "hi" });
    expect(textFieldType.parse("", cfg)).toEqual({ ok: true, value: null });
    expect(textFieldType.parse("   ", cfg)).toEqual({ ok: true, value: null });
    expect(textFieldType.parse(null, cfg)).toEqual({ ok: true, value: null });
    expect(textFieldType.parse(42, cfg)).toEqual({ ok: true, value: "42" });
    expect(textFieldType.parse(true, cfg)).toEqual({ ok: true, value: "true" });
  });

  it("parse rejects values longer than maxLength", () => {
    expect(textFieldType.parse("abcdef", { maxLength: 3 }).ok).toBe(false);
    expect(textFieldType.parse("abc", { maxLength: 3 }).ok).toBe(true);
  });

  it("text collapses newlines; longText keeps them", () => {
    expect(textFieldType.parse("a\nb\r\nc", cfg)).toEqual({ ok: true, value: "a b c" });
    expect(longTextFieldType.parse("a\nb", longTextFieldType.defaultConfig)).toEqual({
      ok: true,
      value: "a\nb",
    });
  });

  it("parse never throws on odd input", () => {
    for (const input of [undefined, {}, [], Number.NaN, Symbol("x"), "x".repeat(10000)]) {
      expect(() => textFieldType.parse(input, cfg)).not.toThrow();
      expect(() => longTextFieldType.parse(input, {})).not.toThrow();
    }
    expect(textFieldType.parse({}, cfg).ok).toBe(false);
  });

  it("format(null) is empty", () => {
    expect(textFieldType.format(null, cfg)).toBe("");
    expect(textFieldType.format(undefined, cfg)).toBe("");
    expect(textFieldType.format("x", cfg)).toBe("x");
  });

  it("serialize/deserialize round-trips; non-strings deserialize to null", () => {
    expect(textFieldType.deserialize(textFieldType.serialize("hello"))).toBe("hello");
    expect(textFieldType.deserialize(12)).toBeNull();
    expect(longTextFieldType.deserialize({})).toBeNull();
  });

  it("compare is case-insensitive and numeric-aware, empties last", () => {
    expect(textFieldType.compare("apple", "Banana", cfg)).toBeLessThan(0);
    expect(textFieldType.compare("item 2", "item 10", cfg)).toBeLessThan(0);
    expect(textFieldType.compare(null, "a", cfg)).toBeGreaterThan(0);
    expect(textFieldType.compare("a", "", cfg)).toBeLessThan(0);
  });

  it("valueSchema rejects numbers and accepts null", () => {
    const s = textFieldType.valueSchema(cfg);
    expect(s.safeParse(1).success).toBe(false);
    expect(s.safeParse(null).success).toBe(true);
    expect(s.safeParse("x").success).toBe(true);
    expect(textFieldType.valueSchema({ maxLength: 2 }).safeParse("abc").success).toBe(false);
    expect(textFieldType.valueSchema({ minLength: 2 }).safeParse("a").success).toBe(false);
  });

  it("configSchema rejects a negative maxLength", () => {
    expect(textFieldType.configSchema.safeParse({ maxLength: -1 }).success).toBe(false);
    expect(textFieldType.configSchema.safeParse({}).success).toBe(true);
    expect(longTextFieldType.configSchema.safeParse({ maxLength: -5 }).success).toBe(false);
  });

  it("uses TEXT operators, no aggregations/fillSeries, default null", () => {
    expect(textFieldType.operators.map((o) => o.id)).toContain("contains");
    expect(textFieldType.aggregations).toBeUndefined();
    expect(textFieldType.fillSeries).toBeUndefined();
    expect(textFieldType.defaultValue(cfg)).toBeNull();
    expect(longTextFieldType.defaultValue({})).toBeNull();
  });
});
