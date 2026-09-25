import { describe, expect, it } from "vitest";
import { multiSelectFieldType } from "../../src/field-types/builtins/multi-select";
import { isEmptyValue } from "../../src/field-types/empty";
import type { MultiSelectConfig } from "../../src/field-types/builtins/multi-select";

const config: MultiSelectConfig = {
  options: [
    { id: "opt_pending", label: "Pending" },
    { id: "opt_paid", label: "Paid" },
    { id: "opt_refunded", label: "Refunded" },
  ],
};

describe("multiSelectFieldType", () => {
  it("parses a comma-separated label list into ids in config order", () => {
    const result = multiSelectFieldType.parse("Paid, Pending", config);
    expect(result).toEqual({ ok: true, value: ["opt_pending", "opt_paid"] });
  });

  it("parses a JSON array string", () => {
    const result = multiSelectFieldType.parse(JSON.stringify(["opt_paid", "opt_pending"]), config);
    expect(result).toEqual({ ok: true, value: ["opt_pending", "opt_paid"] });
  });

  it("parses a JS array input directly", () => {
    const result = multiSelectFieldType.parse(["Paid", "Refunded"], config);
    expect(result).toEqual({ ok: true, value: ["opt_paid", "opt_refunded"] });
  });

  it("dedups repeated values", () => {
    const result = multiSelectFieldType.parse("Paid, Paid, opt_paid", config);
    expect(result).toEqual({ ok: true, value: ["opt_paid"] });
  });

  it("fails on an unknown label without allowCreate", () => {
    const result = multiSelectFieldType.parse("Paid, Bogus", config);
    expect(result.ok).toBe(false);
  });

  it("returns pendingOptions for unknown labels when allowCreate is set", () => {
    const creatable: MultiSelectConfig = { ...config, allowCreate: true };
    const result = multiSelectFieldType.parse("Paid, Bogus", creatable);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pendingOptions).toEqual(["Bogus"]);
      expect(result.value).toEqual(["opt_paid", "Bogus"]);
    }
  });

  it("empty input returns ok []", () => {
    expect(multiSelectFieldType.parse("", config)).toEqual({ ok: true, value: [] });
    expect(multiSelectFieldType.parse(null, config)).toEqual({ ok: true, value: [] });
    expect(multiSelectFieldType.parse(undefined, config)).toEqual({ ok: true, value: [] });
    expect(multiSelectFieldType.parse([], config)).toEqual({ ok: true, value: [] });
  });

  it("parses semicolon- and newline-separated strings", () => {
    expect(multiSelectFieldType.parse("Paid; Pending", config)).toEqual({
      ok: true,
      value: ["opt_pending", "opt_paid"],
    });
    expect(multiSelectFieldType.parse("Paid\nPending", config)).toEqual({
      ok: true,
      value: ["opt_pending", "opt_paid"],
    });
  });

  it("format joins labels with ', '", () => {
    expect(multiSelectFieldType.format(["opt_pending", "opt_paid"], config)).toBe("Pending, Paid");
  });

  it("format of empty/null is ''", () => {
    expect(multiSelectFieldType.format([], config)).toBe("");
    expect(multiSelectFieldType.format(null, config)).toBe("");
    expect(multiSelectFieldType.format(undefined, config)).toBe("");
  });

  it("compare orders by first selected option's order, then by length", () => {
    // opt_pending (index 0) before opt_paid (index 1)
    expect(
      multiSelectFieldType.compare(["opt_pending"], ["opt_paid"], config),
    ).toBeLessThan(0);
    // Same first option: shorter first
    expect(
      multiSelectFieldType.compare(["opt_pending"], ["opt_pending", "opt_paid"], config),
    ).toBeLessThan(0);
  });

  it("compare sorts empty arrays last", () => {
    expect(multiSelectFieldType.compare([], ["opt_paid"], config)).toBeGreaterThan(0);
    expect(multiSelectFieldType.compare(["opt_paid"], [], config)).toBeLessThan(0);
    expect(multiSelectFieldType.compare([], [], config)).toBe(0);
  });

  it("defaultValue is [] and isEmptyValue([]) is true", () => {
    expect(multiSelectFieldType.defaultValue(config)).toEqual([]);
    expect(isEmptyValue(multiSelectFieldType.defaultValue(config))).toBe(true);
  });

  it("serialize/deserialize round-trip", () => {
    const serialized = multiSelectFieldType.serialize(["opt_pending", "opt_paid"]);
    expect(serialized).toEqual(["opt_pending", "opt_paid"]);
    expect(multiSelectFieldType.deserialize(serialized)).toEqual(["opt_pending", "opt_paid"]);
  });

  it("deserializing a non-array gives null", () => {
    expect(multiSelectFieldType.deserialize("opt_paid")).toBeNull();
    expect(multiSelectFieldType.deserialize(null)).toBeNull();
    expect(multiSelectFieldType.deserialize(42)).toBeNull();
  });

  it("deserialize filters out non-string items", () => {
    expect(multiSelectFieldType.deserialize(["opt_paid", 42, null, "opt_pending"])).toEqual([
      "opt_paid",
      "opt_pending",
    ]);
  });

  it("valueSchema rejects unknown ids unless allowCreate", () => {
    const schema = multiSelectFieldType.valueSchema(config);
    expect(schema.safeParse(["opt_paid"]).success).toBe(true);
    expect(schema.safeParse(["opt_bogus"]).success).toBe(false);
    expect(schema.safeParse(null).success).toBe(true);

    const creatableSchema = multiSelectFieldType.valueSchema({ ...config, allowCreate: true });
    expect(creatableSchema.safeParse(["anything"]).success).toBe(true);
  });

  it("configSchema rejects duplicate option ids", () => {
    const dup: MultiSelectConfig = {
      options: [
        { id: "opt_a", label: "A" },
        { id: "opt_a", label: "A dup" },
      ],
    };
    expect(multiSelectFieldType.configSchema.safeParse(dup).success).toBe(false);
  });
});
