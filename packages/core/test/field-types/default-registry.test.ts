import { describe, expect, it } from "vitest";
import { z } from "zod";
import { getColumnAggregations } from "../../src/field-types/column-operators";
import { builtinFieldTypes, createDefaultRegistry } from "../../src/field-types/default-registry";
import { BUILTIN_FIELD_TYPE_IDS } from "../../src/field-types/ids";
import type { AnyFieldType } from "../../src/field-types/types";
import type { ColumnDef } from "../../src/schema/types";

const custom: AnyFieldType = {
  id: "rating",
  label: "Rating",
  configSchema: z.object({}),
  defaultConfig: {},
  valueSchema: () => z.nullable(z.number()),
  parse: (input) => (typeof input === "number" ? { ok: true, value: input } : { ok: false, error: "x" }),
  format: (v) => String(v ?? ""),
  serialize: (v) => v,
  deserialize: (r) => (typeof r === "number" ? r : null),
  compare: (a, b) => Number(a) - Number(b),
  operators: [{ id: "eq", label: "=", valueKind: "single" }],
  defaultValue: () => null,
};

describe("createDefaultRegistry", () => {
  it("lists the built-ins in BUILTIN_FIELD_TYPE_IDS order", () => {
    expect(createDefaultRegistry().list().map((t) => t.id)).toEqual([...BUILTIN_FIELD_TYPE_IDS]);
    expect(builtinFieldTypes.map((t) => t.id)).toEqual([...BUILTIN_FIELD_TYPE_IDS]);
  });

  it("returns independent registries and accepts custom types", () => {
    const a = createDefaultRegistry();
    const b = createDefaultRegistry();
    a.register(custom);
    expect(a.has("rating")).toBe(true);
    expect(b.has("rating")).toBe(false);
    expect(a.list()).toHaveLength(17);
  });

  describe.each(builtinFieldTypes.map((t) => [t.id, t] as const))("contract: %s", (_id, type) => {
    it("defaultConfig passes configSchema", () => {
      expect(type.configSchema.safeParse(type.defaultConfig).success).toBe(true);
    });

    it("defaultValue passes valueSchema (or is null)", () => {
      const v = type.defaultValue(type.defaultConfig);
      if (v !== null) expect(type.valueSchema(type.defaultConfig).safeParse(v).success).toBe(true);
    });

    it("serialize/deserialize round-trips the default value", () => {
      const v = type.defaultValue(type.defaultConfig);
      expect(type.deserialize(JSON.parse(JSON.stringify(type.serialize(v) ?? null)))).toEqual(v);
    });

    it("parse never throws on hostile input", () => {
      const inputs: unknown[] = [undefined, null, {}, [], Number.NaN, "x".repeat(10000), Symbol("s").description, Symbol("t")];
      for (const input of inputs) {
        expect(() => type.parse(input, type.defaultConfig)).not.toThrow();
        expect(() => type.parse(input, undefined)).not.toThrow();
      }
    });

    it("has operators", () => {
      expect(type.operators.length).toBeGreaterThan(0);
    });
  });

  it("fillSeries is defined exactly for number, currency, date and datetime", () => {
    const withFill = builtinFieldTypes.filter((t) => t.fillSeries).map((t) => t.id);
    expect(withFill.sort()).toEqual(["currency", "date", "datetime", "number"]);
  });

  it("sum is allowed only for number, currency and number-result formula", () => {
    const registry = createDefaultRegistry();
    const TS = "2026-09-01T00:00:00.000Z";
    const column = (type: string, config: unknown): ColumnDef => ({
      id: type,
      key: type,
      label: type,
      type,
      config,
      order: 0,
      createdAt: TS,
      updatedAt: TS,
    });
    const withSum = builtinFieldTypes
      .filter((t) => t.id !== "formula")
      .filter((t) => getColumnAggregations(column(t.id, t.defaultConfig), registry).includes("sum"))
      .map((t) => t.id);
    expect(withSum.sort()).toEqual(["currency", "number"]);
    expect(getColumnAggregations(column("formula", { resultType: "number" }), registry)).toContain("sum");
    for (const rt of ["text", "boolean", "date"]) {
      expect(getColumnAggregations(column("formula", { resultType: rt }), registry)).not.toContain("sum");
    }
  });
});
