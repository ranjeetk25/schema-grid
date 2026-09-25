import { describe, expect, it } from "vitest";
import { selectFieldType } from "../../src/field-types/builtins/select";
import { creatableSelectFieldType } from "../../src/field-types/builtins/creatable-select";
import type { OptionsConfig } from "../../src/field-types/builtins/options-shared";

const config: OptionsConfig = {
  options: [
    { id: "opt_pending", label: "Pending" },
    { id: "opt_paid", label: "Paid" },
    { id: "opt_refunded", label: "Refunded" },
  ],
};

describe("selectFieldType", () => {
  it("parses a label into the matching option id", () => {
    const result = selectFieldType.parse("paid", config);
    expect(result).toEqual({ ok: true, value: "opt_paid" });
  });

  it("parses an option id into itself", () => {
    const result = selectFieldType.parse("opt_pending", config);
    expect(result).toEqual({ ok: true, value: "opt_pending" });
  });

  it("fails to parse a label that isn't an option", () => {
    const optionsWithoutRefunded: OptionsConfig = {
      options: [
        { id: "opt_pending", label: "Pending" },
        { id: "opt_paid", label: "Paid" },
      ],
    };
    const result = selectFieldType.parse("Refunded", optionsWithoutRefunded);
    expect(result.ok).toBe(false);
  });

  it("formats an option id as its label", () => {
    expect(selectFieldType.format("opt_paid", config)).toBe("Paid");
  });

  it("formats an unknown id as the raw id", () => {
    expect(selectFieldType.format("opt_unknown", config)).toBe("opt_unknown");
  });

  it("formats null/undefined as empty string", () => {
    expect(selectFieldType.format(null, config)).toBe("");
    expect(selectFieldType.format(undefined, config)).toBe("");
  });

  it("compares by config order, not alphabetical order", () => {
    // Alphabetically "opt_paid" < "opt_pending" < "opt_refunded", but config
    // order is Pending, Paid, Refunded.
    expect(selectFieldType.compare("opt_pending", "opt_paid", config)).toBeLessThan(0);
    expect(selectFieldType.compare("opt_paid", "opt_refunded", config)).toBeLessThan(0);
    expect(selectFieldType.compare("opt_refunded", "opt_pending", config)).toBeGreaterThan(0);
  });

  it("sorts empty values last", () => {
    expect(selectFieldType.compare(null, "opt_paid", config)).toBeGreaterThan(0);
    expect(selectFieldType.compare("opt_paid", null, config)).toBeLessThan(0);
  });

  it("configSchema rejects duplicate option ids", () => {
    const dup: OptionsConfig = {
      options: [
        { id: "opt_a", label: "A" },
        { id: "opt_a", label: "A dup" },
      ],
    };
    expect(selectFieldType.configSchema.safeParse(dup).success).toBe(false);
  });

  it("configSchema accepts a valid config", () => {
    expect(selectFieldType.configSchema.safeParse(config).success).toBe(true);
  });

  it("valueSchema rejects ids not in the options list", () => {
    const schema = selectFieldType.valueSchema(config);
    expect(schema.safeParse("opt_paid").success).toBe(true);
    expect(schema.safeParse("opt_nonexistent").success).toBe(false);
    expect(schema.safeParse(null).success).toBe(true);
  });

  it("defaults to null", () => {
    expect(selectFieldType.defaultValue(config)).toBeNull();
  });

  it("parse of empty input returns ok null", () => {
    expect(selectFieldType.parse("", config)).toEqual({ ok: true, value: null });
    expect(selectFieldType.parse(null, config)).toEqual({ ok: true, value: null });
    expect(selectFieldType.parse(undefined, config)).toEqual({ ok: true, value: null });
  });

  it("serialize/deserialize round-trip", () => {
    expect(selectFieldType.serialize("opt_paid")).toBe("opt_paid");
    expect(selectFieldType.deserialize("opt_paid")).toBe("opt_paid");
    expect(selectFieldType.deserialize(null)).toBeNull();
    expect(selectFieldType.deserialize(42)).toBeNull();
  });

  it("tolerates garbage config at runtime", () => {
    expect(() => selectFieldType.parse("anything", {} as OptionsConfig)).not.toThrow();
    expect(() => selectFieldType.format("x", undefined as unknown as OptionsConfig)).not.toThrow();
  });
});

describe("creatableSelectFieldType", () => {
  it("returns pendingOptions and a label placeholder for an unknown label", () => {
    const result = creatableSelectFieldType.parse("Refunded", {
      options: [{ id: "opt_pending", label: "Pending" }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pendingOptions).toEqual(["Refunded"]);
      expect(result.value).toBe("Refunded");
    }
  });

  it("parses a known label into its option id normally", () => {
    const result = creatableSelectFieldType.parse("paid", config);
    expect(result).toEqual({ ok: true, value: "opt_paid" });
  });

  it("valueSchema accepts any non-empty string or null", () => {
    const schema = creatableSelectFieldType.valueSchema(config);
    expect(schema.safeParse("opt_paid").success).toBe(true);
    expect(schema.safeParse("some pending label").success).toBe(true);
    expect(schema.safeParse(null).success).toBe(true);
  });

  it("uses the same operators as select", () => {
    expect(creatableSelectFieldType.operators.map((o) => o.id)).toEqual(
      selectFieldType.operators.map((o) => o.id),
    );
  });

  it("defaults to null", () => {
    expect(creatableSelectFieldType.defaultValue(config)).toBeNull();
  });
});
