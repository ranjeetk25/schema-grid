import { describe, expect, it } from "vitest";
import { booleanFieldType } from "../../src/field-types/builtins/boolean";
import { currencyFieldType } from "../../src/field-types/builtins/currency";
import { datetimeFieldType } from "../../src/field-types/builtins/datetime";
import { formulaFieldType } from "../../src/field-types/builtins/formula";
import { numberFieldType } from "../../src/field-types/builtins/number";
import { textFieldType } from "../../src/field-types/builtins/text";
import {
  getColumnAggregations,
  getColumnOperators,
} from "../../src/field-types/column-operators";
import { createFieldTypeRegistry } from "../../src/field-types/registry";
import type { AnyFieldType } from "../../src/field-types/types";
import { BOOLEAN_OPERATORS } from "../../src/filter/operators";
import type { ColumnDef } from "../../src/schema/types";

const registry = createFieldTypeRegistry(
  [numberFieldType, currencyFieldType, textFieldType, booleanFieldType, datetimeFieldType, formulaFieldType] as AnyFieldType[],
);
function formulaColumn(resultType: string): ColumnDef {
  const TS = "2026-09-01T00:00:00.000Z";
  return {
    id: "f",
    key: "f",
    label: "F",
    type: "formula",
    config: { resultType },
    formula: "1",
    order: 0,
    createdAt: TS,
    updatedAt: TS,
  };
}

describe("formula field type", () => {
  it("parse always fails: formula columns are read-only", () => {
    for (const input of ["1", 1, null, undefined, {}, true]) {
      expect(formulaFieldType.parse(input, { resultType: "number" })).toEqual({
        ok: false,
        error: "Formula columns are read-only",
      });
    }
  });

  it("format delegates to the number format", () => {
    const cfg = { resultType: "number" as const, precision: 0 };
    expect(formulaFieldType.format(30000, cfg)).toBe(
      numberFieldType.format(30000, { ...numberFieldType.defaultConfig, precision: 0 }),
    );
    expect(formulaFieldType.format(null, cfg)).toBe("");
    expect(formulaFieldType.format("hi", { resultType: "text" })).toBe("hi");
  });

  it("compare with resultType date is chronological", () => {
    const cfg = { resultType: "date" as const };
    expect(formulaFieldType.compare("2026-01-01T00:00:00.000Z", "2026-09-25T00:00:00.000Z", cfg)).toBeLessThan(0);
    expect(formulaFieldType.compare("2026-09-25", "2026-01-01", cfg)).toBeGreaterThan(0);
    expect(formulaFieldType.compare(null, "2026-01-01", cfg)).toBeGreaterThan(0);
  });

  it("configSchema rejects resultType array", () => {
    expect(formulaFieldType.configSchema.safeParse({ resultType: "array" }).success).toBe(false);
    expect(formulaFieldType.configSchema.safeParse({ resultType: "number", precision: 2 }).success).toBe(true);
  });

  it("getColumnOperators for a boolean-result formula gives BOOLEAN_OPERATORS", () => {
    expect(getColumnOperators(formulaColumn("boolean"), registry)).toEqual(BOOLEAN_OPERATORS);
  });

  it("aggregations resolve through the mapped result type", () => {
    expect(getColumnAggregations(formulaColumn("number"), registry)).toContain("sum");
    expect(getColumnAggregations(formulaColumn("text"), registry)).not.toContain("sum");
    expect(getColumnAggregations(formulaColumn("date"), registry)).toContain("min");
  });

  it("valueSchema delegates and defaultValue is null", () => {
    expect(formulaFieldType.valueSchema({ resultType: "number" }).safeParse(5).success).toBe(true);
    expect(formulaFieldType.valueSchema({ resultType: "number" }).safeParse("x").success).toBe(false);
    expect(formulaFieldType.valueSchema({ resultType: "date" }).safeParse("2026-09-25").success).toBe(true);
    expect(formulaFieldType.defaultValue({ resultType: "text" })).toBeNull();
  });
});
